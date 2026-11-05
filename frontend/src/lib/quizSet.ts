import {
  MAX_CHOICE_LENGTH,
  MAX_QUESTION_LENGTH,
  MAX_QUIZ_ITEMS,
  TIME_LIMIT_SEC,
  ZONES,
  type QuizItem,
} from "@quiz/shared";

/** 편집 중인 문제 (React key 용 id 포함) */
export type QuizDraft = QuizItem & { id: string };

const KEY = "quiz-show:quiz-set";

export const newId = () => Math.random().toString(36).slice(2, 10);

/** 새 문제 기본값 */
export function blankQuiz(type: QuizItem["quizType"] = "OX"): QuizDraft {
  return type === "OX"
    ? { id: newId(), quizType: "OX", question: "", answer: "O", timeLimitSec: TIME_LIMIT_SEC.default }
    : { id: newId(), quizType: "MULTIPLE", question: "", answer: "A", choices: ["", "", "", ""], timeLimitSec: TIME_LIMIT_SEC.default };
}

/** 문제가 출제 가능한 상태인지 (서버 검증과 같은 규칙). 문제 있으면 사유 */
export function quizProblem(q: QuizItem): string | null {
  if (!q.question.trim()) return "질문이 비어 있어요";
  if (!ZONES[q.quizType].includes(q.answer)) return "정답을 골라 주세요";
  if (q.quizType === "MULTIPLE" && q.choices.some((c) => !c.trim())) return "보기 4개를 모두 입력해 주세요";
  return null;
}

/** 저장/불러오기 데이터를 안전하게 정리 (잘못된 항목은 버림) */
export function sanitizeQuizSet(raw: unknown): QuizDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: QuizDraft[] = [];
  for (const r of raw.slice(0, MAX_QUIZ_ITEMS)) {
    if (!r || typeof r !== "object") continue;
    const m = r as Record<string, unknown>;
    const question = typeof m.question === "string" ? m.question.slice(0, MAX_QUESTION_LENGTH) : "";
    const t = Number(m.timeLimitSec);
    const timeLimitSec = Number.isFinite(t) ? Math.round(Math.max(TIME_LIMIT_SEC.min, Math.min(TIME_LIMIT_SEC.max, t))) : TIME_LIMIT_SEC.default;
    if (m.quizType === "MULTIPLE") {
      const c = Array.isArray(m.choices) ? m.choices : [];
      const choices = [0, 1, 2, 3].map((i) => (typeof c[i] === "string" ? (c[i] as string).slice(0, MAX_CHOICE_LENGTH) : "")) as [string, string, string, string];
      const answer = (["A", "B", "C", "D"] as const).find((a) => a === m.answer) ?? "A";
      out.push({ id: newId(), quizType: "MULTIPLE", question, answer, choices, timeLimitSec });
    } else {
      const answer = m.answer === "X" ? "X" : "O";
      out.push({ id: newId(), quizType: "OX", question, answer, timeLimitSec });
    }
  }
  return out;
}

/** 서버로 보낼 형태 (id 제거, 공백 정리) */
export function toQuizItems(set: QuizDraft[]): QuizItem[] {
  return set.map(({ id: _id, ...q }) =>
    q.quizType === "MULTIPLE"
      ? { ...q, question: q.question.trim(), choices: q.choices.map((c) => c.trim()) as [string, string, string, string] }
      : { ...q, question: q.question.trim() },
  );
}

export function loadQuizSet(): QuizDraft[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeQuizSet(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveQuizSet(set: QuizDraft[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(toQuizItems(set)));
  } catch {
    /* 저장 실패 시 새로고침하면 사라짐 */
  }
}

/** 처음 써보는 방장을 위한 예시 세트 */
export function sampleQuizSet(): QuizDraft[] {
  return sanitizeQuizSet([
    { quizType: "OX", question: "바나나는 나무에서 자란다?", answer: "X", timeLimitSec: 10 },
    { quizType: "MULTIPLE", question: "태양계에서 가장 큰 행성은?", answer: "B", choices: ["화성", "목성", "토성", "지구"], timeLimitSec: 12 },
    { quizType: "OX", question: "문어의 심장은 3개다?", answer: "O", timeLimitSec: 10 },
    { quizType: "MULTIPLE", question: "대한민국의 수도는?", answer: "C", choices: ["부산", "인천", "서울", "대전"], timeLimitSec: 8 },
    { quizType: "OX", question: "펭귄은 날 수 있다?", answer: "X", timeLimitSec: 8 },
  ]);
}

/** JSON 파일로 내보내기 */
export function downloadQuizSet(set: QuizDraft[]) {
  const blob = new Blob([JSON.stringify(toQuizItems(set), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quiz-set-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
