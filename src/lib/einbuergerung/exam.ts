// 德国入籍考试 — pure quiz logic (no React, no DB, no browser APIs).
//
// Step 2 uses shuffle() to randomise option order so correctness can never be
// inferred from position. buildExam()/gradeExam() (mock-exam mode) land in a
// later step.

import type { QuizProgress, QuizQuestion } from "../types";
import { inWrongPool } from "./filters";

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

// --- 刷题 (drill) — 以考代学 ---

/** Drill size: a good zero-config default, deliberately NOT a user setting. */
export const DRILL_SIZE = 20;

/**
 * Draw a drill round with light weighting: unseen questions first, then
 * unmastered mistakes (错题池), then the rest — each bucket shuffled, the
 * combined draw shuffled again so buckets don't cluster. Falls back gracefully
 * when a bucket is short.
 */
export function buildDrill(
  questions: readonly QuizQuestion[],
  progressById: ReadonlyMap<number, QuizProgress>,
  size: number = DRILL_SIZE,
): QuizQuestion[] {
  const unseen: QuizQuestion[] = [];
  const wrong: QuizQuestion[] = [];
  const rest: QuizQuestion[] = [];
  for (const q of questions) {
    const p = progressById.get(q.id);
    if (!p || p.attempts === 0) unseen.push(q);
    else if (inWrongPool(p)) wrong.push(q);
    else rest.push(q);
  }
  const picked = [
    ...shuffle(unseen),
    ...shuffle(wrong),
    ...shuffle(rest),
  ].slice(0, size);
  return shuffle(picked);
}
