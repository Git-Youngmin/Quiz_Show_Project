/**
 * GameRoom Durable Object — 방(Room) 하나 = 인스턴스 하나.
 *
 * 설계 포인트
 * 1. WebSocket Hibernation API (ctx.acceptWebSocket)
 *    - 메시지가 없으면 DO 가 메모리에서 내려가도(hibernate) 연결은 유지됨.
 *    - 소켓별 상태는 serializeAttachment 에, 게임 상태는 ctx.storage 에 보관하고
 *      생성자에서 복원한다.
 * 2. 위치 브로드캐스트는 "배치 스냅샷" (dirty 플레이어만 SNAPSHOT_INTERVAL_MS 마다)
 * 3. 게임 진행 타이머는 setTimeout 이 아닌 **Alarm API** 사용
 *    - 알람은 storage 에 영속되므로 hibernation/재시작 후에도 반드시 실행됨.
 *    - 단계 전환: waiting → countdown → question_active → reveal → elimination → waiting
 */
import { DurableObject } from "cloudflare:workers";
import {
  BARRIER_LEAD_MS,
  FELL_Y,
  INITIAL_GAME_STATE,
  MAX_NAME_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  MAX_QUESTION_LENGTH,
  PHASE_DURATION_MS,
  SNAPSHOT_INTERVAL_MS,
  TIME_LIMIT_SEC,
  WORLD_BOUNDS,
  zoneOfX,
  type Answer,
  type ClientMessage,
  type GameState,
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

/** storage 에 저장하는 게임 상태 (공개 상태 + 비공개 정답) */
interface StoredGame {
  public: GameState;
  /** 출제된 정답 — reveal 전까지 클라이언트에 보내지 않음 */
  secretAnswer: Answer | null;
  /** reveal 시작(=차단벽이 완전히 올라온 뒤) 시점의 플레이어별 구역 — 판정 기준 */
  lockedZones: Record<string, Answer>;
}

const COLORS = [
  "#ff5c8a", "#ffb84d", "#ffe14d", "#7ae582", "#4dd9ff",
  "#6c8cff", "#b07cff", "#ff7ce0", "#ff8a5c", "#5cffc8",
];
const SPAWN_RADIUS = 6;
const GAME_KEY = "game";

export class GameRoom extends DurableObject<Env> {
  private roomId = "unknown";
  /** WebSocket → 상태 (메모리 캐시; 원본은 attachment) */
  private sessions = new Map<WebSocket, SocketAttachment>();
  /** 다음 스냅샷에 포함할 플레이어 id */
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private game: GameState = { ...INITIAL_GAME_STATE };
  private secretAnswer: Answer | null = null;
  private lockedZones: Record<string, Answer> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Hibernation 에서 깨어난 경우: 기존 소켓들의 상태 복원
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (att) this.sessions.set(ws, att);
    }

    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("__ping__", "__pong__"),
    );

    this.ctx.blockConcurrencyWhile(async () => {
      this.roomId = (await this.ctx.storage.get<string>("roomId")) ?? "unknown";
      const stored = await this.ctx.storage.get<StoredGame>(GAME_KEY);
      if (stored) {
        this.game = stored.public;
        this.secretAnswer = stored.secretAnswer;
        this.lockedZones = stored.lockedZones ?? {};
      }
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
        // 문제 진행 중 난입한 플레이어는 관전으로 시작
        alive: this.game.phase === "waiting",
        p: randomSpawn(),
        r: 0,
      };
    }

    this.ctx.acceptWebSocket(server, [role, id]);
    server.serializeAttachment(attachment);
    this.sessions.set(server, attachment);

    this.send(server, {
      type: "welcome",
      roomId: this.roomId,
      selfId: id,
      role,
      players: this.playerList(),
      game: this.game,
      serverTime: Date.now(),
    });

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
        if (!p || !Number.isFinite(msg.r)) return;
        player.p = p;
        player.r = msg.r;
        this.dirty.add(player.id);
        this.scheduleFlush();
        break;
      }

      case "ping":
        this.send(ws, { type: "pong", t: msg.t, serverTime: Date.now() });
        break;

      case "fell": {
        // 대기 중 낙사는 클라이언트가 리스폰 처리 → 탈락 아님
        if (session.player?.alive && this.game.phase !== "waiting") {
          this.eliminate([session.player.id]);
        }
        break;
      }

      case "admin_start_question":
        if (!this.requireAdmin(ws, session)) return;
        await this.startQuestion(ws, msg.question, msg.answer, msg.timeLimitSec);
        break;

      case "admin_reset":
        if (!this.requireAdmin(ws, session)) return;
        await this.resetRound();
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

  // ───────────── 게임 진행 (관리자 명령) ─────────────

  private requireAdmin(ws: WebSocket, session: SocketAttachment): boolean {
    if (session.role === "admin") return true;
    this.send(ws, { type: "error", message: "Admin only" });
    return false;
  }

  private async startQuestion(ws: WebSocket, rawQuestion: unknown, answer: unknown, timeLimit: unknown) {
    if (this.game.phase === "game_over") {
      this.send(ws, { type: "error", message: "게임이 끝났습니다. 라운드 리셋 후 새 게임을 시작하세요" });
      return;
    }
    if (this.game.phase !== "waiting") {
      this.send(ws, { type: "error", message: "이미 문제가 진행 중입니다" });
      return;
    }
    const question = typeof rawQuestion === "string" ? rawQuestion.trim().slice(0, MAX_QUESTION_LENGTH) : "";
    if (!question) {
      this.send(ws, { type: "error", message: "질문을 입력하세요" });
      return;
    }
    if (answer !== "O" && answer !== "X") {
      this.send(ws, { type: "error", message: "정답은 O 또는 X 여야 합니다" });
      return;
    }
    const sec = Number.isFinite(timeLimit) ? Number(timeLimit) : TIME_LIMIT_SEC.default;

    this.secretAnswer = answer;
    await this.setPhase({
      phase: "countdown",
      round: this.game.round + 1,
      question,
      answer: null,
      droppedZone: null,
      timeLimitSec: Math.round(Math.max(TIME_LIMIT_SEC.min, Math.min(TIME_LIMIT_SEC.max, sec))),
    }, PHASE_DURATION_MS.countdown);
  }

  /** 진행 중단 + 전원 부활 + 새 스폰 위치 배정 */
  private async resetRound() {
    await this.ctx.storage.deleteAlarm();
    this.secretAnswer = null;
    this.lockedZones = {};

    for (const [ws, s] of this.sessions) {
      if (!s.player) continue;
      s.player.alive = true;
      s.player.p = randomSpawn();
      s.player.r = 0;
      ws.serializeAttachment(s);
    }
    this.dirty.clear();
    this.broadcast({ type: "round_reset", players: this.playerList() });

    await this.setPhase({
      ...INITIAL_GAME_STATE,
      round: this.game.round,
    }, null);
  }

  // ───────────── 단계 전환 (Alarm) ─────────────

  /** 알람이 울리면 현재 단계에 따라 다음 단계로 진행 */
  async alarm(): Promise<void> {
    const now = Date.now();
    // 리셋 직후 등 예정 시각 전에 울린 경우 방어
    if (this.game.phaseEndsAt === null) return;
    if (now + 20 < this.game.phaseEndsAt) {
      await this.ctx.storage.setAlarm(this.game.phaseEndsAt);
      return;
    }

    switch (this.game.phase) {
      case "countdown": {
        const durationMs = this.game.timeLimitSec * 1000;
        // 차단벽은 제한 시간 종료 BARRIER_LEAD_MS 전에 솟아오름 (클라이언트가 서버 시계로 맞춰 연출)
        const barrierRaisesAt = now + Math.max(0, durationMs - BARRIER_LEAD_MS);
        await this.setPhase({ phase: "question_active", barrierRaisesAt }, durationMs);
        break;
      }

      case "question_active": {
        // 시간 종료 → 정답 공개. 이 시점엔 벽이 이미 올라와 있으므로 구역을 확정(lock)
        this.lockedZones = {};
        for (const s of this.sessions.values()) {
          const pl = s.player;
          if (pl?.alive) this.lockedZones[pl.id] = zoneOfX(pl.p[0]);
        }
        await this.setPhase({ phase: "reveal", answer: this.secretAnswer }, PHASE_DURATION_MS.reveal);
        break;
      }

      case "reveal": {
        // 오답 구역 판별 → 해당 구역 플레이어 탈락 + 바닥 꺼짐
        const answer = this.secretAnswer ?? "O";
        const wrongZone: Answer = answer === "O" ? "X" : "O";
        const losers: string[] = [];
        for (const s of this.sessions.values()) {
          const pl = s.player;
          if (!pl?.alive) continue;
          // 확정된 구역 기준 (벽이 올라온 뒤 순간이동 같은 조작은 무시).
          // reveal 도중 난입한 플레이어 등 lock 이 없으면 현재 위치로 판정
          const zone = this.lockedZones[pl.id] ?? zoneOfX(pl.p[0]);
          if (zone === wrongZone || pl.p[1] < FELL_Y) losers.push(pl.id);
        }
        // 상태를 먼저 보내 바닥 꺼짐 연출이 시작되게 한 뒤 탈락자 통보
        await this.setPhase({ phase: "elimination", droppedZone: wrongZone }, PHASE_DURATION_MS.elimination);
        this.eliminate(losers);
        break;
      }

      case "elimination": {
        this.secretAnswer = null;
        this.lockedZones = {};
        const survivors = this.playerList().filter((p) => p.alive);
        if (survivors.length <= 1) {
          // 최후의 1인 (또는 전원 탈락) → 게임 종료. 관리자 리셋 전까지 유지
          await this.setPhase({
            phase: "game_over",
            winnerId: survivors[0]?.id ?? null,
            droppedZone: null,
            barrierRaisesAt: null,
          }, null);
        } else {
          // 바닥 복구 + 벽 내림 → 다음 문제 대기 (생존자 유지)
          await this.setPhase({
            phase: "waiting",
            question: null,
            answer: null,
            droppedZone: null,
            barrierRaisesAt: null,
          }, null);
        }
        break;
      }

      case "waiting":
      case "game_over":
        break;
    }
  }

  /**
   * 게임 상태 변경 + 저장 + 알람 예약 + 전체 브로드캐스트
   * @param durationMs 이 단계의 지속 시간. null 이면 알람 없음(무기한)
   */
  private async setPhase(patch: Partial<GameState>, durationMs: number | null) {
    const phaseEndsAt = durationMs === null ? null : Date.now() + durationMs;
    this.game = { ...this.game, ...patch, phaseEndsAt };

    await this.ctx.storage.put<StoredGame>(GAME_KEY, {
      public: this.game,
      secretAnswer: this.secretAnswer,
      lockedZones: this.lockedZones,
    });
    if (phaseEndsAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(phaseEndsAt);

    this.broadcast({ type: "game_state", game: this.game, serverTime: Date.now() });
  }

  private eliminate(ids: string[]) {
    const out: string[] = [];
    for (const [ws, s] of this.sessions) {
      if (s.player?.alive && ids.includes(s.player.id)) {
        s.player.alive = false;
        ws.serializeAttachment(s);
        out.push(s.player.id);
      }
    }
    if (out.length > 0) this.broadcast({ type: "players_eliminated", ids: out });
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
