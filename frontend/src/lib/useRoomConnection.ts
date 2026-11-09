import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { isCharacterColor, isCharacterShape, isCharacterAccessory, type Role } from "@quiz/shared";
import { useGameStore } from "../store/useGameStore";

export const DEFAULT_ROOM = "lobby";

/**
 * URL 쿼리(?room=abc&name=홍길동&shape=box&accessory=crown&color=%23ff5c8a)를 읽어 해당 방에 접속하고,
 * 페이지를 떠나면 연결을 끊는다.
 * 로비에서 이미 같은 옵션으로 connect 했다면 스토어가 중복 접속을 무시한다.
 */
export function useRoomConnection(role: Role) {
  const [params] = useSearchParams();
  const roomId = params.get("room") || DEFAULT_ROOM;
  const name = params.get("name") ?? undefined;
  const rawShape = params.get("shape");
  const rawAccessory = params.get("accessory");
  const rawColor = params.get("color");
  const shape = role === "player" && isCharacterShape(rawShape) ? rawShape : undefined;
  const accessory = role === "player" && isCharacterAccessory(rawAccessory) ? rawAccessory : undefined;
  const color = role === "player" && isCharacterColor(rawColor) ? rawColor : undefined;

  useEffect(() => {
    useGameStore.getState().connect({ roomId, role, name, shape, accessory, color });
    return () => useGameStore.getState().disconnect();
  }, [roomId, role, name, shape, accessory, color]);

  return { roomId, name };
}
