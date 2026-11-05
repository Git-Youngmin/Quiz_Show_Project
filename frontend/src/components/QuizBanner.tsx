import type { Choices } from "@quiz/shared";
import { useGameStore, useSelfAlive } from "../store/useGameStore";
import { useCountdown } from "../lib/useCountdown";
import { PlayerCount } from "./PlayerCount";

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
  const selfEliminated = useGameStore((s) => s.selfEliminated);
  const winnerName = useGameStore((s) => (s.game.winnerId ? s.players[s.game.winnerId]?.name ?? "???" : null));
  const remaining = useCountdown();
  const sec = remaining === null ? null : Math.ceil(remaining / 1000);

  let content: React.ReactNode;
  switch (game.phase) {
    case "waiting":
      // 로비: 실시간 접속자 수를 크게
      content = (
        <>
          <PlayerCount />
          <div className="banner-sub">곧 퀴즈가 시작됩니다! 보드 위에서 기다려 주세요</div>
        </>
      );
      break;
    case "countdown":
      content = (
        <>
          <div className="banner-sub">
            문제 {game.round}
            {game.totalQuestions > 0 && ` / ${game.totalQuestions}`}
          </div>
          <div className="banner-big pop" key={sec}>{sec}</div>
        </>
      );
      break;
    case "question_active": {
      const ratio = remaining === null ? 0 : remaining / (game.timeLimitSec * 1000);
      const multiple = game.quizType === "MULTIPLE" && game.choices;
      content = (
        <>
          <div className="banner-sub">
            문제 {game.round}
            {game.totalQuestions > 0 && `/${game.totalQuestions}`} · {multiple ? "정답 보기의 구역으로 이동하세요!" : "O 는 왼쪽, X 는 오른쪽!"}
          </div>
          <div className="banner-question">{game.question}</div>
          {multiple && <ChoiceGrid choices={game.choices!} />}
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
          {game.quizType === "MULTIPLE" && game.choices && game.answer && (
            <div className="banner-sub">{game.choices["ABCD".indexOf(game.answer)]}</div>
          )}
        </>
      );
      break;
    case "elimination":
      content = (
        <>
          {game.droppedZones.length === 1 ? (
            <div className={`banner-big answer-${game.droppedZones[0]}`}>{game.droppedZones[0]} 구역 탈락!</div>
          ) : (
            <div className="banner-big">
              <span className={`answer-${game.answer}`}>{game.answer}</span> 외 모든 구역 탈락!
            </div>
          )}
          <div className="banner-sub">생존자 {aliveCount}명</div>
        </>
      );
      break;
    case "round_standings":
      // 라운드 결과: 생존/탈락 집계 + 관리자의 다음 문제 대기
      content = (
        <>
          <div className="banner-sub">
            문제 {game.round} / {game.totalQuestions} 결과{game.answer && ` · 정답 ${game.answer}`}
          </div>
          <div className="standings-row">
            <div className="alive">
              <b>{aliveCount}</b>
              <span>생존</span>
            </div>
            <div className="out">
              <b>{game.lastEliminatedCount}</b>
              <span>이번 라운드 탈락</span>
            </div>
            <div>
              <b>{game.totalQuestions - game.round}</b>
              <span>남은 문제</span>
            </div>
          </div>
          <div className="banner-sub">다음 문제를 기다리는 중…</div>
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
      ) : aliveCount > 0 ? (
        // 문제를 모두 소진했는데 여러 명이 살아남음 → 공동 우승
        <>
          <div className="banner-sub">모든 문제 종료!</div>
          <div className="banner-big winner">🏆 생존자 {aliveCount}명 공동 우승</div>
          {showSelfStatus && selfAlive && <div className="banner-sub">축하합니다! 끝까지 살아남았어요!</div>}
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
      {/* 접속 확인(selfId) 전에는 아무것도 띄우지 않음 — 입장 직후 "탈락"이 깜빡이지 않도록 */}
      {showSelfStatus && role === "player" && selfId && !selfAlive && (
        <>
          {selfEliminated ? (
            // 이번 게임에서 실제로 탈락: 큰 "탈락" 문구는 잠시 보였다가 사라짐
            <div className="eliminated-overlay">
              <div className="eliminated-title">탈락</div>
              <div>관전석으로 이동합니다</div>
            </div>
          ) : (
            // 문제 진행 중에 들어온 경우: 탈락이 아니라 관전 입장 안내
            <div className="join-spectator-note">
              <b>게임이 진행 중이라 관전석으로 입장했어요</b>
              <span>다음 게임부터 함께 참가할 수 있어요</span>
            </div>
          )}
          <div className="spectator-pill">관전 중 · 앞쪽 분홍 버튼을 밟으면 방해물을 던져요!</div>
        </>
      )}
    </>
  );
}

/** 4지선다 보기 2×2 (보드 배치와 같은 위치: A 좌상 · B 우상 · C 좌하 · D 우하) */
export function ChoiceGrid({ choices, answer }: { choices: Choices; answer?: string | null }) {
  return (
    <div className="choice-grid">
      {choices.map((text, i) => {
        const letter = "ABCD"[i];
        return (
          <div key={letter} className={`choice-chip zone-${letter} ${answer && answer !== letter ? "dim" : ""}`}>
            <b>{letter}</b>
            <span>{text}</span>
          </div>
        );
      })}
    </div>
  );
}
