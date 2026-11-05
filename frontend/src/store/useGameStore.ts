/**
 * 게임 전역 상태 + WebSocket 연결 관리 (Zustand).
 *
 * ── 렌더링 성능 설계 ──────────────────────────────────────────────
 * 서버 snapshot 은 15Hz 로 도착한다. 이걸 그대로 React state 로 넣으면
 * players 를 구독하는 모든 컴포넌트가 초당 15번 리렌더된다.
 * 그래서 상태를 두 종류로 나눈다.
 *
 *   playerIds  : 입·퇴장 때만 바뀜 → React 컴포넌트가 구독 (아바타 목록 렌더)
 *   players    : snapshot 마다 바뀜 → 3D 씬에서는 구독하지 말고
 *                useFrame 안에서 useGameStore.getState().players[id] 로 읽기
 *                (UI 디버그 표 처럼 가벼운 곳에서는 구독해도 무방)
 * ─────────────────────────────────────────────────────────────────
 */
import { create } from "zustand";
import {
  CLOSE_CODE,
  INITIAL_GAME_STATE,
  THROW_COOLDOWN_MS,
  wsPath,
  type CharacterShape,
  type ClientMessage,
  type GameState,
  type PlayerInfo,
  type Role,
  type ServerMessage,
  type StartQuestionPayload,
  type ThrownItem,
  type Vec3,
} from "@quiz/shared";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

/** 클라이언트에서 보관하는 플레이어 상태 (보간용 수신 시각 포함) */
export interface ClientPlayer extends PlayerInfo {
  /** 마지막으로 위치를 받은 서버 시각(ms) */
  updatedAt: number;
}

export interface ConnectOptions {
  roomId: string;
  role: Role;
  name?: string;
  /** 로비에서 고른 외형 (player 전용) */
  shape?: CharacterShape;
  color?: string;
  /** 관리자 전용: 방장 비밀번호 */
  password?: string;
}

/** 화면에 존재하는 방해물 (수신 시각은 로컬 시계 — 수명 계산용) */
export interface ActiveObstacle extends ThrownItem {
  receivedAt: number;
}
/** 동시에 존재할 수 있는 최대 방해물 수 (렌더링/물리 부하 상한) */
const MAX_OBSTACLES = 24;

/** 서버가 앱 정의 close code 로 끊은 경우 (재연결하지 않음) */
const FATAL_CLOSE_CODES: number[] = Object.values(CLOSE_CODE);

interface StoreState {
  // ── 연결 상태 ──
  status: ConnectionStatus;
  roomId: string | null;
  role: Role | null;
  selfId: string | null;
  /** 왕복 지연(ms) */
  latency: number | null;
  /** 서버 시계 - 로컬 시계 (ms). 남은 시간 계산에 사용 → serverNow() */
  clockOffset: number;
  lastError: string | null;
  /** 관리자 인증 실패 등 재연결하면 안 되는 종료 사유 (CLOSE_CODE) */
  fatalCloseCode: number | null;

  // ── 월드 상태 ──
  playerIds: string[];
  players: Record<string, ClientPlayer>;

  // ── 게임(퀴즈) 상태 ──
  game: GameState;
  /** round_reset 마다 증가 → 내 캐릭터를 새 스폰 위치에 재생성하는 key 로 사용 */
  spawnVersion: number;

  // ── 탈락자 방해물 ──
  obstacles: ActiveObstacle[];
  /** 내가 다시 던질 수 있는 로컬 시각 (발판 UI 표시용, 실제 판정은 서버) */
  throwReadyAt: number;

  // ── 액션 ──
  connect: (opts: ConnectOptions) => void;
  disconnect: () => void;
  /** 내 캐릭터 위치 전송. 매 프레임 호출해도 내부에서 20Hz 로 스로틀링됨 */
  sendMove: (x: number, y: number, z: number, rotY?: number) => void;
  /** 플레이어: 맵 밖으로 떨어졌음을 서버에 보고 (진행 중이면 탈락) */
  reportFell: () => void;
  /**
   * 탈락자: 투척 발판을 밟음 → 방해물 발사 요청.
   * at = 발판을 밟은 순간의 내 위치 (서버의 "발판 위인지" 검증용으로 요청 직전에 전송)
   */
  throwItem: (pad: number, at?: Vec3) => void;
  /** 수명이 다한 방해물 제거 */
  removeObstacle: (id: number) => void;
  /** 관리자: 문제 출제 (OX / 4지선다) */
  startQuestion: (payload: StartQuestionPayload) => void;
  /** 관리자: 진행 중단 + 전원 부활 */
  resetRound: () => void;
}

// ───────────── 모듈 스코프 (React state 가 아닌 연결 객체) ─────────────

const SEND_INTERVAL_MS = 50; // 최대 20Hz 로 전송 (서버 15Hz 틱보다 약간 빠르게)
const PING_INTERVAL_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 10_000;
/** 이 값보다 작게 움직이면 전송 생략 */
const MOVE_EPSILON = 0.01;

let socket: WebSocket | null = null;
let connectOpts: ConnectOptions | null = null;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
/** disconnect() 로 끊은 경우 재연결하지 않기 위한 플래그 */
let manualClose = false;

let lastSentAt = 0;
let lastSent: { p: Vec3; r: number } | null = null;
let pendingMove: { p: Vec3; r: number } | null = null;
let pendingMoveTimer: ReturnType<typeof setTimeout> | null = null;

function resolveWsUrl({ roomId, role, name, shape, color, password }: ConnectOptions): string {
  // 별도 배포: VITE_WS_BASE=wss://서버주소 / 기본: 현재 host (개발 시 Vite 프록시 → 8787, 배포 시 같은 Node 서버)
  const base =
    import.meta.env.VITE_WS_BASE ??
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  const q = new URLSearchParams({ role });
  if (name) q.set("name", name);
  if (shape) q.set("shape", shape);
  if (color) q.set("color", color);
  if (password) q.set("password", password);
  return `${base.replace(/\/$/, "")}${wsPath(roomId)}?${q}`;
}

function rawSend(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function clearTimers() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pingTimer) clearInterval(pingTimer);
  if (pendingMoveTimer) clearTimeout(pendingMoveTimer);
  reconnectTimer = pingTimer = pendingMoveTimer = null;
  pendingMove = null;
}

function toClientPlayer(p: PlayerInfo): ClientPlayer {
  return { ...p, updatedAt: Date.now() };
}

// ───────────── Store ─────────────

export const useGameStore = create<StoreState>()((set, get) => {
  /** 서버 메시지 → 상태 반영 */
  function handleMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "welcome": {
        const players: Record<string, ClientPlayer> = {};
        for (const p of msg.players) players[p.id] = toClientPlayer(p);
        set({
          selfId: msg.selfId,
          roomId: msg.roomId,
          role: msg.role,
          players,
          playerIds: Object.keys(players),
          game: msg.game,
          clockOffset: msg.serverTime - Date.now(), // pong 수신 시 지연 보정값으로 갱신
          lastError: null,
        });
        break;
      }

      case "game_state":
        set({ game: msg.game });
        break;

      case "players_eliminated": {
        const next = { ...get().players };
        for (const id of msg.ids) if (next[id]) next[id] = { ...next[id], alive: false };
        set({ players: next });
        break;
      }

      case "round_reset": {
        const players: Record<string, ClientPlayer> = {};
        for (const p of msg.players) players[p.id] = toClientPlayer(p);
        lastSent = null;
        set({
          players,
          playerIds: Object.keys(players),
          spawnVersion: get().spawnVersion + 1,
        });
        break;
      }

      case "player_joined": {
        const { players, playerIds } = get();
        set({
          players: { ...players, [msg.player.id]: toClientPlayer(msg.player) },
          playerIds: playerIds.includes(msg.player.id)
            ? playerIds
            : [...playerIds, msg.player.id],
        });
        break;
      }

      case "player_left": {
        const { [msg.id]: _removed, ...rest } = get().players;
        set({
          players: rest,
          playerIds: get().playerIds.filter((id) => id !== msg.id),
        });
        break;
      }

      case "snapshot": {
        // 변경된 플레이어만 새 객체로 교체 (나머지는 참조 유지)
        const { players, selfId } = get();
        const next = { ...players };
        let changed = false;
        for (const s of msg.players) {
          const prev = next[s.id];
          if (!prev) continue; // join 이전 snapshot 은 무시
          // 내 캐릭터는 로컬 물리엔진이 권한을 가짐 → 서버 에코로 덮어쓰지 않음
          if (s.id === selfId) continue;
          next[s.id] = { ...prev, p: s.p, r: s.r, updatedAt: msg.t };
          changed = true;
        }
        if (changed) set({ players: next });
        break;
      }

      case "item_spawned": {
        const next = [...get().obstacles, { ...msg.item, receivedAt: Date.now() }];
        set({ obstacles: next.length > MAX_OBSTACLES ? next.slice(-MAX_OBSTACLES) : next });
        break;
      }

      case "throw_cooldown":
        set({ throwReadyAt: Date.now() + msg.retryInMs });
        break;

      case "pong": {
        const now = Date.now();
        const latency = now - msg.t;
        // 서버가 응답한 시점 ≈ 왕복의 중간
        set({ latency, clockOffset: msg.serverTime + latency / 2 - now });
        break;
      }

      case "error":
        console.warn("[ws] server error:", msg.message);
        set({ lastError: msg.message });
        break;
    }
  }

  function openSocket() {
    if (!connectOpts) return;
    const url = resolveWsUrl(connectOpts);
    set({ status: "connecting" });

    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => {
      if (socket !== ws) return;
      reconnectAttempts = 0;
      lastSent = null;
      set({ status: "open", lastError: null });
      rawSend({ type: "ping", t: Date.now() });
      pingTimer = setInterval(
        () => rawSend({ type: "ping", t: Date.now() }),
        PING_INTERVAL_MS,
      );
    };

    ws.onmessage = (e) => {
      if (socket !== ws) return;
      try {
        handleMessage(JSON.parse(e.data as string) as ServerMessage);
      } catch (err) {
        console.warn("[ws] invalid message", err);
      }
    };

    ws.onclose = (e) => {
      if (socket !== ws) return; // 이미 교체된 옛 소켓
      socket = null;
      clearTimers();
      set({ status: "closed", selfId: null, players: {}, playerIds: [], game: INITIAL_GAME_STATE, obstacles: [] });

      if (manualClose) return;
      if (FATAL_CLOSE_CODES.includes(e.code)) {
        // 비밀번호 오류 등: 같은 정보로 재시도해도 실패하므로 재연결 중단
        connectOpts = null;
        set({ status: "idle", fatalCloseCode: e.code, lastError: null });
        return;
      }
      // 지수 백오프 재연결: 0.5s, 1s, 2s, 4s ... 최대 10s
      const delay = Math.min(500 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
      reconnectAttempts++;
      set({ lastError: `연결 끊김 (code ${e.code}) — ${Math.round(delay / 100) / 10}s 후 재연결` });
      reconnectTimer = setTimeout(openSocket, delay);
    };

    ws.onerror = () => {
      // onclose 가 뒤이어 호출되므로 여기선 기록만
      if (socket === ws) set({ lastError: "WebSocket 오류" });
    };
  }

  function flushMove() {
    pendingMoveTimer = null;
    if (!pendingMove) return;
    const m = pendingMove;
    pendingMove = null;
    lastSentAt = performance.now();
    lastSent = m;
    rawSend({ type: "move", p: m.p, r: m.r });

    // 내 위치도 스토어에 반영 (서버 에코는 무시하므로 여기서 갱신).
    // 매 프레임이 아닌 전송 주기(20Hz)로만 set → 불필요한 리렌더 방지.
    // 3D 씬의 내 캐릭터는 이 값이 아니라 로컬 물리 바디를 직접 따름.
    const { selfId, players } = useGameStore.getState();
    const me = selfId ? players[selfId] : undefined;
    if (me) {
      useGameStore.setState({
        players: { ...players, [me.id]: { ...me, p: m.p, r: m.r, updatedAt: Date.now() } },
      });
    }
  }

  return {
    status: "idle",
    roomId: null,
    role: null,
    selfId: null,
    latency: null,
    clockOffset: 0,
    lastError: null,
    fatalCloseCode: null,
    playerIds: [],
    players: {},
    game: INITIAL_GAME_STATE,
    spawnVersion: 0,
    obstacles: [],
    throwReadyAt: 0,

    connect: (opts) => {
      // 같은 방/역할로 이미 연결(중)이면 무시 — StrictMode 이중 effect 대비
      if (
        socket &&
        connectOpts &&
        connectOpts.roomId === opts.roomId &&
        connectOpts.role === opts.role &&
        connectOpts.name === opts.name &&
        connectOpts.shape === opts.shape &&
        connectOpts.color === opts.color &&
        connectOpts.password === opts.password
      ) {
        return;
      }
      get().disconnect();
      manualClose = false;
      set({ fatalCloseCode: null });
      reconnectAttempts = 0;
      connectOpts = opts;
      set({ roomId: opts.roomId, role: opts.role });
      openSocket();
    },

    disconnect: () => {
      manualClose = true;
      clearTimers();
      const ws = socket;
      socket = null;
      connectOpts = null;
      ws?.close(1000, "client disconnect");
      set({
        status: "idle",
        selfId: null,
        players: {},
        playerIds: [],
        latency: null,
        game: INITIAL_GAME_STATE,
        fatalCloseCode: null,
        obstacles: [],
      });
    },

    throwItem: (pad, at) => {
      const { selfId, players, throwReadyAt } = get();
      const me = selfId ? players[selfId] : undefined;
      if (!me || me.alive || Date.now() < throwReadyAt) return;
      // 서버는 마지막으로 받은 위치로 "발판 위인지" 검사한다.
      // 센서 이벤트는 물리 스텝 중에 오므로 이번 프레임 위치가 아직 전송 대기열에 없을 수 있다
      // → 밟은 순간의 정확한 위치를 투척 요청 직전에 보낸다 (같은 소켓이라 순서 보장)
      if (pendingMoveTimer) clearTimeout(pendingMoveTimer);
      pendingMoveTimer = null;
      if (at) {
        pendingMove = { p: at, r: lastSent?.r ?? 0 };
        flushMove();
      } else if (pendingMove) {
        flushMove();
      }
      // 낙관적으로 쿨타임 시작 (서버가 거부하면 throw_cooldown 으로 보정)
      set({ throwReadyAt: Date.now() + THROW_COOLDOWN_MS.perPlayer });
      rawSend({ type: "throw_item", pad });
    },

    removeObstacle: (id) => {
      const obstacles = get().obstacles;
      if (obstacles.some((o) => o.id === id)) set({ obstacles: obstacles.filter((o) => o.id !== id) });
    },

    reportFell: () => {
      const { selfId, players } = get();
      const me = selfId ? players[selfId] : undefined;
      if (!me?.alive) return; // 중복 보고 방지
      // 낙관적 업데이트: 서버 확인 전에 바로 조작 차단
      set({ players: { ...players, [me.id]: { ...me, alive: false } } });
      rawSend({ type: "fell" });
    },

    startQuestion: (payload) => rawSend({ type: "admin_start_question", ...payload }),

    resetRound: () => rawSend({ type: "admin_reset" }),

    sendMove: (x, y, z, rotY = 0) => {
      const { selfId, role } = get();
      if (role !== "player" || !selfId) return;

      const p: Vec3 = [x, y, z];

      // 거의 안 움직였으면 전송 생략
      if (
        lastSent &&
        Math.abs(lastSent.p[0] - x) < MOVE_EPSILON &&
        Math.abs(lastSent.p[1] - y) < MOVE_EPSILON &&
        Math.abs(lastSent.p[2] - z) < MOVE_EPSILON &&
        Math.abs(lastSent.r - rotY) < MOVE_EPSILON
      ) {
        return;
      }

      // 스로틀링: 마지막 값만 유지하고 SEND_INTERVAL_MS 간격으로 전송 (trailing 보장)
      pendingMove = { p, r: rotY };
      const elapsed = performance.now() - lastSentAt;
      if (elapsed >= SEND_INTERVAL_MS) {
        flushMove();
      } else if (!pendingMoveTimer) {
        pendingMoveTimer = setTimeout(flushMove, SEND_INTERVAL_MS - elapsed);
      }
    },
  };
});

// ───────────── 편의 셀렉터 ─────────────

/** 내 플레이어 정보 (입·퇴장/스냅샷 시 갱신) */
export const useSelf = () =>
  useGameStore((s) => (s.selfId ? s.players[s.selfId] : undefined));

/** 서버 기준 현재 시각(ms) */
export const serverNow = () => Date.now() + useGameStore.getState().clockOffset;

/** 내 생존 여부 (관전자/미접속이면 false) */
export const useSelfAlive = () =>
  useGameStore((s) => (s.selfId ? s.players[s.selfId]?.alive ?? false : false));

// 개발 중 콘솔/E2E 테스트에서 상태 확인용
if (import.meta.env.DEV) {
  (window as unknown as { __gameStore: typeof useGameStore }).__gameStore = useGameStore;
}
