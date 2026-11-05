import type { GamePhase } from "@quiz/shared";

export const PHASE_LABEL: Record<GamePhase, string> = {
  waiting: "대기 중",
  countdown: "카운트다운",
  question_active: "문제 진행 중",
  reveal: "정답 발표",
  elimination: "탈락 연출",
  game_over: "게임 종료",
};
