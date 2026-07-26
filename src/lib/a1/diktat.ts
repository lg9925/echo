// 听写 (Diktat) — length ladder + sentence-pool selection. Pure logic except
// the thin Dexie read helpers callers use to assemble inputs.
//
// The ladder is the operationalization of 认知摩擦校准 (brief M4): levels are
// word-count bands over the learner's OWN island sentences (already
// comprehensible → i+1, zero new content). 3 consecutive attempts ≥90% char
// accuracy advance a level; 2 consecutive below demote. State lives on the
// CurriculumState singleton so it rides backup for free.

import type { CurriculumState, DictationAttempt, Sentence } from "../types";

export const DIKTAT_ACCURACY_THRESHOLD = 0.9;
export const DIKTAT_UP_STREAK = 3;
export const DIKTAT_DOWN_STREAK = 2;
export const DIKTAT_MIN_LEVEL = 1;
export const DIKTAT_MAX_LEVEL = 5;

/** Word-count bands per level: L1 3–4 … L5 13+. */
const LEVEL_BANDS: Array<[min: number, max: number]> = [
  [3, 4],
  [5, 6],
  [7, 9],
  [10, 12],
  [13, Infinity],
];

export function levelBand(level: number): [min: number, max: number] {
  const idx = Math.min(DIKTAT_MAX_LEVEL, Math.max(DIKTAT_MIN_LEVEL, level)) - 1;
  return LEVEL_BANDS[idx]!;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface LadderState {
  diktatLevel: number;
  diktatUpStreak: number;
  diktatDownStreak: number;
}

/** Pure ladder transition: feed one attempt's accuracy, get the next state. */
export function advanceLadder(
  state: LadderState,
  accuracy: number,
): LadderState {
  if (accuracy >= DIKTAT_ACCURACY_THRESHOLD) {
    const up = state.diktatUpStreak + 1;
    if (up >= DIKTAT_UP_STREAK) {
      return {
        diktatLevel: Math.min(DIKTAT_MAX_LEVEL, state.diktatLevel + 1),
        diktatUpStreak: 0,
        diktatDownStreak: 0,
      };
    }
    return { ...state, diktatUpStreak: up, diktatDownStreak: 0 };
  }
  const down = state.diktatDownStreak + 1;
  if (down >= DIKTAT_DOWN_STREAK) {
    return {
      diktatLevel: Math.max(DIKTAT_MIN_LEVEL, state.diktatLevel - 1),
      diktatUpStreak: 0,
      diktatDownStreak: 0,
    };
  }
  return { ...state, diktatUpStreak: 0, diktatDownStreak: down };
}

export function applyLadder(
  curriculum: CurriculumState,
  accuracy: number,
  nowMs: number,
): CurriculumState {
  return { ...curriculum, ...advanceLadder(curriculum, accuracy), updatedAt: nowMs };
}

/**
 * Pick the sentences for a dictation round: the current level's word-count
 * band, least-recently-dictated first (never dictated wins), optionally
 * intersected with the offline audio cache (pass `cachedTexts` when offline so
 * every picked sentence is actually playable).
 */
export function pickDictationSentences(
  sentences: Sentence[],
  attempts: DictationAttempt[],
  level: number,
  count: number,
  cachedTexts?: Set<string> | null,
): Sentence[] {
  const [min, max] = levelBand(level);
  const lastAttemptByText = new Map<string, number>();
  for (const a of attempts) {
    const prev = lastAttemptByText.get(a.text) ?? 0;
    if (a.createdAt > prev) lastAttemptByText.set(a.text, a.createdAt);
  }
  return sentences
    .filter((s) => {
      const n = wordCount(s.target);
      if (n < min || n > max) return false;
      if (cachedTexts && !cachedTexts.has(s.target)) return false;
      return true;
    })
    .sort(
      (a, b) =>
        (lastAttemptByText.get(a.target) ?? 0) -
        (lastAttemptByText.get(b.target) ?? 0),
    )
    .slice(0, count);
}
