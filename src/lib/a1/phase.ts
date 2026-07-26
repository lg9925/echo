// A1 curriculum phase — DERIVED, never stored (zero-config, cannot desync).
//
//   exam-prep  ⇐ examDate set && examDate − now ≤ 10 days
//   cold-start ⇐ active study days < 14 AND word cards introduced < 300
//   main-build ⇐ otherwise
//
// The phase gates the daily new-card throttle (brief M3: 冷启动 20–25/日 →
// 主建设 15/日 → 考前 10 天停新词) and, in P1, the composer's exam-class gate.

import type { CurriculumPhase, CurriculumState } from "../types";

export const EXAM_PREP_WINDOW_DAYS = 10;
export const COLD_START_MAX_ACTIVE_DAYS = 14;
export const COLD_START_MAX_INTRODUCED = 300;

export interface PhaseStats {
  /** Days with any A1 activity (StudyDay rows for the language). */
  activeDays: number;
  /** Word cards ever introduced (cardReviews rows on kind "word" cards). */
  introducedWordCards: number;
}

export function currentPhase(
  curriculum: CurriculumState | undefined,
  stats: PhaseStats,
  nowMs: number,
): CurriculumPhase {
  if (
    curriculum?.examDate != null &&
    curriculum.examDate - nowMs <= EXAM_PREP_WINDOW_DAYS * 86_400_000
  ) {
    return "exam-prep";
  }
  if (
    stats.activeDays < COLD_START_MAX_ACTIVE_DAYS &&
    stats.introducedWordCards < COLD_START_MAX_INTRODUCED
  ) {
    return "cold-start";
  }
  return "main-build";
}

/** Daily new-card allowance by phase (brief M3). */
export function dailyNewLimit(phase: CurriculumPhase): number {
  switch (phase) {
    case "cold-start":
      return 22;
    case "main-build":
      return 15;
    case "exam-prep":
      return 0;
  }
}
