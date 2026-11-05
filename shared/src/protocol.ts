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
 * 한 문제의 진행 단계
 *  waiting → countdown → question_active → reveal → elimination → waiting ...
 *                                                              └→ game_over (생존자 ≤ 1)
 */
export type GamePhase =
  | "waiting" // 대기 (관리자의 출제 대기)
  | "countdown" // 문제 공개 전 카운트다운
  | "question_active" // 문제 공개 + 제한 시간 진행
  | "reveal" // 시간 종료, 정답 발표
  | "elimination" // 오답 구역 바닥 꺼짐
  | "game_over"; // 최후의 1인 결정 (관리자 리셋 전까지 유지)

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
  /** 지금까지 출제된 문제 번호 (1부터) */
  round: number;
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
  /** 관리자: 문제 출제 (MULTIPLE 이면 choices 4개 필수, answer 는 A~D) */
  | ({ type: "admin_start_question" } & StartQuestionPayload)
  /** 관리자: 진행 중단 + 전원 부활 + 재배치 */
  | { type: "admin_reset" };

export type StartQuestionPayload =
  | { quizType: "OX"; question: string; answer: OXAnswer; timeLimitSec: number }
  | { quizType: "MULTIPLE"; question: string; answer: Choice; choices: Choices; timeLimitSec: number };

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
export const BOARD_SIZE = 30;
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

/** 차단벽이 올라와 있어야 하는 단계인지 (시각 조건은 barrierRaisesAt 으로 별도 확인) */
export const isBarrierPhase = (phase: GamePhase) =>
  phase === "question_active" || phase === "reveal" || phase === "elimination";
export const MAX_PLAYERS_PER_ROOM = 100;

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
