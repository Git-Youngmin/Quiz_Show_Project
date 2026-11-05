import { CLOSE_CODE } from "@quiz/shared";

/**
 * 관리자 로그인 정보 — 새로고침해도 다시 입력하지 않도록 sessionStorage 에 보관.
 * (탭을 닫으면 사라짐. localStorage 보다 노출 범위가 좁다)
 */
export interface AdminSession {
  roomId: string;
  password: string;
}

const key = (roomId: string) => `quiz-show:admin:${roomId}`;

export function loadAdminSession(roomId: string): AdminSession | null {
  if (!roomId) return null;
  try {
    const password = sessionStorage.getItem(key(roomId));
    return password ? { roomId, password } : null;
  } catch {
    return null;
  }
}

export function saveAdminSession(s: AdminSession) {
  try {
    sessionStorage.setItem(key(s.roomId), s.password);
  } catch {
    /* 저장 실패 시 새로고침하면 다시 입력 */
  }
}

export function clearAdminSession(roomId: string) {
  try {
    sessionStorage.removeItem(key(roomId));
  } catch {
    /* ignore */
  }
}

export const CLOSE_REASON: Record<number, string> = {
  [CLOSE_CODE.ADMIN_AUTH_FAILED]: "비밀번호가 올바르지 않습니다.",
  [CLOSE_CODE.ROOM_NOT_FOUND]: "방장이 없는 방입니다. '새 방 만들기'로 먼저 방을 만들어 주세요.",
  [CLOSE_CODE.TOO_MANY_ATTEMPTS]: "로그인 시도가 너무 많습니다. 5분 뒤에 다시 시도해 주세요.",
};
