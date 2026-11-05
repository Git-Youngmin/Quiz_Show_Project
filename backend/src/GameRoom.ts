/**
 * GameRoom — 방(Room) 하나 = 인스턴스 하나. 모든 상태는 서버 메모리에 보관한다.
 *
 * 설계 포인트
 * 1. 소켓별 상태는 Map<WebSocket, Session>, 게임 상태는 필드로 보관
 *    (서버 재시작 시 방 상태는 초기화됨 — 무료 호스팅 환경에서 허용 가능한 트레이드오프)
 * 2. 위치 브로드캐스트는 "배치 스냅샷" (dirty 플레이어만 SNAPSHOT_INTERVAL_MS 마다)
 * 3. 게임 진행 타이머는 setTimeout 하나(phaseTimer)로 단계 전환 (카훗 스타일 퀴즈 세트)
 *    waiting ─(admin_start_game)→ countdown → question_active → reveal → elimination
 *      → round_standings ─(admin_next_question)→ countdown … → game_over
 * 4. 퀴즈 유형: OX(좌우 2분할) / MULTIPLE(십자 4분할) — 구역 판정은 shared 의 zoneAt()
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import {
  BARRIER_LEAD_MS,
  BOARD_SIZE,
  GRAVITY,
  ITEM_KINDS,
  THROW_COOLDOWN_MS,
  THROW_PADS,
  isOnThrowPad,
  throwOrigin,
  CHARACTER_COLORS,
  FELL_Y,
  INITIAL_GAME_STATE,
  MAX_CHOICE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  MAX_QUESTION_LENGTH,
  MAX_QUIZ_ITEMS,
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
  type QuizItem,
  type QuizType,
  type Role,
  type ServerMessage,
  type ThrownItem,
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
  /** 이번 게임의 퀴즈 세트 (서버만 보관 — 클라이언트에는 진행 중인 문제만 공개) */
  private quizzes: QuizItem[] = [];
  /** 이번 라운드(문제)에서 탈락한 인원 — round_standings 에 표시 */
  private eliminatedThisRound = 0;
  /** reveal 시작(=차단벽이 완전히 올라온 뒤) 시점의 플레이어별 구역 — 판정 기준 */
  private lockedZones = new Map<string, Answer>();
  /** 방해물 투척 쿨타임 */
  private lastThrowAt = 0;
  private lastThrowByPlayer = new Map<string, number>();
  private nextItemId = 1;
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

  /** 업그레이드 전에 입장 가능 여부 확인 (잘못된 role) */
  isValidRole(params: URLSearchParams): boolean {
    return parseRole(params.get("role")) !== null;
  }

  /** 참가자 정원 초과 여부 (관리자/송출 화면은 정원에 포함되지 않음) */
  isFull(): boolean {
    return this.playerCount() >= MAX_PLAYERS_PER_ROOM;
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

      case "throw_item":
        this.throwItem(ws, session, msg.pad);
        break;

      case "admin_start_game":
        if (!this.requireAdmin(ws, session)) return;
        this.startGame(ws, (msg as { quizzes?: unknown }).quizzes);
        break;

      case "admin_next_question":
        if (!this.requireAdmin(ws, session)) return;
        this.nextQuestion(ws);
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

  /** 문제가 진행 중인지 (이때 떨어지면 탈락). 로비/라운드 결과/게임 종료 중에는 리스폰 */
  private isQuestionInProgress() {
    const p = this.game.phase;
    return p !== "waiting" && p !== "round_standings" && p !== "game_over";
  }

  /** 퀴즈 세트로 게임 시작: 전원 부활 + 재배치 후 1번 문제 카운트다운 */
  private startGame(ws: WebSocket, raw: unknown) {
    const fail = (message: string) => this.send(ws, { type: "error", message });
    if (this.game.phase !== "waiting" && this.game.phase !== "game_over") {
      return fail("게임이 진행 중입니다. 중단하려면 '게임 중단(리셋)'을 누르세요");
    }
    if (!Array.isArray(raw) || raw.length === 0) return fail("문제를 1개 이상 추가하세요");
    if (raw.length > MAX_QUIZ_ITEMS) return fail(`문제는 최대 ${MAX_QUIZ_ITEMS}개까지 가능합니다`);

    const quizzes: QuizItem[] = [];
    for (let i = 0; i < raw.length; i++) {
      const res = validateQuiz(raw[i]);
      if (typeof res === "string") return fail(`${i + 1}번 문제: ${res}`);
      quizzes.push(res);
    }

    this.quizzes = quizzes;
    this.revivePlayers();
    this.beginQuestion(0);
  }

  /** round_standings 에서 다음 문제로 */
  private nextQuestion(ws: WebSocket) {
    if (this.game.phase !== "round_standings") {
      this.send(ws, { type: "error", message: "라운드 결과 화면에서만 다음 문제를 낼 수 있습니다" });
      return;
    }
    this.beginQuestion(this.game.round); // round 는 1부터 → 다음 문제의 인덱스
  }

  private beginQuestion(index: number) {
    const q = this.quizzes[index];
    if (!q) return;
    this.secretAnswer = q.answer;
    this.eliminatedThisRound = 0;
    this.setPhase(
      {
        phase: "countdown",
        round: index + 1,
        totalQuestions: this.quizzes.length,
        quizType: q.quizType,
        question: q.question,
        choices: q.quizType === "MULTIPLE" ? q.choices : null,
        answer: null,
        droppedZones: [],
        barrierRaisesAt: null,
        winnerId: null,
        lastEliminatedCount: 0,
        timeLimitSec: q.timeLimitSec,
      },
      PHASE_DURATION_MS.countdown,
    );
  }

  /** 전원 부활 + 새 스폰 위치 (클라이언트는 round_reset 으로 내 캐릭터를 새 위치에 재생성) */
  private revivePlayers() {
    for (const s of this.sessions.values()) {
      if (!s.player) continue;
      s.player.alive = true;
      s.player.p = randomSpawn();
      s.player.r = 0;
    }
    this.dirty.clear();
    this.broadcast({ type: "round_reset", players: this.playerList() });
  }

  /** 진행 중단 + 전원 부활 → 로비(waiting) */
  private resetRound() {
    this.clearPhaseTimer();
    this.secretAnswer = null;
    this.lockedZones.clear();
    this.quizzes = [];
    this.revivePlayers();
    // 보드 모양(quizType)은 유지해서 리셋 직후 바닥이 바뀌지 않게
    this.setPhase({ ...INITIAL_GAME_STATE, quizType: this.game.quizType }, null);
  }

  // ───────────── 방해물 투척 (탈락자 전용) ─────────────

  private throwItem(ws: WebSocket, session: Session, pad: unknown) {
    const pl = session.player;
    // 생존자/관리자/송출은 던질 수 없음 (조용히 무시)
    if (!pl || pl.alive) return;
    if (typeof pad !== "number" || !Number.isInteger(pad) || !THROW_PADS[pad]) return;

    // 위치 검증: 서버가 마지막으로 받은 위치가 해당 발판 위여야 함 (스냅샷 지연을 고려해 여유 있게)
    if (!isOnThrowPad(pad, pl.p)) return;

    // 쿨타임: 유저당 2초 + 방 전체 0.5초 (무한 투척으로 인한 부하/렌더링 저하 방지)
    const now = Date.now();
    const playerReady = (this.lastThrowByPlayer.get(pl.id) ?? 0) + THROW_COOLDOWN_MS.perPlayer;
    const roomReady = this.lastThrowAt + THROW_COOLDOWN_MS.room;
    const readyAt = Math.max(playerReady, roomReady);
    if (now < readyAt) {
      this.send(ws, { type: "throw_cooldown", retryInMs: readyAt - now });
      return;
    }
    this.lastThrowAt = now;
    this.lastThrowByPlayer.set(pl.id, now);

    const origin = throwOrigin(pad);
    const target = this.pickThrowTarget();
    // 중력이 세서(30) 비행 시간을 짧게 → 빠르고 날카로운 포물선
    const { direction, speed } = ballistic(origin, target, 0.95 + Math.random() * 0.3);
    const item: ThrownItem = {
      id: this.nextItemId++,
      kind: pickItemKind(),
      origin,
      direction,
      speed,
      throwerId: pl.id,
      spawnedAt: now,
    };
    this.broadcast({ type: "item_spawned", item });
  }

  /** 노릴 지점: 70% 확률로 보드 위 생존자 근처, 아니면 보드 위 아무 곳 */
  private pickThrowTarget(): Vec3 {
    const half = BOARD_SIZE / 2 - 2;
    const survivors = this.playerList().filter((p) => p.alive && p.p[1] > FELL_Y);
    if (survivors.length > 0 && Math.random() < 0.7) {
      const s = survivors[Math.floor(Math.random() * survivors.length)];
      const jitter = () => (Math.random() - 0.5) * 3;
      return [clampN(s.p[0] + jitter(), -half, half), 0.6, clampN(s.p[2] + jitter(), -half, half)];
    }
    return [(Math.random() * 2 - 1) * half, 0.6, (Math.random() * 2 - 1) * half];
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
        const outOfQuestions = this.game.round >= this.quizzes.length;
        const common = {
          droppedZones: [],
          barrierRaisesAt: null,
          lastEliminatedCount: this.eliminatedThisRound,
        } satisfies Partial<GameState>;
        if (survivors.length <= 1 || outOfQuestions) {
          // 최후의 1인 / 전원 탈락 / 문제 소진 → 게임 종료.
          // 문제를 다 썼는데 여러 명이 살아남았으면 공동 생존 (winnerId = null, 배너에서 생존자 수 표시)
          this.setPhase(
            { ...common, phase: "game_over", winnerId: survivors.length === 1 ? survivors[0].id : null },
            null,
          );
        } else {
          // 바닥 복구 + 벽 내림 → 라운드 결과 화면에서 관리자의 "다음 문제" 대기
          this.setPhase({ ...common, phase: "round_standings", answer: this.game.answer }, null);
        }
        break;
      }

      case "waiting":
      case "round_standings":
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
    this.eliminatedThisRound += out.length;
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
    this.lastThrowByPlayer.delete(session.id);
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

/** 퀴즈 세트의 문제 하나를 검증·정리. 문제가 있으면 사유 문자열 반환 */
function validateQuiz(raw: unknown): QuizItem | string {
  if (!raw || typeof raw !== "object") return "형식이 올바르지 않습니다";
  const m = raw as Record<string, unknown>;
  const quizType: QuizType = m.quizType === "MULTIPLE" ? "MULTIPLE" : "OX";
  const question = typeof m.question === "string" ? m.question.trim().slice(0, MAX_QUESTION_LENGTH) : "";
  if (!question) return "질문이 비어 있습니다";
  const sec = Number.isFinite(m.timeLimitSec) ? Number(m.timeLimitSec) : TIME_LIMIT_SEC.default;
  const timeLimitSec = Math.round(Math.max(TIME_LIMIT_SEC.min, Math.min(TIME_LIMIT_SEC.max, sec)));
  const answer = m.answer as Answer;
  if (!ZONES[quizType].includes(answer)) {
    return quizType === "OX" ? "정답은 O 또는 X 여야 합니다" : "정답은 A~D 중 하나여야 합니다";
  }
  if (quizType === "OX") return { quizType, question, answer: answer as "O" | "X", timeLimitSec };
  if (!Array.isArray(m.choices) || m.choices.length !== 4) return "보기 4개를 모두 입력하세요";
  const choices = m.choices.map((c) => (typeof c === "string" ? c.trim().slice(0, MAX_CHOICE_LENGTH) : ""));
  if (choices.some((c) => !c)) return "보기 4개를 모두 입력하세요";
  return { quizType, question, answer: answer as "A" | "B" | "C" | "D", choices: choices as Choices, timeLimitSec };
}

/** 방해물 종류: 바나나 50% · 상자 25% · 공 25% */
function pickItemKind() {
  const r = Math.random();
  return r < 0.5 ? ITEM_KINDS[0] : r < 0.75 ? ITEM_KINDS[1] : ITEM_KINDS[2];
}

function clampN(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * origin 에서 target 까지 flightSec 초 동안 날아가는 포물선의 초기 속도.
 *   v = (T - O) / t + ½·g·t (y 성분만 중력 보정)
 */
function ballistic(origin: Vec3, target: Vec3, flightSec: number): { direction: Vec3; speed: number } {
  const t = flightSec;
  const v: Vec3 = [
    (target[0] - origin[0]) / t,
    (target[1] - origin[1]) / t + 0.5 * GRAVITY * t,
    (target[2] - origin[2]) / t,
  ];
  const speed = Math.hypot(v[0], v[1], v[2]);
  return { direction: [v[0] / speed, v[1] / speed, v[2] / speed], speed };
}

function randomSpawn(): Vec3 {
  const a = Math.random() * Math.PI * 2;
  const d = Math.random() * SPAWN_RADIUS;
  return [Math.cos(a) * d, 2, Math.sin(a) * d];
}
