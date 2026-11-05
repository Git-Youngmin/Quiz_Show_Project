import { useRef } from "react";
import { MAX_QUIZ_ITEMS } from "@quiz/shared";
import { quizProblem, type QuizDraft } from "../../lib/quizSet";
import { QuizEditor } from "./QuizEditor";

/**
 * 퀴즈 세트 목록 — 한눈에 보이는 리스트 + 문제별 [위로/아래로/수정/복제/삭제].
 * 수정 중인 문제는 그 자리에서 편집 폼으로 펼쳐진다.
 */
export function QuizList({
  set,
  onChange,
  editingId,
  setEditingId,
  activeRound,
  standings = false,
}: {
  set: QuizDraft[];
  onChange: (next: QuizDraft[]) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  /** 진행 중인 게임의 현재 문제 번호 (게임 시작 시점 세트 기준, 표시용). 0 = 게임 중 아님 */
  activeRound: number;
  /** 라운드 결과 화면이면 현재 문제는 "완료", 다음 문제는 "다음" 으로 표시 */
  standings?: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= set.length) return;
    const next = [...set];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  if (set.length === 0) {
    return <p className="quiz-empty">아직 문제가 없어요. 아래에서 문제를 추가하거나 예시 세트를 불러오세요.</p>;
  }

  return (
    <ol className="quiz-list" ref={listRef}>
      {set.map((q, i) => {
        const problem = quizProblem(q);
        if (q.id === editingId) {
          return (
            <li key={q.id} className="quiz-item editing">
              <QuizEditor
                initial={q}
                onSave={(saved) => {
                  onChange(set.map((x) => (x.id === saved.id ? saved : x)));
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            </li>
          );
        }
        return (
          <li
            key={q.id}
            className={`quiz-item ${problem ? "invalid" : ""} ${activeRound > 0 && i + 1 === (standings ? activeRound + 1 : activeRound) ? "active" : ""} ${activeRound > 0 && i + 1 < activeRound + (standings ? 1 : 0) ? "done" : ""}`}
          >
            <span className="quiz-num">{i + 1}</span>
            <div className="quiz-body">
              <div className="quiz-meta">
                <span className={`badge ${q.quizType === "OX" ? "type-ox" : "type-mc"}`}>{q.quizType === "OX" ? "O/X" : "4지선다"}</span>
                <span className="badge">⏱ {q.timeLimitSec}초</span>
                <span className={`badge answer-badge zone-${q.answer}`}>정답 {q.answer}</span>
                {activeRound > 0 && !standings && activeRound === i + 1 && <span className="badge phase-question_active">진행 중</span>}
                {activeRound > 0 && standings && activeRound + 1 === i + 1 && <span className="badge phase-question_active">다음</span>}
                {activeRound > 0 && i + 1 < activeRound + (standings ? 1 : 0) && <span className="badge">완료</span>}
              </div>
              <div className="quiz-question">{q.question || <i style={{ opacity: 0.6 }}>(질문 없음)</i>}</div>
              {q.quizType === "MULTIPLE" && (
                <div className="quiz-choices">
                  {q.choices.map((c, k) => (
                    <span key={k} className={`zone-${"ABCD"[k]} ${q.answer === "ABCD"[k] ? "correct" : ""}`}>
                      <b>{"ABCD"[k]}</b> {c || "—"}
                    </span>
                  ))}
                </div>
              )}
              {problem && <div className="field-error">⚠ {problem}</div>}
            </div>
            <div className="quiz-actions">
              <button type="button" title="위로" aria-label={`${i + 1}번 위로`} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
              <button type="button" title="아래로" aria-label={`${i + 1}번 아래로`} disabled={i === set.length - 1} onClick={() => move(i, 1)}>▼</button>
              <button type="button" title="수정" onClick={() => setEditingId(q.id)}>수정</button>
              <button
                type="button"
                title="복제"
                disabled={set.length >= MAX_QUIZ_ITEMS}
                onClick={() => {
                  const next = [...set];
                  next.splice(i + 1, 0, { ...q, id: Math.random().toString(36).slice(2, 10) });
                  onChange(next);
                }}
              >
                복제
              </button>
              <button
                type="button"
                className="danger"
                title="삭제"
                onClick={() => {
                  if (confirm(`${i + 1}번 문제를 삭제할까요?`)) onChange(set.filter((x) => x.id !== q.id));
                }}
              >
                삭제
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
