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
