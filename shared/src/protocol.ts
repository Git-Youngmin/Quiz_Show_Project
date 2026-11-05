/**
 * 프론트엔드(React)와 백엔드(Durable Object)가 공유하는 WebSocket 메시지 규약.
 * 모든 메시지는 JSON 문자열로 직렬화되며 `type` 필드로 구분한다.
 */

/** 접속 역할: 참가자 / 관리자(방장) / 방송 송출 뷰 */
export type Role = "player" | "admin" | "display";

export type Vec3 = [x: number, y: number, z: number];

/** 방에 존재하는 참가자(아바타)의 공개 정보 */
export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
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

// ───────────── Client → Server ─────────────

export type ClientMessage =
  | { type: "move"; p: Vec3; r: number }
  | { type: "ping"; t: number };

// ───────────── Server → Client ─────────────

export type ServerMessage =
  | {
      type: "welcome";
      roomId: string;
      selfId: string;
      role: Role;
      players: PlayerInfo[];
    }
  | { type: "player_joined"; player: PlayerInfo }
  | { type: "player_left"; id: string }
  /** 서버 틱마다 변경된 플레이어만 묶어서 전송 */
  | { type: "snapshot"; t: number; players: PlayerState[] }
  | { type: "pong"; t: number; serverTime: number }
  | { type: "error"; message: string };

// ───────────── 상수 ─────────────

/** 서버 스냅샷 브로드캐스트 주기(ms). 약 15Hz */
export const SNAPSHOT_INTERVAL_MS = 66;

/** 월드 좌표 허용 범위 (비정상 값 클램핑용) */
export const WORLD_BOUNDS = 500;

export const MAX_NAME_LENGTH = 16;
export const MAX_PLAYERS_PER_ROOM = 100;

/** WebSocket 접속 URL 경로: /api/rooms/:roomId/ws?role=player&name=... */
export const wsPath = (roomId: string) =>
  `/api/rooms/${encodeURIComponent(roomId)}/ws`;
