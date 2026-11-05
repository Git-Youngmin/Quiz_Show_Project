import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MAX_CHOICE_LENGTH,
  MAX_QUESTION_LENGTH,
  TIME_LIMIT_SEC,
  type Choice,
  type Choices,
  type OXAnswer,
  type QuizType,
} from "@quiz/shared";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { PlayerTable } from "../components/PlayerTable";
import { ChoiceGrid } from "../components/QuizBanner";
import { AdminLogin } from "../components/AdminLogin";
import {
  CLOSE_REASON,
  clearAdminSession,
  loadAdminSession,
  saveAdminSession,
  type AdminSession,
} from "../lib/adminSession";
import { useCountdown } from "../lib/useCountdown";
import { PHASE_LABEL } from "../lib/phase";
import { useGameStore } from "../store/useGameStore";

const CHOICE_LETTERS: Choice[] = ["A", "B", "C", "D"];
const CHOICE_POS: Record<Choice, string> = { A: "좌상", B: "우상", C: "좌하", D: "우하" };

/**
 * /admin — 로그인 게이트.
 * 비밀번호를 입력하기 전에는 WebSocket 을 열지 않고, 서버가 인증(welcome)해 준 뒤에만 콘솔을 보여준다.
 */
export default function AdminPage() {
  const [params, setParams] = useSearchParams();
  const roomFromUrl = params.get("room") ?? "";
  const [session, setSession] = useState<AdminSession | null>(() => loadAdminSession(roomFromUrl));
  const [error, setError] = useState<string | null>(null);

  if (!session) {
    return (
      <AdminLogin
        initialRoom={roomFromUrl}
        error={error}
        onSubmit={(s) => {
          setError(null);
          setParams({ room: s.roomId }, { replace: true }); // 비밀번호는 URL 에 넣지 않음
          setSession(s);
        }}
      />
    );
  }

  return (
    <AdminGate
      key={`${session.roomId}:${session.password}`}
      session={session}
      onAuthenticated={() => saveAdminSession(session)}
      onRejected={(reason) => {
        clearAdminSession(session.roomId);
        setError(reason);
        setSession(null);
      }}
      onLogout={() => {
        clearAdminSession(session.roomId);
        setSession(null);
      }}
    />
  );
}

/** 관리자 권한으로 WebSocket 접속 → 인증 결과에 따라 콘솔 표시 또는 로그인으로 복귀 */
function AdminGate({
  session,
  onAuthenticated,
  onRejected,
  onLogout,
}: {
  session: AdminSession;
  onAuthenticated: () => void;
  onRejected: (reason: string) => void;
  onLogout: () => void;
}) {
  const role = useGameStore((s) => s.role);
  const selfId = useGameStore((s) => s.selfId);
  const fatal = useGameStore((s) => s.fatalCloseCode);
  const authed = role === "admin" && !!selfId;

  useEffect(() => {
    useGameStore.getState().connect({ roomId: session.roomId, role: "admin", password: session.password });
    return () => useGameStore.getState().disconnect();
  }, [session]);

  useEffect(() => {
    if (fatal !== null) onRejected(CLOSE_REASON[fatal] ?? "접속이 거부되었습니다.");
  }, [fatal, onRejected]);

  useEffect(() => {
    if (authed) onAuthenticated();
  }, [authed, onAuthenticated]);

  if (!authed) {
    return (
      <div className="lobby">
        <div className="lobby-card" style={{ textAlign: "center" }}>
          <p>방장 인증 확인 중…</p>
          <ConnectionStatus />
        </div>
      </div>
    );
  }
  return <AdminConsole roomId={session.roomId} onLogout={onLogout} />;
}

/** 방장 패널 — 문제 출제(O/X · 4지선다) / 진행 상황 / 라운드 리셋 */
function AdminConsole({ roomId, onLogout }: { roomId: string; onLogout: () => void }) {
  const status = useGameStore((s) => s.status);
  const game = useGameStore((s) => s.game);
  const players = useGameStore((s) => s.players);
  const remaining = useCountdown();
  const winnerName = useGameStore((s) => (s.game.winnerId ? s.players[s.game.winnerId]?.name ?? "(퇴장함)" : null));

  const [quizType, setQuizType] = useState<QuizType>("OX");
  const [question, setQuestion] = useState("");
  const [oxAnswer, setOxAnswer] = useState<OXAnswer>("O");
  const [choices, setChoices] = useState<Choices>(["", "", "", ""]);
  const [choiceAnswer, setChoiceAnswer] = useState<Choice>("A");
  const [timeLimit, setTimeLimit] = useState<number>(TIME_LIMIT_SEC.default);

  const list = Object.values(players);
  const aliveCount = list.filter((p) => p.alive).length;
  const formValid =
    question.trim().length > 0 && (quizType === "OX" || choices.every((c) => c.trim().length > 0));
  const canStart = status === "open" && game.phase === "waiting" && formValid;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canStart) return;
    const base = { question: question.trim(), timeLimitSec: timeLimit };
    useGameStore.getState().startQuestion(
      quizType === "OX"
        ? { quizType: "OX", answer: oxAnswer, ...base }
        : { quizType: "MULTIPLE", answer: choiceAnswer, choices: choices.map((c) => c.trim()) as Choices, ...base },
    );
    setQuestion("");
    setChoices(["", "", "", ""]);
  };

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>관리자 패널</h1>
        <button className="btn secondary" type="button" onClick={onLogout}>
          로그아웃
        </button>
      </div>
      <ConnectionStatus />

      {/* ── 진행 상황 ── */}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <span className={`badge phase-${game.phase}`}>{PHASE_LABEL[game.phase]}</span>
            <span>문제 {game.round}</span>
            <span className="badge">{game.quizType === "OX" ? "O/X" : "4지선다"}</span>
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
          <>
            <p style={{ marginBottom: 8 }}>
              Q. {game.question}
              {game.answer && <b> → 정답 {game.answer}</b>}
            </p>
            {game.choices && <ChoiceGrid choices={game.choices} answer={game.answer} />}
          </>
        )}
      </div>

      {/* ── 출제 폼 ── */}
      <form className="card" onSubmit={submit}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>문제 출제</h3>
          <div className="segmented" role="tablist">
            {(["OX", "MULTIPLE"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={quizType === t}
                className={quizType === t ? "selected" : ""}
                onClick={() => setQuizType(t)}
              >
                {t === "OX" ? "O / X" : "4지선다"}
              </button>
            ))}
          </div>
        </div>

        <textarea
          className="input"
          style={{ width: "100%", minHeight: 72, resize: "vertical" }}
          placeholder={quizType === "OX" ? "예) 바나나는 나무에서 자란다?" : "예) 태양계에서 가장 큰 행성은?"}
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(e) => setQuestion(e.target.value)}
        />

        {quizType === "OX" ? (
          <div className="row" style={{ marginTop: 12 }}>
            <span>정답</span>
            {(["O", "X"] as const).map((a) => (
              <button
                key={a}
                type="button"
                className={`answer-toggle ${a} ${oxAnswer === a ? "selected" : ""}`}
                onClick={() => setOxAnswer(a)}
              >
                {a}
              </button>
            ))}
          </div>
        ) : (
          <div className="choice-inputs">
            <small>보기를 입력하고 정답 버튼을 눌러 선택하세요. 보드 구역: A 좌상 · B 우상 · C 좌하 · D 우하</small>
            {CHOICE_LETTERS.map((letter, i) => (
              <div key={letter} className={`choice-input-row ${choiceAnswer === letter ? "is-answer" : ""}`}>
                <button
                  type="button"
                  className={`choice-letter zone-${letter}`}
                  aria-pressed={choiceAnswer === letter}
                  title={`${letter}를 정답으로`}
                  onClick={() => setChoiceAnswer(letter)}
                >
                  {letter}
                </button>
                <input
                  className="input"
                  placeholder={`보기 ${letter} (${CHOICE_POS[letter]})`}
                  value={choices[i]}
                  maxLength={MAX_CHOICE_LENGTH}
                  onChange={(e) => {
                    const next = [...choices] as Choices;
                    next[i] = e.target.value;
                    setChoices(next);
                  }}
                />
                {choiceAnswer === letter && <span className="answer-tag">정답</span>}
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <label className="row">
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
          참가 링크: {location.origin}/?room={roomId}
          <br />
          송출 화면: {location.origin}/display?room={roomId}
        </p>
      </div>
    </div>
  );
}
