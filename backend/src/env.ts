import type { GameRoom } from "./GameRoom";

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  /** 쉼표로 구분된 허용 Origin 목록. "*" 이면 전체 허용 */
  ALLOWED_ORIGINS: string;
}
