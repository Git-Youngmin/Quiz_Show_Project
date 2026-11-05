/**
 * GameRoom Durable Object — 방(Room) 하나 = 인스턴스 하나.
 *
 * 설계 포인트
 * 1. WebSocket Hibernation API 사용 (ctx.acceptWebSocket)
 *    - 메시지가 없으면 DO 가 메모리에서 내려가도(hibernate) 연결은 유지되고 과금되지 않음.
 *    - 깨어나면 메모리 상태가 사라지므로, 소켓별 상태는 serializeAttachment 에 보관하고
 *      생성자에서 ctx.getWebSockets() 로 복원한다.
 * 2. 위치 브로드캐스트는 "배치 스냅샷" 방식
 *    - move 메시지를 받을 때마다 즉시 N명에게 중계하면 O(N²) 메시지가 발생.
 *    - 대신 변경된(dirty) 플레이어만 모아 SNAPSHOT_INTERVAL_MS 마다 한 번에 전송.
 *    - 움직임이 없으면 타이머도 돌지 않아 hibernation 을 방해하지 않음.
 */
import { DurableObject } from "cloudflare:workers";
import {
  MAX_NAME_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  SNAPSHOT_INTERVAL_MS,
  WORLD_BOUNDS,
  type ClientMessage,
  type PlayerInfo,
  type PlayerState,
  type Role,
  type ServerMessage,
  type Vec3,
} from "@quiz/shared";
import type { Env } from "./env";

/** 소켓에 붙여 hibernation 후에도 살아남는 상태 (최대 2KB) */
interface SocketAttachment {
  id: string;
  role: Role;
  /** role === "player" 일 때만 존재 */
  player?: PlayerInfo;
}

const COLORS = [
  "#ff5c8a", "#ffb84d", "#ffe14d", "#7ae582", "#4dd9ff",
  "#6c8cff", "#b07cff", "#ff7ce0", "#ff8a5c", "#5cffc8",
];
const SPAWN_RADIUS = 6;

export class GameRoom extends DurableObject<Env> {
  private roomId = "unknown";
  /** WebSocket → 상태 (메모리 캐시; 원본은 attachment) */
  private sessions = new Map<WebSocket, SocketAttachment>();
  /** 다음 스냅샷에 포함할 플레이어 id */
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Hibernation 에서 깨어난 경우: 기존 소켓들의 상태 복원
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (att) this.sessions.set(ws, att);
    }

    // 클라이언트 ping 에 DO 를 깨우지 않고 자동 응답 (연결 유지용)
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("__ping__", "__pong__"),
    );

    this.ctx.blockConcurrencyWhile(async () => {
      this.roomId = (await this.ctx.storage.get<string>("roomId")) ?? "unknown";
    });
  }

  // ───────────── 접속 처리 ─────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const roomId = request.headers.get("X-Room-Id");
    if (roomId && roomId !== this.roomId) {
      this.roomId = roomId;
      await this.ctx.storage.put("roomId", roomId);
    }

    const role = parseRole(url.searchParams.get("role"));
    if (!role) return new Response("Invalid role", { status: 400 });

    if (role === "player" && this.playerCount() >= MAX_PLAYERS_PER_ROOM) {
      return new Response("Room is full", { status: 429 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const id = crypto.randomUUID();
    const attachment: SocketAttachment = { id, role };

    if (role === "player") {
      attachment.player = {
        id,
        name: sanitizeName(url.searchParams.get("name")),
        color: COLORS[this.playerCount() % COLORS.length],
        p: randomSpawn(),
        r: 0,
      };
    }

    // tags 로 역할별 소켓 조회 가능 (ctx.getWebSockets("display") 등)
    this.ctx.acceptWebSocket(server, [role, id]);
    server.serializeAttachment(attachment);
    this.sessions.set(server, attachment);

    // 1) 본인에게 현재 방 상태 전달
    this.send(server, {
      type: "welcome",
      roomId: this.roomId,
      selfId: id,
      role,
      players: this.playerList(),
    });

    // 2) 다른 모든 클라이언트에게 신규 플레이어 알림
    if (attachment.player) {
      this.broadcast({ type: "player_joined", player: attachment.player }, server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ───────────── Hibernation 핸들러 ─────────────

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const session = this.sessions.get(ws);
    if (!session) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      this.send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      case "move": {
        const player = session.player;
        if (!player) {
          this.send(ws, { type: "error", message: "Only players can move" });
          return;
        }
        const p = sanitizeVec3(msg.p);
        if (!p || !Number.isFinite(msg.r)) return; // 비정상 값은 조용히 무시
        player.p = p;
        player.r = msg.r;
        this.dirty.add(player.id);
        this.scheduleFlush();
        break;
      }
      case "ping":
        this.send(ws, { type: "pong", t: msg.t, serverTime: Date.now() });
        break;
      default:
        this.send(ws, { type: "error", message: "Unknown message type" });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string): Promise<void> {
    this.removeSession(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, "closed");
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.removeSession(ws);
  }

  // ───────────── 스냅샷 배치 브로드캐스트 ─────────────

  private scheduleFlush() {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, SNAPSHOT_INTERVAL_MS);
  }

  private flush() {
    if (this.dirty.size === 0) return;

    const players: PlayerState[] = [];
    for (const [ws, session] of this.sessions) {
      const pl = session.player;
      if (!pl || !this.dirty.has(pl.id)) continue;
      players.push({ id: pl.id, p: pl.p, r: pl.r });
      // 최신 위치를 attachment 에 저장 → hibernation 후에도 마지막 위치 유지
      ws.serializeAttachment(session);
    }
    this.dirty.clear();

    if (players.length > 0) {
      this.broadcast({ type: "snapshot", t: Date.now(), players });
    }
  }

  // ───────────── 헬퍼 ─────────────

  private removeSession(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session) return;
    this.sessions.delete(ws);
    if (session.player) {
      this.dirty.delete(session.player.id);
      this.broadcast({ type: "player_left", id: session.player.id });
    }
  }

  private playerCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.player) n++;
    return n;
  }

  private playerList(): PlayerInfo[] {
    const list: PlayerInfo[] = [];
    for (const s of this.sessions.values()) if (s.player) list.push(s.player);
    return list;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 끊긴 소켓 — close 핸들러에서 정리됨
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.sessions.keys()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }
}

// ───────────── 순수 함수 유틸 ─────────────

function parseRole(value: string | null): Role | null {
  if (value === null) return "player";
  return value === "player" || value === "admin" || value === "display" ? value : null;
}

function sanitizeName(raw: string | null): string {
  const name = (raw ?? "").trim().slice(0, MAX_NAME_LENGTH);
  return name || `Guest-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function sanitizeVec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(Number);
  if (!out.every(Number.isFinite)) return null;
  const clamp = (n: number) => Math.max(-WORLD_BOUNDS, Math.min(WORLD_BOUNDS, n));
  return [clamp(out[0]), clamp(out[1]), clamp(out[2])];
}

function randomSpawn(): Vec3 {
  const a = Math.random() * Math.PI * 2;
  const d = Math.random() * SPAWN_RADIUS;
  return [Math.cos(a) * d, 2, Math.sin(a) * d];
}
