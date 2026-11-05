import { MAX_PLAYERS_PER_ROOM } from "@quiz/shared";
import { usePlayerCount } from "../store/useGameStore";

/** 크게 보여주는 실시간 접속자 수: "현재 접속자 45 / 100명" (정원에 가까우면 색이 바뀜) */
export function PlayerCount({ size = "large" }: { size?: "large" | "medium" }) {
  const count = usePlayerCount();
  const ratio = count / MAX_PLAYERS_PER_ROOM;
  return (
    <div className={`player-count ${size} ${ratio >= 1 ? "full" : ratio >= 0.9 ? "almost" : ""}`} aria-live="polite">
      <span className="player-count-label">현재 접속자</span>
      <span className="player-count-num">
        <b>{count}</b> / {MAX_PLAYERS_PER_ROOM}명
      </span>
      {ratio >= 1 && <span className="player-count-full">정원 마감</span>}
    </div>
  );
}
