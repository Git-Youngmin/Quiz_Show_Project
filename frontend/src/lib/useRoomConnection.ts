import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { Role } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";

export const DEFAULT_ROOM = "lobby";

/**
 * URL 쿼리(?room=abc&name=홍길동)를 읽어 해당 방에 접속하고,
 * 페이지를 떠나면 연결을 끊는다.
 */
export function useRoomConnection(role: Role) {
  const [params] = useSearchParams();
  const roomId = params.get("room") || DEFAULT_ROOM;
  const name = params.get("name") ?? undefined;

  useEffect(() => {
    useGameStore.getState().connect({ roomId, role, name });
    return () => useGameStore.getState().disconnect();
  }, [roomId, role, name]);

  return { roomId, name };
}
