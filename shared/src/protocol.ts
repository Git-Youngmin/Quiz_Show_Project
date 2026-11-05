/**
 * 프론트엔드(React)와 백엔드(Node.js GameRoom)가 공유하는 WebSocket 메시지 규약.
 * 모든 메시지는 JSON 문자열로 직렬화되며 `type` 필드로 구분한다.
 */

/** 접속 역할: 참가자 / 관리자(방장) / 방송 송출 뷰 */
export type Role = "player" | "admin" | "display";

export type Vec3 = [x: number, y: number, z: number];

// ───────────── 캐릭터 커스터마이징 ─────────────

/** 캐릭터 외형 (물리 충돌체는 모양과 무관하게 모두 동일한 캡슐) */
export type CharacterShape = "capsule" | "box" | "sphere" | "cone";
export const CHARACTER_SHAPES: readonly CharacterShape[] = ["capsule", "box", "sphere", "cone"];

/** 선택 가능한 밝은 색상 팔레트 (서버는 이 목록 외의 색은 거부) */
export const CHARACTER_COLORS = [
  "#ff5c8a", // 핑크
  "#ffb84d", // 오렌지
  "#ffe14d", // 옐로
  "#7ae582", // 그린
  "#4dd9ff", // 스카이
  "#b07cff", // 퍼플
] as const;

export const isCharacterShape = (v: unknown): v is CharacterShape =>
  typeof v === "string" && (CHARACTER_SHAPES as readonly string[]).includes(v);
export const isCharacterColor = (v: unknown): v is string =>
  typeof v === "string" && (CHARACTER_COLORS as readonly string[]).includes(v.toLowerCase());

/**
 * 방에 존재하는 참가자(아바타)의 공개 정보.
 * welcome / player_joined / round_reset 으로 전체가 전달되고,
 * 15Hz snapshot 에는 바뀌는 값(위치·회전)만 실린다.
 */
export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  characterShape: CharacterShape;
  /** false = 탈락 (관전 상태) */
  alive: boolean;
  /** 위치 (x, y, z) */
  p: Vec3;
  /** Y축 회전(라디안) */
  r: number;
}

/** 스냅샷에 실리는 최소 상태 (대역폭 절약) */
export interface PlayerState {
  id: string;
  p: Vec3;
  r: number;
}

// ───────────── 게임 상태 ─────────────

/**
 * 게임 진행 단계 (카훗 스타일: 관리자가 퀴즈 세트로 게임을 시작하고, 문제 사이마다 직접 넘김)
 *
 *  waiting ─(admin_start_game)→ countdown → question_active → reveal → elimination ─┬→ round_standings ─(admin_next_question)→ countdown …
 *                                                                                   └→ game_over (생존자 ≤ 1 또는 문제 소진)
 */
export type GamePhase =
  | "waiting" // 로비: 참가자 입장 대기 (관리자의 게임 시작 대기)
  | "countdown" // 문제 공개 전 카운트다운
  | "question_active" // 문제 공개 + 제한 시간 진행
  | "reveal" // 시간 종료, 정답 발표
  | "elimination" // 오답 구역 바닥 꺼짐
  | "round_standings" // 라운드 결과: 생존자 확인, 관리자의 "다음 문제" 대기
  | "game_over"; // 우승자 결정 (다시 게임 시작 또는 리셋 전까지 유지)

// ───────────── 퀴즈 유형 / 구역 ─────────────

/** OX: 보드 좌우 2분할 / MULTIPLE: 4지선다, 보드 십자 4분할 */
export type QuizType = "OX" | "MULTIPLE";
export type OXAnswer = "O" | "X";
export type Choice = "A" | "B" | "C" | "D";
/** 정답이자 보드 구역 이름 */
export type Answer = OXAnswer | Choice;
/** 4지선다 보기 텍스트 (A, B, C, D 순서) */
export type Choices = [string, string, string, string];

export const ZONES: Record<QuizType, readonly Answer[]> = {
  OX: ["O", "X"],
  MULTIPLE: ["A", "B", "C", "D"],
};

/**
 * 좌표 → 구역 판정 (서버 판정·클라이언트 표시 공용)
 *  OX       : x < 0 → O(왼쪽), x ≥ 0 → X(오른쪽)
 *  MULTIPLE : 카메라 기본 시점 기준 화면 위쪽이 -z
 *             A 좌상(x<0, z<0) · B 우상(x≥0, z<0) · C 좌하(x<0, z≥0) · D 우하(x≥0, z≥0)
 */
export function zoneAt(type: QuizType, x: number, z: number): Answer {
  if (type === "OX") return x < 0 ? "O" : "X";
  if (z < 0) return x < 0 ? "A" : "B";
  return x < 0 ? "C" : "D";
}

/** 모든 클라이언트에게 공개되는 게임 상태 */
export interface GameState {
  phase: GamePhase;
  /** 현재 문제 번호 (1부터, 시작 전 0) */
  round: number;
  /** 이번 게임의 전체 문제 수 (시작 전 0) */
  totalQuestions: number;
  /** 직전 라운드에서 탈락한 인원 (round_standings 표시용) */
  lastEliminatedCount: number;
  /** 현재(또는 마지막) 문제 유형 — 보드 분할 방식을 결정 */
  quizType: QuizType;
  question: string | null;
  /** 4지선다 보기 (OX 면 null) */
  choices: Choices | null;
  /** 정답 — reveal 이후에만 공개 (그 전에는 항상 null) */
  answer: Answer | null;
  /** 바닥이 꺼진 구역들 = 정답이 아닌 모든 구역 (elimination 단계에서만 값이 있음) */
  droppedZones: Answer[];
  /** 현재 단계가 끝나는 서버 시각(epoch ms). null = 무기한 */
  phaseEndsAt: number | null;
  timeLimitSec: number;
  /**
   * 구역 사이 차단벽(OX: 한 줄, MULTIPLE: 십자)이 솟아오르는 서버 시각(epoch ms).
   * question_active 종료 BARRIER_LEAD_MS 전 ~ elimination 끝까지 벽이 올라와 있음. null = 벽 내려감
   */
  barrierRaisesAt: number | null;
  /** game_over 일 때 우승자 id (생존자 0명이면 null) */
  winnerId: string | null;
}

// ───────────── Client → Server ─────────────

export type ClientMessage =
  | { type: "move"; p: Vec3; r: number }
  | { type: "ping"; t: number }
  /** 플레이어: 스스로 맵 밖으로 떨어졌음을 보고 */
  | { type: "fell" }
  /** 관리자: 퀴즈 세트(최대 MAX_QUIZ_ITEMS 문제)로 게임 시작 — 전원 부활 후 1번 문제부터 */
  | { type: "admin_start_game"; quizzes: QuizItem[] }
  /** 관리자: round_standings 에서 다음 문제 출제 */
  | { type: "admin_next_question" }
  /** 관리자: 진행 중단 + 전원 부활 + 재배치 (로비로) */
  | { type: "admin_reset" }
  /** 탈락자: 관전석의 투척 발판(pad 번호)을 밟아 방해물 발사 요청 */
  | { type: "throw_item"; pad: number };

/** 퀴즈 세트의 문제 하나 */
export type QuizItem =
  | { quizType: "OX"; question: string; answer: OXAnswer; timeLimitSec: number }
  | { quizType: "MULTIPLE"; question: string; answer: Choice; choices: Choices; timeLimitSec: number };

/** 퀴즈 세트 최대 문제 수 */
export const MAX_QUIZ_ITEMS = 50;

// ───────────── Server → Client ─────────────

export type ServerMessage =
  | {
      type: "welcome";
      roomId: string;
      selfId: string;
      role: Role;
      players: PlayerInfo[];
      game: GameState;
      serverTime: number;
      /** 버튼별로 다시 쓸 수 있는 서버 시각 (늦게 들어온 사람도 쿨타임 상태를 보도록) */
      padReadyAt: number[];
    }
  | { type: "player_joined"; player: PlayerInfo }
  | { type: "player_left"; id: string }
  /** 서버 틱마다 변경된 플레이어만 묶어서 전송 */
  | { type: "snapshot"; t: number; players: PlayerState[] }
  | { type: "pong"; t: number; serverTime: number }
  | { type: "game_state"; game: GameState; serverTime: number }
  | { type: "players_eliminated"; ids: string[] }
  /** 라운드 리셋: 전원 부활 + 새 스폰 위치 (클라이언트는 내 캐릭터를 이 위치로 재생성) */
  | { type: "round_reset"; players: PlayerInfo[] }
  /** 방해물 발사 — 모든 클라이언트가 같은 초기값으로 각자 물리 시뮬레이션 */
  | { type: "item_spawned"; item: ThrownItem }
  /** 투척 요청이 쿨타임에 걸림 (요청한 클라이언트에게만) */
  | { type: "throw_cooldown"; pad: number; retryInMs: number }
  | { type: "error"; message: string };

// ───────────── 상수 ─────────────

/** 서버 스냅샷 브로드캐스트 주기(ms). 약 15Hz */
export const SNAPSHOT_INTERVAL_MS = 66;

/** 월드 좌표 허용 범위 (비정상 값 클램핑용) */
export const WORLD_BOUNDS = 500;

export const MAX_NAME_LENGTH = 16;
export const MAX_QUESTION_LENGTH = 200;
export const MAX_CHOICE_LENGTH = 60;

/** 퀴즈 보드 크기 (윗면 y = 0, 중심 원점). 구역 판정은 zoneAt() */
export const BOARD_SIZE = 22;
/** 이 높이 아래 = 보드에서 떨어진 것으로 간주 */
export const FELL_Y = -2;

/** 단계별 지속 시간(ms) */
export const PHASE_DURATION_MS = {
  countdown: 3000,
  reveal: 3000,
  elimination: 4500,
} as const;
/** 제한 시간 종료 몇 ms 전에 차단벽이 올라오는지 */
export const BARRIER_LEAD_MS = 1500;
export const TIME_LIMIT_SEC = { min: 3, max: 60, default: 10 } as const;

export const INITIAL_GAME_STATE: GameState = {
  phase: "waiting",
  round: 0,
  totalQuestions: 0,
  lastEliminatedCount: 0,
  quizType: "OX",
  question: null,
  choices: null,
  answer: null,
  droppedZones: [],
  phaseEndsAt: null,
  timeLimitSec: TIME_LIMIT_SEC.default,
  barrierRaisesAt: null,
  winnerId: null,
};

/**
 * 로비 단계(게임 시작 전 / 게임 종료 후)인지.
 * 이때는 생존자도 보드와 관전석을 자유롭게 오가고, 관전석 버튼으로 방해물을 던지며 놀 수 있다.
 */
export const isLobbyPhase = (phase: GamePhase) => phase === "waiting" || phase === "game_over";

/** 입장/대기 위치: 퀴즈 보드(생존자 자리) 또는 관전석 */
export type LobbySpot = "board" | "stand";

/** 차단벽이 올라와 있어야 하는 단계인지 (시각 조건은 barrierRaisesAt 으로 별도 확인) */
export const isBarrierPhase = (phase: GamePhase) =>
  phase === "question_active" || phase === "reveal" || phase === "elimination";
export const MAX_PLAYERS_PER_ROOM = 100;

// ───────────── 탈락자 관전석 / 방해물 투척 ─────────────

/**
 * 관전석 하나 (밀폐된 유리 상자). 보드 중심을 바라보도록 y 축으로 회전돼 있다.
 *  - 로컬 +x(forward) = 보드 중심 방향, 로컬 +z(right) = 오른쪽
 *  - center.y = 바닥 윗면 높이, size = [깊이(로컬 x), 너비(로컬 z)]
 */
export interface SpectatorZoneDef {
  center: Vec3;
  /** RigidBody rotation-y (로컬 +x 가 forward 를 향하도록) */
  yaw: number;
  forward: [number, number];
  right: [number, number];
  size: [number, number];
  wallHeight: number;
  ceilingHeight: number;
  /** 투척 발판들의 로컬 좌우 위치 (앞쪽 벽을 따라 일렬) */
  padSlots: readonly number[];
}

function makeZone(cx: number, cz: number, size: [number, number], padSlots: number[]): SpectatorZoneDef {
  const len = Math.hypot(cx, cz);
  const f: [number, number] = [-cx / len, -cz / len]; // 보드 중심 방향
  // y 축 회전 θ 에서 로컬 x → (cosθ, -sinθ), 로컬 z → (sinθ, cosθ)
  return {
    center: [cx, 3, cz],
    yaw: Math.atan2(-f[1], f[0]),
    forward: f,
    right: [-f[1], f[0]],
    size,
    wallHeight: 4, // 점프 최고점(약 2.4) 보다 충분히 높게
    ceilingHeight: 5.5, // 천장 콜라이더로 완전히 밀폐
    padSlots,
  };
}

/** 정면 관전석(그랜드스탠드): 깊이 8 × 가로 36 */
const GRANDSTAND_SIZE: [number, number] = [8, 36];
/** 보드 앞쪽 끝(+z)에서 관전석 앞벽까지 간격 */
const GRANDSTAND_GAP = 4;

/**
 * 관전석 — 보드 건너편(-z)에 가로로 길게 뻗은 단일 관전석.
 *  - 생존자 카메라는 +z 쪽에서 -z 를 바라보므로, 생존자 화면에서 관전석이 정면(화면 위쪽)에 보인다
 *  - 관전석에 들어가면 반대로 +z(보드 쪽)를 바라봐서 정면에 생존자석(보드)이 보인다
 * 앞벽(보드 쪽)을 따라 투척 버튼 5개가 같은 간격으로 놓인다.
 */
export const SPECTATOR_ZONES: readonly SpectatorZoneDef[] = [
  makeZone(0, -(BOARD_SIZE / 2 + GRANDSTAND_GAP + GRANDSTAND_SIZE[0] / 2), GRANDSTAND_SIZE, [-14, -7, 0, 7, 14]),
];

/** 관전석 로컬 좌표(lx: 앞뒤, lz: 좌우) → 월드 (x, z) */
export function zoneToWorld(zone: SpectatorZoneDef, lx: number, lz: number): [number, number] {
  return [
    zone.center[0] + zone.forward[0] * lx + zone.right[0] * lz,
    zone.center[2] + zone.forward[1] * lx + zone.right[1] * lz,
  ];
}

/** 월드 (x, z) → 관전석 로컬 좌표 */
export function worldToZone(zone: SpectatorZoneDef, x: number, z: number): [number, number] {
  const dx = x - zone.center[0];
  const dz = z - zone.center[2];
  return [dx * zone.forward[0] + dz * zone.forward[1], dx * zone.right[0] + dz * zone.right[1]];
}

/** 투척 발판(버튼): 관전석 앞쪽(보드 방향 벽 앞)을 따라 padSlots 위치에 */
export const THROW_PAD_SIZE = 2.4;
export interface ThrowPadDef {
  zone: number;
  /** 관전석 로컬 좌표 */
  local: [number, number];
  /** 월드 좌표 */
  x: number;
  z: number;
}
export const THROW_PADS: readonly ThrowPadDef[] = SPECTATOR_ZONES.flatMap((zone, zi) =>
  zone.padSlots.map((lz) => {
    const lx = zone.size[0] / 2 - THROW_PAD_SIZE / 2 - 0.6;
    const [x, z] = zoneToWorld(zone, lx, lz);
    return { zone: zi, local: [lx, lz] as [number, number], x, z };
  }),
);

/** 플레이어 위치가 해당 발판 위인지 (서버 검증용, 위치 지연을 고려한 여유 margin) */
export function isOnThrowPad(pad: number, p: Vec3, margin = 1.2): boolean {
  const def = THROW_PADS[pad];
  if (!def) return false;
  const zone = SPECTATOR_ZONES[def.zone];
  const [lx, lz] = worldToZone(zone, p[0], p[2]);
  const reach = THROW_PAD_SIZE / 2 + margin;
  return Math.abs(lx - def.local[0]) <= reach && Math.abs(lz - def.local[1]) <= reach && p[1] > zone.center[1] - 1;
}

export type ItemKind = "banana" | "crate" | "ball";
export const ITEM_KINDS: readonly ItemKind[] = ["banana", "crate", "ball"];

/** 서버가 정해 브로드캐스트하는 방해물 초기 상태 */
export interface ThrownItem {
  id: number;
  kind: ItemKind;
  /** 발사 위치 (관전석 보드 쪽 유리벽 바깥 위) */
  origin: Vec3;
  /** 발사 방향 (단위 벡터) — 클라이언트가 impulse = direction × speed × mass 로 적용 */
  direction: Vec3;
  speed: number;
  throwerId: string;
  /** 발사한 버튼 번호 */
  pad: number;
  /** 이 버튼을 다시 쓸 수 있는 서버 시각 (버튼별 쿨타임 표시용) */
  padReadyAt: number;
  spawnedAt: number;
}

/**
 * 버튼별 쿨타임 (ms) — 한 버튼을 밟으면 그 버튼만 쉬고 나머지는 바로 쓸 수 있다.
 * 모든 플레이어가 공유하며, 전체 투척량은 버튼 수 / 쿨타임 = 초당 최대 2.5개로 제한된다.
 */
export const PAD_COOLDOWN_MS = 2000;
/** 방해물 수명 — 이후 자동 제거 (보드 아래로 떨어지면 그 전에 제거) */
export const ITEM_LIFETIME_MS = 20_000;
/**
 * 물리 엔진 중력 크기 (m/s²). 폴가이즈처럼 빠릿하게 떨어지도록 실제(9.81)의 약 3배.
 * 클라이언트 <Physics gravity> 와 서버 궤적 계산이 같은 값을 써야 방해물이 보드에 떨어진다.
 */
export const GRAVITY = 30;

/**
 * 발판 번호 → 발사 위치: 해당 관전석 보드 쪽 유리벽 꼭대기 발사대의 포구.
 * 벽 바깥면에서 1유닛 이상 떨어져 있어 가장 큰 방해물(반지름 0.55)도 벽/천장과 겹치지 않음.
 */
export function throwOrigin(pad: number): Vec3 {
  const def = THROW_PADS[pad];
  const zone = SPECTATOR_ZONES[def.zone];
  const [x, z] = zoneToWorld(zone, zone.size[0] / 2 + 1.2, def.local[1]);
  return [x, zone.center[1] + zone.wallHeight + 1, z];
}

// ───────────── 관리자 인증 ─────────────

export const ADMIN_PASSWORD_LENGTH = { min: 4, max: 64 } as const;
export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * 관리자 접속 거부 시 WebSocket close code (4000~4999 는 앱 정의 영역).
 * 브라우저는 업그레이드 실패(HTTP 401 등)의 이유를 읽을 수 없으므로
 * 연결을 받은 뒤 이 코드로 닫아 클라이언트가 원인을 표시할 수 있게 한다.
 */
export const CLOSE_CODE = {
  ADMIN_AUTH_FAILED: 4001,
  ROOM_NOT_FOUND: 4004,
  TOO_MANY_ATTEMPTS: 4029,
  /** 참가자 정원(MAX_PLAYERS_PER_ROOM) 초과 */
  ROOM_FULL: 4009,
} as const;

/** POST /api/rooms 요청 본문 — 방 생성 + 방장 비밀번호 설정 */
export interface CreateRoomRequest {
  roomId: string;
  adminPassword: string;
}

/**
 * WebSocket 접속 URL 경로 (입장 정보는 쿼리로 전달)
 *   /api/rooms/:roomId/ws?role=player&name=닉네임&shape=box&color=%23ff5c8a
 *   /api/rooms/:roomId/ws?role=admin&password=방장비밀번호
 */
export const wsPath = (roomId: string) =>
  `/api/rooms/${encodeURIComponent(roomId)}/ws`;
