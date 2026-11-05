import { useState, type FormEvent } from "react";
import { MAX_QUESTION_LENGTH, TIME_LIMIT_SEC, type Answer } from "@quiz/shared";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { PlayerTable } from "../components/PlayerTable";
import { useRoomConnection } from "../lib/useRoomConnection";
import { useCountdown } from "../lib/useCountdown";
import { PHASE_LABEL } from "../lib/phase";
import { useGameStore } from "../store/useGameStore";

/** 방장 패널 — 문제 출제 / 진행 상황 / 라운드 리셋 */
export default function AdminPage() {
  const { roomId } = useRoomConnection("admin");
  const status = useGameStore((s) => s.status);
  const game = useGameStore((s) => s.game);
  const players = useGameStore((s) => s.players);
  const remaining = useCountdown();
  const winnerName = useGameStore((s) => (s.game.winnerId ? s.players[s.game.winnerId]?.name ?? "(퇴장함)" : null));

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer>("O");
  const [timeLimit, setTimeLimit] = useState<number>(TIME_LIMIT_SEC.default);

  const list = Object.values(players);
  const aliveCount = list.filter((p) => p.alive).length;
  const canStart = status === "open" && game.phase === "waiting" && question.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canStart) return;
    useGameStore.getState().startQuestion(question.trim(), answer, timeLimit);
    setQuestion("");
  };

  return (
    <div className="page">
      <h1>관리자 패널</h1>
      <ConnectionStatus />

      {/* ── 진행 상황 ── */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <span className={`badge phase-${game.phase}`}>{PHASE_LABEL[game.phase]}</span>
            <span>문제 {game.round}</span>
            {remaining !== null && <b className="mono">{(remaining / 1000).toFixed(1)}s</b>}
          </div>
          <span>생존 {aliveCount} / {list.length}명</span>
        </div>
        {game.phase === "game_over" && (
          <p style={{ marginBottom: 0, fontSize: 20 }}>
            🏆 {winnerName ? <>우승자: <b>{winnerName}</b></> : "우승자 없음 (전원 탈락)"} — 새 게임은 라운드 리셋 후 시작하세요.
          </p>
        )}
        {game.question && game.phase !== "game_over" && (
          <p style={{ marginBottom: 0 }}>
            Q. {game.question}
            {game.answer && <b> → 정답 {game.answer}</b>}
          </p>
        )}
      </div>

      {/* ── 출제 폼 ── */}
      <form className="card" onSubmit={submit}>
        <h3 style={{ marginTop: 0 }}>O / X 문제 출제</h3>
        <textarea
          className="input"
          style={{ width: "100%", minHeight: 72, resize: "vertical" }}
          placeholder="예) 바나나는 나무에서 자란다?"
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <span>정답</span>
          {(["O", "X"] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={`answer-toggle ${a} ${answer === a ? "selected" : ""}`}
              onClick={() => setAnswer(a)}
            >
              {a}
            </button>
          ))}
          <label className="row" style={{ marginLeft: 8 }}>
            제한 시간
            <input
              className="input"
              type="number"
              min={TIME_LIMIT_SEC.min}
              max={TIME_LIMIT_SEC.max}
              value={timeLimit}
              onChange={(e) => setTimeLimit(Number(e.target.value))}
              style={{ width: 80 }}
            />
            초
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" type="submit" disabled={!canStart}>
            출제하기
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={status !== "open"}
            onClick={() => {
              if (confirm("진행 중인 문제를 중단하고 전원 부활시킬까요?")) {
                useGameStore.getState().resetRound();
              }
            }}
          >
            라운드 리셋 (전원 부활)
          </button>
          {game.phase !== "waiting" && game.phase !== "game_over" && <span>문제 진행이 끝나면 다음 문제를 낼 수 있어요.</span>}
        </div>
      </form>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>참가자</h3>
        <PlayerTable />
        <p className="mono" style={{ opacity: 0.7 }}>
          참가 링크: {location.origin}/play?room={roomId}
        </p>
      </div>
    </div>
  );
}
