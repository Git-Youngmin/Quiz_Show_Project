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
  wsPath,
  type ClientMessage,
  type PlayerInfo,
  type Role,
  type ServerMessage,
  type Vec3,
} from "@quiz/shared";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

/** 클라이언트에서 보관하는 플레이어 상태 (보간용 수신 시각 포함) */
export interface ClientPlayer extends PlayerInfo {
  /** 마지막으로 위치를 받은 서버 시각(ms) */
  updatedAt: number;
}

interface ConnectOptions {
  roomId: string;
  role: Role;
  name?: string;
}

interface GameState {
  // ── 연결 상태 ──
  status: ConnectionStatus;
  roomId: string | null;
  role: Role | null;
  selfId: string | null;
  /** 왕복 지연(ms) */
  latency: number | null;
  lastError: string | null;

  // ── 월드 상태 ──
  playerIds: string[];
  players: Record<string, ClientPlayer>;

  // ── 액션 ──
  connect: (opts: ConnectOptions) => void;
  disconnect: () => void;
  /** 내 캐릭터 위치 전송. 매 프레임 호출해도 내부에서 20Hz 로 스로틀링됨 */
  sendMove: (x: number, y: number, z: number, rotY?: number) => void;
}

// ───────────── 모듈 스코프 (React state 가 아닌 연결 객체) ─────────────

const SEND_INTERVAL_MS = 50; // 최대 20Hz 로 전송 (서버 15Hz 틱보다 약간 빠르게)
const PING_INTERVAL_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 10_000;
/** 이 값보다 작게 움직이면 전송 생략 */
const MOVE_EPSILON = 0.001;

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

function resolveWsUrl({ roomId, role, name }: ConnectOptions): string {
  // 배포: VITE_WS_BASE=wss://xxx.workers.dev / 개발: 현재 host (Vite 프록시 → 8787)
  const base =
    import.meta.env.VITE_WS_BASE ??
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  const q = new URLSearchParams({ role });
  if (name) q.set("name", name);
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

export const useGameStore = create<GameState>()((set, get) => {
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
          lastError: null,
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

      case "pong":
        set({ latency: Date.now() - msg.t });
        break;

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
      set({ status: "closed", selfId: null, players: {}, playerIds: [] });

      if (manualClose) return;
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
    lastError: null,
    playerIds: [],
    players: {},

    connect: (opts) => {
      // 같은 방/역할로 이미 연결(중)이면 무시 — StrictMode 이중 effect 대비
      if (
        socket &&
        connectOpts &&
        connectOpts.roomId === opts.roomId &&
        connectOpts.role === opts.role &&
        connectOpts.name === opts.name
      ) {
        return;
      }
      get().disconnect();
      manualClose = false;
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
      });
    },

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
