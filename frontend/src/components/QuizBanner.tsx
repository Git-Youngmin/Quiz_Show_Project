import { useGameStore, useSelfAlive } from "../store/useGameStore";
import { useCountdown } from "../lib/useCountdown";

/**
 * 화면 상단 퀴즈 상태 배너 (/play, /display 공용).
 * 단계별로 카운트다운 / 질문 + 남은 시간 / 정답 / 탈락 구역 을 보여준다.
 */
export function QuizBanner({ showSelfStatus = false }: { showSelfStatus?: boolean }) {
  const game = useGameStore((s) => s.game);
  const role = useGameStore((s) => s.role);
  const aliveCount = useGameStore((s) => Object.values(s.players).filter((p) => p.alive).length);
  const selfAlive = useSelfAlive();
  const selfId = useGameStore((s) => s.selfId);
  const winnerName = useGameStore((s) => (s.game.winnerId ? s.players[s.game.winnerId]?.name ?? "???" : null));
  const remaining = useCountdown();
  const sec = remaining === null ? null : Math.ceil(remaining / 1000);

  let content: React.ReactNode;
  switch (game.phase) {
    case "waiting":
      content = (
        <div className="banner-sub">
          {game.round === 0 ? "곧 퀴즈가 시작됩니다! 보드 위에서 기다려 주세요" : `다음 문제 대기 중 · 생존자 ${aliveCount}명`}
        </div>
      );
      break;
    case "countdown":
      content = (
        <>
          <div className="banner-sub">문제 {game.round}</div>
          <div className="banner-big pop" key={sec}>{sec}</div>
        </>
      );
      break;
    case "question_active": {
      const ratio = remaining === null ? 0 : remaining / (game.timeLimitSec * 1000);
      content = (
        <>
          <div className="banner-sub">문제 {game.round} · O 는 왼쪽, X 는 오른쪽!</div>
          <div className="banner-question">{game.question}</div>
          <div className="timer-bar"><div style={{ transform: `scaleX(${ratio})` }} className={ratio < 0.3 ? "danger" : ""} /></div>
          <div className={`banner-time ${sec !== null && sec <= 3 ? "danger" : ""}`}>{sec}초</div>
        </>
      );
      break;
    }
    case "reveal":
      content = (
        <>
          <div className="banner-question">{game.question}</div>
          <div className={`banner-big answer-${game.answer}`}>정답은 {game.answer}!</div>
        </>
      );
      break;
    case "elimination":
      content = (
        <>
          <div className={`banner-big answer-${game.droppedZone}`}>{game.droppedZone} 구역 탈락!</div>
          <div className="banner-sub">생존자 {aliveCount}명</div>
        </>
      );
      break;
    case "game_over":
      content = winnerName ? (
        <>
          <div className="banner-sub">최후의 1인</div>
          <div className="banner-big winner">🏆 Winner: {winnerName}</div>
          {selfId && selfId === game.winnerId && <div className="banner-sub">축하합니다! 당신이 우승했어요!</div>}
        </>
      ) : (
        <>
          <div className="banner-big">우승자 없음</div>
          <div className="banner-sub">모두 탈락했어요 · 관리자가 새 게임을 시작할 수 있어요</div>
        </>
      );
      break;
  }

  return (
    <>
      <div className="quiz-banner">{content}</div>
      {showSelfStatus && role === "player" && !selfAlive && (
        <>
          {/* 큰 "탈락" 문구는 잠시 보였다가 사라지고, 작은 관전 배지만 남음 */}
          <div className="eliminated-overlay">
            <div className="eliminated-title">탈락</div>
            <div>관전석으로 이동합니다</div>
          </div>
          <div className="spectator-pill">관전 중 · 관전석에서 자유롭게 움직일 수 있어요</div>
        </>
      )}
    </>
  );
}
