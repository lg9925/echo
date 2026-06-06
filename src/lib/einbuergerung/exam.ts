// 德国入籍考试 — pure quiz logic (no React, no DB, no browser APIs).
//
// Step 2 uses shuffle() to randomise option order so correctness can never be
// inferred from position. buildExam()/gradeExam() (mock-exam mode) land in a
// later step.

import type { QuizQuestion } from "../types";

/** Fisher–Yates: return a NEW shuffled array; never mutate the input. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Index of the single correct option (the bank guarantees exactly one). */
export function correctIndex(q: QuizQuestion): number {
  return q.options.findIndex((o) => o.correct);
}

/** The single correct option (the bank guarantees exactly one). */
export function correctOption(q: QuizQuestion) {
  return q.options.find((o) => o.correct) ?? q.options[0];
}

// --- 模拟考试 (mock exam) ---
//
// The real Einbürgerungstest is 33 questions = 30 national + 3 from your state
// (here NRW), pass at ≥17 correct.

export const EXAM_NATIONAL_COUNT = 30;
export const EXAM_NRW_COUNT = 3;
export const EXAM_TOTAL = EXAM_NATIONAL_COUNT + EXAM_NRW_COUNT; // 33
export const EXAM_PASS_MARK = 17;

/**
 * Draw a fresh mock exam: 30 random national + 3 random NRW, then shuffle the
 * combined order so NRW questions aren't always last. Falls back gracefully if
 * the bank is short (takes as many as available).
 */
export function buildExam(questions: readonly QuizQuestion[]): QuizQuestion[] {
  const national = questions.filter((q) => q.region === "national");
  const nrw = questions.filter((q) => q.region === "nrw");
  const picked = [
    ...shuffle(national).slice(0, EXAM_NATIONAL_COUNT),
    ...shuffle(nrw).slice(0, EXAM_NRW_COUNT),
  ];
  return shuffle(picked);
}
