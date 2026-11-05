import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MAX_QUIZ_ITEMS, type QuizItem } from "@quiz/shared";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { PlayerTable } from "../components/PlayerTable";
import { AdminLogin } from "../components/AdminLogin";
import {
  CLOSE_REASON,
  clearAdminSession,
  loadAdminSession,
  saveAdminSession,
  type AdminSession,
} from "../lib/adminSession";
import { GameControl } from "../components/admin/GameControl";
import { QuizEditor } from "../components/admin/QuizEditor";
import { QuizList } from "../components/admin/QuizList";
import {
  downloadQuizSet,
  loadQuizSet,
  quizProblem,
  sampleQuizSet,
  sanitizeQuizSet,
  saveQuizSet,
  toQuizItems,
  type QuizDraft,
} from "../lib/quizSet";
import { useGameStore } from "../store/useGameStore";


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

/**
 * 방장 대시보드 — 카훗 스타일
 *  ① 진행 패널: 접속자/생존자, [게임 시작] / [다음 문제 출제] / [게임 중단]
 *  ② 퀴즈 세트 빌더: 최대 50문제 추가·수정·삭제·복제·순서 변경 (브라우저에 자동 저장)
 *  ③ 참가자 목록
 */
function AdminConsole({ roomId, onLogout }: { roomId: string; onLogout: () => void }) {
  const [set, setSet] = useState<QuizDraft[]>(() => loadQuizSet());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [startedSet, setStartedSet] = useState<QuizItem[] | null>(null);
  const game = useGameStore((s) => s.game);
  const fileInput = useRef<HTMLInputElement>(null);

  // 편집할 때마다 자동 저장 (새로고침해도 유지)
  useEffect(() => saveQuizSet(set), [set]);

  const setValid = set.every((q) => !quizProblem(q));
  const running = game.phase !== "waiting" && game.phase !== "game_over";
  const full = set.length >= MAX_QUIZ_ITEMS;

  const start = () => {
    const items = toQuizItems(set);
    setStartedSet(items);
    setEditingId(null);
    useGameStore.getState().startGame(items);
  };

  const importFile = async (file: File) => {
    try {
      const imported = sanitizeQuizSet(JSON.parse(await file.text()));
      if (imported.length === 0) return alert("불러올 문제가 없습니다. 퀴즈 세트 JSON 파일인지 확인해 주세요.");
      if (set.length === 0 || confirm(`현재 ${set.length}문제를 불러온 ${imported.length}문제로 바꿀까요?`)) setSet(imported);
    } catch {
      alert("JSON 파일을 읽을 수 없습니다.");
    }
  };

  return (
    <div className="page admin-page">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>관리자 대시보드</h1>
        <button className="btn secondary" type="button" onClick={onLogout}>
          로그아웃
        </button>
      </div>
      <ConnectionStatus />

      <GameControl setSize={set.length} setValid={setValid} startedSet={startedSet} onStart={start} />

      {/* ── 퀴즈 세트 빌더 ── */}
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>
            퀴즈 세트 <span className="set-count">{set.length} / {MAX_QUIZ_ITEMS}</span>
          </h2>
          <div className="row toolbar">
            {set.length === 0 && (
              <button className="btn secondary" type="button" onClick={() => setSet(sampleQuizSet())}>
                예시 세트 불러오기
              </button>
            )}
            <button className="btn secondary" type="button" onClick={() => fileInput.current?.click()}>
              JSON 불러오기
            </button>
            <button className="btn secondary" type="button" disabled={set.length === 0} onClick={() => downloadQuizSet(set)}>
              JSON 내보내기
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={set.length === 0}
              onClick={() => confirm("모든 문제를 지울까요?") && setSet([])}
            >
              전체 삭제
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {running && (
          <p className="admin-hint" style={{ marginTop: 8 }}>
            게임 진행 중에 세트를 고쳐도 지금 게임에는 반영되지 않아요 (시작할 때 보낸 문제로 진행).
          </p>
        )}

        <QuizList
          set={set}
          onChange={setSet}
          editingId={editingId}
          setEditingId={setEditingId}
          activeRound={running && startedSet ? game.round : 0}
          standings={game.phase === "round_standings"}
        />

        {full ? (
          <p className="admin-hint">문제는 최대 {MAX_QUIZ_ITEMS}개까지 만들 수 있어요.</p>
        ) : (
          <div className="card inner">
            <QuizEditor onSave={(q) => setSet([...set, q])} />
          </div>
        )}
      </section>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>참가자</h3>
        <PlayerTable />
        <p className="mono" style={{ opacity: 0.7 }}>
          참가 링크: {location.origin}/?room={roomId}
          <br />
          송출 화면: {location.origin}/display?room={roomId}
        </p>
      </section>
    </div>
  );
}
