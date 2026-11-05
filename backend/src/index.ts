/**
 * Node.js 실시간 서버 엔트리포인트 (Render.com 등 무료 호스팅용)
 *
 *  - GET /api/health               : 헬스체크
 *  - WS  /api/rooms/:roomId/ws     : 방 WebSocket (query: role, name, shape, color)
 *  - 그 외 GET                      : frontend/dist 정적 파일 (SPA) — 빌드돼 있을 때만
 *
 * 한 프로세스가 프론트엔드와 WebSocket 을 같이 서빙하므로 무료 웹 서비스 1개로 배포 가능하고
 * CORS / WS 주소 설정이 필요 없다.
 */
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { GameRoom } from "./GameRoom.js";
import { createStaticHandler } from "./static.js";

const PORT = Number(process.env.PORT ?? 8787);
/** 쉼표로 구분된 허용 Origin 목록. "*" 이면 전체 허용 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
/** 빈 방을 메모리에서 지우기까지 대기 시간 */
const EMPTY_ROOM_TTL_MS = 5 * 60_000;
/** 죽은 연결(모바일 백그라운드 등) 감지용 ping 주기 */
const HEARTBEAT_MS = 30_000;

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
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
    }, EMPTY_ROOM_TTL_MS),
  );
}

// ───────────── HTTP ─────────────

const serveStatic = createStaticHandler(process.env.STATIC_DIR);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: true, time: Date.now(), rooms: rooms.size }));
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

  const room = getRoom(roomId);
  const denied = room.canJoin(url.searchParams);
  if (denied) return reject(denied.code, denied.message);

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
