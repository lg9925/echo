import type { ReviewState } from "./types";

export type Grade = "again" | "good";

export const INITIAL_EASE = 2.5;
export const MIN_EASE = 1.3;
export const EASE_DROP = 0.2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function freshState(
  sentenceId: string,
  language: string,
): ReviewState {
  return {
    sentenceId,
    language,
    ease: INITIAL_EASE,
    interval: 0,
    repetitions: 0,
    due: 0,
    lastReviewedAt: null,
  };
}

export function schedule(
  prev: ReviewState,
  grade: Grade,
  now: Date,
): ReviewState {
  const nowMs = now.getTime();
  if (grade === "again") {
    return {
      ...prev,
      ease: Math.max(MIN_EASE, prev.ease - EASE_DROP),
      interval: 0,
      repetitions: 0,
      due: nowMs,
      lastReviewedAt: nowMs,
    };
  }
  // grade === "good"
  const repetitions = prev.repetitions + 1;
  let intervalDays: number;
  if (repetitions === 1) {
    intervalDays = 1;
  } else if (repetitions === 2) {
    intervalDays = 3;
  } else {
    intervalDays = Math.max(1, Math.round(prev.interval * prev.ease));
  }
  return {
    ...prev,
    repetitions,
    interval: intervalDays,
    due: nowMs + intervalDays * MS_PER_DAY,
    lastReviewedAt: nowMs,
  };
}
