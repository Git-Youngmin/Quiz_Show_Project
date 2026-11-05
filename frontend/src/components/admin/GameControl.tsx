import type { QuizItem } from "@quiz/shared";
import { PlayerCount } from "../PlayerCount";
import { ChoiceGrid } from "../QuizBanner";
import { PHASE_LABEL } from "../../lib/phase";
import { useCountdown } from "../../lib/useCountdown";
import { useAliveCount, useGameStore, usePlayerCount } from "../../store/useGameStore";

/**
 * 진행 패널 — 단계/문제 번호/남은 시간, 실시간 접속자·생존자, 그리고 단계에 맞는 버튼 하나.
 *   waiting / game_over  → [▶ 게임 시작]
 *   round_standings      → [다음 문제 출제 ▶]   (다음 문제 미리보기 포함)
 *   문제 진행 중         → 진행 상황만 표시
 */
export function GameControl({
  setSize,
  setValid,
  startedSet,
  onStart,
}: {
  /** 지금 편집 중인 세트의 문제 수 */
  setSize: number;
  /** 세트가 출제 가능한 상태인지 (모든 문제가 유효) */
  setValid: boolean;
  /** 게임 시작 시점에 보낸 세트 (다음 문제 미리보기용) */
  startedSet: QuizItem[] | null;
  onStart: () => void;
}) {
  const status = useGameStore((s) => s.status);
  const game = useGameStore((s) => s.game);
  const playerCount = usePlayerCount();
  const alive = useAliveCount();
  const remaining = useCountdown();
  const winnerName = useGameStore((s) => (s.game.winnerId ? s.players[s.game.winnerId]?.name ?? "(퇴장함)" : null));

  const idle = game.phase === "waiting" || game.phase === "game_over";
  const inProgress = !idle && game.phase !== "round_standings";
  const next = startedSet?.[game.round]; // round 는 1부터 → 다음 문제 인덱스
  const canStart = status === "open" && idle && setSize > 0 && setValid && playerCount > 0;
  const startHint =
    setSize === 0 ? "문제를 1개 이상 추가하세요" : !setValid ? "⚠ 표시된 문제를 먼저 고쳐 주세요" : playerCount === 0 ? "참가자가 들어오면 시작할 수 있어요" : null;

  return (
    <section className="card game-control">
      <div className="game-control-top">
        <div className="row">
          <span className={`badge phase-${game.phase}`}>{PHASE_LABEL[game.phase]}</span>
          {game.totalQuestions > 0 && (
            <span className="round-progress">
              문제 <b>{game.round}</b> / {game.totalQuestions}
            </span>
          )}
          {remaining !== null && <b className="mono">{(remaining / 1000).toFixed(1)}s</b>}
        </div>
        <PlayerCount size="medium" />
      </div>

      {!idle && (
        <div className="stat-row">
          <div className="stat"><span>생존</span><b>{alive}</b></div>
          <div className="stat"><span>탈락</span><b>{playerCount - alive}</b></div>
          {game.phase === "round_standings" && (
            <div className="stat warn"><span>이번 라운드 탈락</span><b>{game.lastEliminatedCount}</b></div>
          )}
        </div>
      )}

      {/* 현재 문제 */}
      {inProgress && game.question && (
        <div className="current-question">
          <div className="banner-sub">지금 문제</div>
          <p>
            Q{game.round}. {game.question}
            {game.answer && <b> → 정답 {game.answer}</b>}
          </p>
          {game.choices && <ChoiceGrid choices={game.choices} answer={game.answer} />}
        </div>
      )}

      {game.phase === "game_over" && (
        <p className="game-over-line">
          🏆 {winnerName ? <>우승자: <b>{winnerName}</b></> : alive > 0 ? <>문제 소진 — 생존자 <b>{alive}명</b> 공동 우승</> : "우승자 없음 (전원 탈락)"}
        </p>
      )}

      {/* 단계별 메인 버튼 */}
      <div className="control-actions">
        {idle && (
          <>
            <button className="btn big" type="button" disabled={!canStart} onClick={onStart}>
              ▶ {game.phase === "game_over" ? "새 게임 시작" : "게임 시작"} ({setSize}문제)
            </button>
            {startHint && <span className="control-hint">{startHint}</span>}
          </>
        )}
        {game.phase === "round_standings" && (
          <>
            <button className="btn big pulse" type="button" disabled={status !== "open"} onClick={() => useGameStore.getState().nextQuestion()}>
              다음 문제 출제 ▶ ({game.round + 1}/{game.totalQuestions})
            </button>
            {next && (
              <span className="control-hint">
                다음: [{next.quizType === "OX" ? "O/X" : "4지선다"}] {next.question}
              </span>
            )}
          </>
        )}
        {inProgress && <span className="control-hint">문제가 끝나면 라운드 결과 화면에서 다음 문제를 낼 수 있어요.</span>}
        {!idle || game.phase === "game_over" ? (
          <button
            className="btn secondary"
            type="button"
            disabled={status !== "open"}
            onClick={() => {
              if (confirm("게임을 중단하고 모두 부활시켜 로비로 돌아갈까요?")) useGameStore.getState().resetRound();
            }}
          >
            {game.phase === "game_over" ? "로비로" : "게임 중단 (리셋)"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
