import { useState, type FormEvent } from "react";
import { MAX_CHOICE_LENGTH, MAX_QUESTION_LENGTH, TIME_LIMIT_SEC, type Choice, type Choices } from "@quiz/shared";
import { blankQuiz, quizProblem, type QuizDraft } from "../../lib/quizSet";

const LETTERS: Choice[] = ["A", "B", "C", "D"];
const POS: Record<Choice, string> = { A: "좌상", B: "우상", C: "좌하", D: "우하" };

/**
 * 문제 추가/수정 폼.
 * initial 이 있으면 수정 모드 (저장 시 같은 id 유지), 없으면 추가 모드.
 */
export function QuizEditor({
  initial,
  onSave,
  onCancel,
  disabled,
}: {
  initial?: QuizDraft;
  onSave: (q: QuizDraft) => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<QuizDraft>(() => initial ?? blankQuiz());
  const [touched, setTouched] = useState(false);
  const problem = quizProblem(draft);
  const editing = !!initial;

  const setType = (t: QuizDraft["quizType"]) => {
    if (t === draft.quizType) return;
    // 유형을 바꿔도 질문/시간은 유지
    const next = blankQuiz(t);
    setDraft({ ...next, id: draft.id, question: draft.question, timeLimitSec: draft.timeLimitSec });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem || disabled) return;
    onSave(draft);
    if (!editing) {
      // 연속 입력: 같은 유형·시간으로 빈 문제 준비
      const next = blankQuiz(draft.quizType);
      setDraft({ ...next, timeLimitSec: draft.timeLimitSec });
      setTouched(false);
    }
  };

  return (
    <form className={`quiz-editor ${editing ? "editing" : ""}`} onSubmit={submit}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{editing ? "문제 수정" : "문제 추가"}</h3>
        <div className="segmented" role="tablist">
          {(["OX", "MULTIPLE"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={draft.quizType === t} className={draft.quizType === t ? "selected" : ""} onClick={() => setType(t)}>
              {t === "OX" ? "O / X" : "4지선다"}
            </button>
          ))}
        </div>
      </div>

      <textarea
        className="input"
        style={{ width: "100%", minHeight: 64, resize: "vertical", marginTop: 12 }}
        placeholder={draft.quizType === "OX" ? "예) 바나나는 나무에서 자란다?" : "예) 태양계에서 가장 큰 행성은?"}
        value={draft.question}
        maxLength={MAX_QUESTION_LENGTH}
        onChange={(e) => setDraft({ ...draft, question: e.target.value })}
      />

      {draft.quizType === "OX" ? (
        <div className="row" style={{ marginTop: 12 }}>
          <span>정답</span>
          {(["O", "X"] as const).map((a) => (
            <button key={a} type="button" className={`answer-toggle ${a} ${draft.answer === a ? "selected" : ""}`} onClick={() => setDraft({ ...draft, answer: a })}>
              {a}
            </button>
          ))}
        </div>
      ) : (
        <div className="choice-inputs">
          <small>보기를 입력하고 왼쪽 글자 버튼으로 정답을 고르세요. 보드 구역: A 좌상 · B 우상 · C 좌하 · D 우하</small>
          {LETTERS.map((letter, i) => (
            <div key={letter} className={`choice-input-row ${draft.answer === letter ? "is-answer" : ""}`}>
              <button type="button" className={`choice-letter zone-${letter}`} aria-pressed={draft.answer === letter} title={`${letter}를 정답으로`} onClick={() => setDraft({ ...draft, answer: letter })}>
                {letter}
              </button>
              <input
                className="input"
                placeholder={`보기 ${letter} (${POS[letter]})`}
                value={draft.choices[i]}
                maxLength={MAX_CHOICE_LENGTH}
                onChange={(e) => {
                  const choices = [...draft.choices] as Choices;
                  choices[i] = e.target.value;
                  setDraft({ ...draft, choices });
                }}
              />
              {draft.answer === letter && <span className="answer-tag">정답</span>}
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
        <label className="row">
          제한 시간
          <input
            className="input"
            type="number"
            min={TIME_LIMIT_SEC.min}
            max={TIME_LIMIT_SEC.max}
            value={draft.timeLimitSec}
            onChange={(e) => setDraft({ ...draft, timeLimitSec: Number(e.target.value) })}
            onBlur={() => setDraft((d) => ({ ...d, timeLimitSec: Math.max(TIME_LIMIT_SEC.min, Math.min(TIME_LIMIT_SEC.max, Math.round(d.timeLimitSec) || TIME_LIMIT_SEC.default)) }))}
            style={{ width: 80 }}
          />
          초
        </label>
        <div className="row">
          {onCancel && (
            <button className="btn secondary" type="button" onClick={onCancel}>
              취소
            </button>
          )}
          <button className="btn" type="submit" disabled={disabled}>
            {editing ? "수정 저장" : "＋ 목록에 추가"}
          </button>
        </div>
      </div>
      {touched && problem && <p className="admin-error" style={{ marginTop: 10 }}>{problem}</p>}
    </form>
  );
}
