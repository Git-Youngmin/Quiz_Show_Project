/**
 * GameRoom — 방(Room) 하나 = 인스턴스 하나. 모든 상태는 서버 메모리에 보관한다.
 *
 * 설계 포인트
 * 1. 소켓별 상태는 Map<WebSocket, Session>, 게임 상태는 필드로 보관
 *    (서버 재시작 시 방 상태는 초기화됨 — 무료 호스팅 환경에서 허용 가능한 트레이드오프)
 * 2. 위치 브로드캐스트는 "배치 스냅샷" (dirty 플레이어만 SNAPSHOT_INTERVAL_MS 마다)
 * 3. 게임 진행 타이머는 setTimeout 하나(phaseTimer)로 단계 전환
 *    waiting → countdown → question_active → reveal → elimination → waiting | game_over
 * 4. 퀴즈 유형: OX(좌우 2분할) / MULTIPLE(십자 4분할) — 구역 판정은 shared 의 zoneAt()
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import {
  BARRIER_LEAD_MS,
  CHARACTER_COLORS,
  FELL_Y,
  INITIAL_GAME_STATE,
  MAX_CHOICE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  MAX_QUESTION_LENGTH,
  PHASE_DURATION_MS,
  SNAPSHOT_INTERVAL_MS,
  TIME_LIMIT_SEC,
  WORLD_BOUNDS,
  ZONES,
  isCharacterColor,
  isCharacterShape,
  zoneAt,
  type Answer,
  type Choices,
  type ClientMessage,
  type GameState,
  type PlayerInfo,
  type PlayerState,
  type QuizType,
  type Role,
  type ServerMessage,
  type Vec3,
} from "@quiz/shared";

interface Session {
  id: string;
  role: Role;
  /** role === "player" 일 때만 존재 */
  player?: PlayerInfo;
}

const SPAWN_RADIUS = 6;

export class GameRoom {
  private sessions = new Map<WebSocket, Session>();
  /** 다음 스냅샷에 포함할 플레이어 id */
  private dirty = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  /** 현재 단계 종료 시 다음 단계로 넘기는 타이머 */
  private phaseTimer: NodeJS.Timeout | null = null;

  private game: GameState = { ...INITIAL_GAME_STATE };
  /** 출제된 정답 — reveal 전까지 클라이언트에 보내지 않음 */
  private secretAnswer: Answer | null = null;
  /** reveal 시작(=차단벽이 완전히 올라온 뒤) 시점의 플레이어별 구역 — 판정 기준 */
  private lockedZones = new Map<string, Answer>();
  /** 방장 비밀번호 (평문 대신 scrypt 해시 + salt 만 메모리에 보관) */
  private adminSecret: { salt: Buffer; hash: Buffer } | null = null;

  constructor(
    readonly roomId: string,
    /** 마지막 연결이 끊겼을 때 호출 (방 정리 예약용) */
    private readonly onEmpty: () => void,
  ) {}

  // ───────────── 관리자 비밀번호 ─────────────

  hasAdminPassword() {
    return this.adminSecret !== null;
  }

  /** 방 생성 시 1회만 설정 가능. 이미 설정돼 있으면 false */
  setAdminPassword(password: string): boolean {
    if (this.adminSecret) return false;
    const salt = randomBytes(16);
    this.adminSecret = { salt, hash: scryptSync(password, salt, 32) };
    return true;
  }

  verifyAdminPassword(password: string): boolean {
    if (!this.adminSecret) return false;
    const hash = scryptSync(password, this.adminSecret.salt, 32);
    return timingSafeEqual(hash, this.adminSecret.hash); // 타이밍 공격 방지
  }

  // ───────────── 접속 처리 ─────────────

  /** 업그레이드 전에 입장 가능 여부 확인. 거부 사유를 반환 */
  canJoin(params: URLSearchParams): { code: number; message: string } | null {
    const role = parseRole(params.get("role"));
    if (!role) return { code: 400, message: "Bad Request" };
    if (role === "player" && this.playerCount() >= MAX_PLAYERS_PER_ROOM) {
      return { code: 429, message: "Room Full" };
    }
    return null;
  }

  join(ws: WebSocket, params: URLSearchParams) {
    const role = parseRole(params.get("role")) ?? "player";
    const id = crypto.randomUUID();
    const session: Session = { id, role };

    if (role === "player") {
      const shape = params.get("shape");
      const color = params.get("color");
      session.player = {
        id,
        name: sanitizeName(params.get("name")),
        color: isCharacterColor(color)
          ? color.toLowerCase()
          : CHARACTER_COLORS[this.playerCount() % CHARACTER_COLORS.length],
        characterShape: isCharacterShape(shape) ? shape : "capsule",
        // 문제 진행 중 난입한 플레이어는 관전으로 시작
        alive: this.game.phase === "waiting",
        p: randomSpawn(),
        r: 0,
      };
    }
    this.sessions.set(ws, session);

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      this.onMessage(ws, data.toString());
    });
    ws.on("close", () => this.removeSession(ws));
    ws.on("error", () => this.removeSession(ws));

    this.send(ws, {
      type: "welcome",
      roomId: this.roomId,
      selfId: id,
      role,
      players: this.playerList(),
      game: this.game,
      serverTime: Date.now(),
    });
    if (session.player) {
      this.broadcast({ type: "player_joined", player: session.player }, ws);
    }
  }

  isEmpty() {
    return this.sessions.size === 0;
  }

  dispose() {
    this.clearPhaseTimer();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const ws of this.sessions.keys()) ws.close(1001, "room closed");
    this.sessions.clear();
  }

  // ───────────── 메시지 처리 ─────────────

  private onMessage(ws: WebSocket, raw: string) {
    const session = this.sessions.get(ws);
    if (!session) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    switch (msg?.type) {
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

      case "fell":
        // 대기/종료 중 낙사는 클라이언트가 리스폰 처리 → 탈락 아님
        if (session.player?.alive && this.isQuestionInProgress()) {
          this.eliminate([session.player.id]);
        }
        break;

      case "admin_start_question":
        if (!this.requireAdmin(ws, session)) return;
        this.startQuestion(ws, msg as unknown as Record<string, unknown>);
        break;

      case "admin_reset":
        if (!this.requireAdmin(ws, session)) return;
        this.resetRound();
        break;

      default:
        this.send(ws, { type: "error", message: "Unknown message type" });
    }
  }

  // ───────────── 게임 진행 (관리자 명령) ─────────────

  private requireAdmin(ws: WebSocket, session: Session): boolean {
    if (session.role === "admin") return true;
    this.send(ws, { type: "error", message: "Admin only" });
    return false;
  }

  private isQuestionInProgress() {
    return this.game.phase !== "waiting" && this.game.phase !== "game_over";
  }

  private startQuestion(ws: WebSocket, msg: Record<string, unknown>) {
    const fail = (message: string) => this.send(ws, { type: "error", message });

    if (this.game.phase === "game_over") return fail("게임이 끝났습니다. 라운드 리셋 후 새 게임을 시작하세요");
    if (this.game.phase !== "waiting") return fail("이미 문제가 진행 중입니다");

    const quizType: QuizType = msg.quizType === "MULTIPLE" ? "MULTIPLE" : "OX";
    const question = typeof msg.question === "string" ? msg.question.trim().slice(0, MAX_QUESTION_LENGTH) : "";
    if (!question) return fail("질문을 입력하세요");

    const answer = msg.answer as Answer;
    if (!ZONES[quizType].includes(answer)) {
      return fail(quizType === "OX" ? "정답은 O 또는 X 여야 합니다" : "정답은 A~D 중 하나여야 합니다");
    }

    let choices: Choices | null = null;
    if (quizType === "MULTIPLE") {
      const raw = msg.choices;
      if (!Array.isArray(raw) || raw.length !== 4) return fail("보기 4개를 모두 입력하세요");
      const cleaned = raw.map((c) => (typeof c === "string" ? c.trim().slice(0, MAX_CHOICE_LENGTH) : ""));
      if (cleaned.some((c) => !c)) return fail("보기 4개를 모두 입력하세요");
      choices = cleaned as Choices;
    }

    const sec = Number.isFinite(msg.timeLimitSec) ? Number(msg.timeLimitSec) : TIME_LIMIT_SEC.default;
    this.secretAnswer = answer;
    this.setPhase(
      {
        phase: "countdown",
        round: this.game.round + 1,
        quizType,
        question,
        choices,
        answer: null,
        droppedZones: [],
        timeLimitSec: Math.round(Math.max(TIME_LIMIT_SEC.min, Math.min(TIME_LIMIT_SEC.max, sec))),
      },
      PHASE_DURATION_MS.countdown,
    );
  }

  /** 진행 중단 + 전원 부활 + 새 스폰 위치 배정 */
  private resetRound() {
    this.clearPhaseTimer();
    this.secretAnswer = null;
    this.lockedZones.clear();

    for (const s of this.sessions.values()) {
      if (!s.player) continue;
      s.player.alive = true;
      s.player.p = randomSpawn();
      s.player.r = 0;
    }
    this.dirty.clear();
    this.broadcast({ type: "round_reset", players: this.playerList() });

    // 보드 모양(quizType)은 유지해서 리셋 직후 바닥이 바뀌지 않게
    this.setPhase({ ...INITIAL_GAME_STATE, round: this.game.round, quizType: this.game.quizType }, null);
  }

  // ───────────── 단계 전환 (setTimeout) ─────────────

  /** 현재 단계가 끝나면 호출 → 다음 단계로 */
  private advancePhase() {
    const now = Date.now();

    switch (this.game.phase) {
      case "countdown": {
        const durationMs = this.game.timeLimitSec * 1000;
        // 차단벽은 제한 시간 종료 BARRIER_LEAD_MS 전에 솟아오름 (클라이언트가 서버 시계로 맞춰 연출)
        const barrierRaisesAt = now + Math.max(0, durationMs - BARRIER_LEAD_MS);
        this.setPhase({ phase: "question_active", barrierRaisesAt }, durationMs);
        break;
      }

      case "question_active": {
        // 시간 종료 → 정답 공개. 이 시점엔 벽이 이미 올라와 있으므로 구역을 확정(lock)
        this.lockedZones.clear();
        for (const s of this.sessions.values()) {
          const pl = s.player;
          if (pl?.alive) this.lockedZones.set(pl.id, zoneAt(this.game.quizType, pl.p[0], pl.p[2]));
        }
        this.setPhase({ phase: "reveal", answer: this.secretAnswer }, PHASE_DURATION_MS.reveal);
        break;
      }

      case "reveal": {
        // 정답이 아닌 모든 구역의 바닥이 꺼지고, 그 구역에 있던 플레이어 탈락
        const type = this.game.quizType;
        const answer = this.secretAnswer ?? ZONES[type][0];
        const droppedZones = ZONES[type].filter((z) => z !== answer);
        const losers: string[] = [];
        for (const s of this.sessions.values()) {
          const pl = s.player;
          if (!pl?.alive) continue;
          // 확정된 구역 기준 (벽이 올라온 뒤 순간이동 같은 조작은 무시).
          // reveal 도중 난입 등 lock 이 없으면 현재 위치로 판정
          const zone = this.lockedZones.get(pl.id) ?? zoneAt(type, pl.p[0], pl.p[2]);
          if (zone !== answer || pl.p[1] < FELL_Y) losers.push(pl.id);
        }
        // 상태를 먼저 보내 바닥 꺼짐 연출이 시작되게 한 뒤 탈락자 통보
        this.setPhase({ phase: "elimination", droppedZones }, PHASE_DURATION_MS.elimination);
        this.eliminate(losers);
        break;
      }

      case "elimination": {
        this.secretAnswer = null;
        this.lockedZones.clear();
        const survivors = this.playerList().filter((p) => p.alive);
        if (survivors.length <= 1) {
          // 최후의 1인 (또는 전원 탈락) → 게임 종료. 관리자 리셋 전까지 유지
          this.setPhase(
            { phase: "game_over", winnerId: survivors[0]?.id ?? null, droppedZones: [], barrierRaisesAt: null },
            null,
          );
        } else {
          // 바닥 복구 + 벽 내림 → 다음 문제 대기 (생존자 유지)
          this.setPhase(
            { phase: "waiting", question: null, choices: null, answer: null, droppedZones: [], barrierRaisesAt: null },
            null,
          );
        }
        break;
      }

      case "waiting":
      case "game_over":
        break;
    }
  }

  /**
   * 게임 상태 변경 + 다음 단계 타이머 예약 + 전체 브로드캐스트
   * @param durationMs 이 단계의 지속 시간. null 이면 타이머 없음(무기한)
   */
  private setPhase(patch: Partial<GameState>, durationMs: number | null) {
    this.clearPhaseTimer();
    const phaseEndsAt = durationMs === null ? null : Date.now() + durationMs;
    this.game = { ...this.game, ...patch, phaseEndsAt };
    if (durationMs !== null) {
      this.phaseTimer = setTimeout(() => {
        this.phaseTimer = null;
        this.advancePhase();
      }, durationMs);
    }
    this.broadcast({ type: "game_state", game: this.game, serverTime: Date.now() });
  }

  private clearPhaseTimer() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
  }

  private eliminate(ids: string[]) {
    const out: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.player?.alive && ids.includes(s.player.id)) {
        s.player.alive = false;
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
    for (const s of this.sessions.values()) {
      const pl = s.player;
      if (pl && this.dirty.has(pl.id)) players.push({ id: pl.id, p: pl.p, r: pl.r });
    }
    this.dirty.clear();
    if (players.length > 0) this.broadcast({ type: "snapshot", t: Date.now(), players });
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
    if (this.sessions.size === 0) this.onEmpty();
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
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const ws of this.sessions.keys()) {
      if (ws !== except && ws.readyState === ws.OPEN) ws.send(data);
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
