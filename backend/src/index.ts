/**
 * Node.js 실시간 서버 엔트리포인트 (Render.com 등 무료 호스팅용)
 *
 *  - GET  /api/health              : 헬스체크
 *  - POST /api/rooms               : 방 생성 + 방장 비밀번호 설정 { roomId, adminPassword }
 *  - WS   /api/rooms/:roomId/ws    : 방 WebSocket (query: role, name, shape, color / admin: password)
 *  - 그 외 GET                      : frontend/dist 정적 파일 (SPA) — 빌드돼 있을 때만
 *
 * 한 프로세스가 프론트엔드와 WebSocket 을 같이 서빙하므로 무료 웹 서비스 1개로 배포 가능하고
 * CORS / WS 주소 설정이 필요 없다.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  ADMIN_PASSWORD_LENGTH,
  CLOSE_CODE,
  ROOM_ID_PATTERN,
  type CreateRoomRequest,
} from "@quiz/shared";
import { WebSocketServer, type WebSocket } from "ws";
import { GameRoom } from "./GameRoom.js";
import { createStaticHandler } from "./static.js";

const PORT = Number(process.env.PORT ?? 8787);
/** 쉼표로 구분된 허용 Origin 목록. "*" 이면 전체 허용 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
/** 빈 방을 메모리에서 지우기까지 대기 시간 (방장이 만든 방은 방송 준비 시간을 고려해 길게) */
const EMPTY_ROOM_TTL_MS = 5 * 60_000;
const EMPTY_ADMIN_ROOM_TTL_MS = 2 * 60 * 60_000;
/** 관리자 비밀번호 무차별 대입 방지: IP 당 윈도우 내 최대 실패 횟수 */
const AUTH_MAX_FAILURES = 10;
const AUTH_WINDOW_MS = 5 * 60_000;
/** 죽은 연결(모바일 백그라운드 등) 감지용 ping 주기 */
const HEARTBEAT_MS = 30_000;

const WS_ROUTE = /^\/api\/rooms\/([^/]+)\/ws$/;

// ───────────── 방 관리 (서버 메모리) ─────────────

const rooms = new Map<string, GameRoom>();
const emptyTimers = new Map<string, NodeJS.Timeout>();

function getRoom(roomId: string): GameRoom {
  const timer = emptyTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    emptyTimers.delete(roomId);
  }
  let room = rooms.get(roomId);
  if (!room) {
    room = new GameRoom(roomId, () => scheduleRoomCleanup(roomId));
    rooms.set(roomId, room);
    console.log(`[room] created ${roomId} (total ${rooms.size})`);
  }
  return room;
}

/** 마지막 사람이 나가면 일정 시간 후 방 삭제 (그 사이 재접속하면 유지) */
function scheduleRoomCleanup(roomId: string) {
  if (emptyTimers.has(roomId)) return;
  const ttl = rooms.get(roomId)?.hasAdminPassword() ? EMPTY_ADMIN_ROOM_TTL_MS : EMPTY_ROOM_TTL_MS;
  emptyTimers.set(
    roomId,
    setTimeout(() => {
      emptyTimers.delete(roomId);
      const room = rooms.get(roomId);
      if (room && room.isEmpty()) {
        room.dispose();
        rooms.delete(roomId);
        console.log(`[room] removed ${roomId} (total ${rooms.size})`);
      }
    }, ttl),
  );
}

// ───────────── 관리자 인증 실패 제한 ─────────────

const authFailures = new Map<string, { count: number; resetAt: number }>();

/** 리버스 프록시(Render 등) 뒤에서 실행 중일 때만 X-Forwarded-For 를 신뢰 */
const TRUST_PROXY = /^(1|true)$/i.test(process.env.TRUST_PROXY ?? "");

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    // 클라이언트가 보낸 값은 앞쪽에 남고 프록시가 실제 IP 를 맨 뒤에 덧붙임 → 마지막 값을 사용
    // (첫 번째 값은 위조 가능해서 실패 횟수 제한을 우회할 수 있음)
    const fwd = req.headers["x-forwarded-for"];
    const last = (Array.isArray(fwd) ? fwd.join(",") : fwd)?.split(",").pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip: string): boolean {
  const entry = authFailures.get(ip);
  if (!entry || entry.resetAt < Date.now()) return false;
  return entry.count >= AUTH_MAX_FAILURES;
}

function recordAuthFailure(ip: string) {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || entry.resetAt < now) authFailures.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
  else entry.count++;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of authFailures) if (e.resetAt < now) authFailures.delete(ip);
}, AUTH_WINDOW_MS).unref();

// ───────────── HTTP ─────────────

const serveStatic = createStaticHandler(process.env.STATIC_DIR);

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  const allowed = !origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
  return allowed && origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : {};
}

function json(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

/** 작은 JSON 본문만 허용 (최대 2KB) */
function readJson<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 2048) {
        resolve(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/** POST /api/rooms — 방 생성 + 방장 비밀번호 설정 */
async function handleCreateRoom(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson<Partial<CreateRoomRequest>>(req);
  const roomId = typeof body?.roomId === "string" ? body.roomId.trim() : "";
  const password = typeof body?.adminPassword === "string" ? body.adminPassword : "";
  if (!ROOM_ID_PATTERN.test(roomId)) {
    return json(req, res, 400, { error: "방 코드는 영문, 숫자, -, _ 로 1~32자여야 합니다" });
  }
  if (password.length < ADMIN_PASSWORD_LENGTH.min || password.length > ADMIN_PASSWORD_LENGTH.max) {
    return json(req, res, 400, { error: `비밀번호는 ${ADMIN_PASSWORD_LENGTH.min}~${ADMIN_PASSWORD_LENGTH.max}자여야 합니다` });
  }
  const room = getRoom(roomId);
  // 참가자만 먼저 들어와 있던(비밀번호 없는) 방은 방장이 차지할 수 있음
  if (!room.setAdminPassword(password)) {
    return json(req, res, 409, { error: "이미 방장이 있는 방입니다. '기존 방 관리'로 로그인하세요" });
  }
  if (room.isEmpty()) scheduleRoomCleanup(roomId); // 아무도 접속하지 않으면 TTL 후 정리
  console.log(`[room] admin password set for ${roomId}`);
  json(req, res, 201, { roomId });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(204, corsHeaders(req)).end();
    return;
  }
  if (url.pathname === "/api/health") {
    json(req, res, 200, { ok: true, time: Date.now(), rooms: rooms.size });
    return;
  }
  if (url.pathname === "/api/rooms" && req.method === "POST") {
    void handleCreateRoom(req, res);
    return;
  }
  if (serveStatic && req.method === "GET" && !url.pathname.startsWith("/api/")) {
    serveStatic(url.pathname, res);
    return;
  }
  res.writeHead(404).end("Not found");
});

// ───────────── WebSocket ─────────────

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = url.pathname.match(WS_ROUTE);
  const reject = (code: number, msg: string) => {
    socket.end(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`);
  };

  if (!match) return reject(404, "Not Found");
  const origin = req.headers.origin;
  if (!ALLOWED_ORIGINS.includes("*") && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return reject(403, "Forbidden");
  }
  const roomId = decodeURIComponent(match[1]);
  if (!ROOM_ID_PATTERN.test(roomId)) return reject(400, "Bad Request");

  // ── 관리자: 비밀번호 검증. 실패하면 연결을 받은 직후 close code 로 끊어 원인을 알려줌 ──
  if (url.searchParams.get("role") === "admin") {
    const ip = clientIp(req);
    const room = rooms.get(roomId);
    const password = url.searchParams.get("password") ?? "";
    let closeWith: { code: number; reason: string } | null = null;
    if (isRateLimited(ip)) {
      closeWith = { code: CLOSE_CODE.TOO_MANY_ATTEMPTS, reason: "too many attempts" };
    } else if (!room?.hasAdminPassword()) {
      closeWith = { code: CLOSE_CODE.ROOM_NOT_FOUND, reason: "room not found" };
    } else if (!room.verifyAdminPassword(password)) {
      recordAuthFailure(ip);
      closeWith = { code: CLOSE_CODE.ADMIN_AUTH_FAILED, reason: "invalid admin password" };
    }
    if (closeWith || !room) {
      const { code, reason } = closeWith ?? { code: CLOSE_CODE.ROOM_NOT_FOUND, reason: "room not found" };
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(code, reason));
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      markAlive(ws);
      getRoom(roomId).join(ws, url.searchParams);
    });
    return;
  }

  const room = getRoom(roomId);
  if (!room.isValidRole(url.searchParams)) return reject(400, "Bad Request");

  // 정원 초과: 연결을 받은 뒤 4009 로 닫아 클라이언트가 "방이 가득 찼습니다" 를 표시할 수 있게
  const role = url.searchParams.get("role") ?? "player";
  if (role === "player" && room.isFull()) {
    wss.handleUpgrade(req, socket, head, (ws) => ws.close(CLOSE_CODE.ROOM_FULL, "room full"));
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    markAlive(ws);
    room.join(ws, url.searchParams);
  });
});

// 하트비트: 응답 없는 소켓 정리 (close 이벤트가 오지 않는 끊김 대비)
const alive = new WeakMap<WebSocket, boolean>();
function markAlive(ws: WebSocket) {
  alive.set(ws, true);
  ws.on("pong", () => alive.set(ws, true));
}
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, HEARTBEAT_MS);

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}${serveStatic ? " (serving frontend)" : ""}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const room of rooms.values()) room.dispose();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
