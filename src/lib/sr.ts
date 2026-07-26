import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade as FsrsGrade,
} from "ts-fsrs";
import type { CardReviewState, ReviewState } from "./types";

// Echo review grades. The UI only ever shows again/good — the system picks the
// difficulty, the user never does (宪法原则一). `hard` is derived from a `close`
// judge verdict; `easy` is reserved for 7.3 (秒答 / high pronunciation score).
export type Grade = "again" | "hard" | "good" | "easy";

// FSRS engine with the library's DEFAULT weights (srs-error-deck §3: 用库默认
// 权重, 不手填魔数). request_retention 0.90 per spec. enable_short_term=false:
// Echo is day-scale spaced recall, not Anki-style minute learning steps, so a
// Good goes straight to a multi-day interval and there are no learning-step
// positions to persist. Per-user optimizer tuning is deferred (§3 point 4).
const engine = fsrs(
  generatorParameters({
    request_retention: 0.9,
    enable_fuzz: true,
    enable_short_term: false,
  }),
);

const GRADE_TO_RATING: Record<Grade, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/**
 * Derive the FSRS grade from the UI action + AI verdict so the learner never
 * hand-picks difficulty (宪法原则一). `again` → Again; `good` with a `close`
 * verdict (understood but awkward) → Hard, otherwise (correct / no verdict /
 * offline self-grade) → Good. `easy` is reserved for 7.3.
 */
export function verdictToGrade(
  uiAction: "again" | "good",
  verdict?: "correct" | "close" | "wrong" | null,
): Grade {
  if (uiAction === "again") return "again";
  return verdict === "close" ? "hard" : "good";
}

export function freshState(
  sentenceId: string,
  language: string,
): ReviewState {
  const card = createEmptyCard();
  return {
    sentenceId,
    language,
    // `ease` is a vestigial SM-2 field — unused by FSRS, kept so the type and
    // pre-FSRS rows/backups don't break.
    ease: 2.5,
    interval: card.scheduled_days,
    repetitions: card.reps,
    due: 0,
    lastReviewedAt: null,
    // freshState is only ever the baseline for a card being recalled right now
    // (it's immediately followed by schedule() before it's persisted), so the
    // row that lands in the DB is stage 2 = 回忆. New (never-recalled) cards have
    // no row at all = stage 0. schedule() spreads ...prev, carrying this through.
    masteryStage: 2,
    stability: card.stability,
    difficulty: card.difficulty,
    lapses: card.lapses,
    fsrsState: card.state,
  };
}

/** The FSRS-owned field subset shared by ReviewState (sentence deck) and
 *  CardReviewState (A1 card deck). schedule() is generic over it — one
 *  scheduler, two state tables. Extra fields (sentenceId/masteryStage/
 *  errorTags/cardId/introducedAt/…) are spread through untouched. */
export interface SrFields {
  due: number;
  interval: number;
  repetitions: number;
  lastReviewedAt: number | null;
  stability?: number;
  difficulty?: number;
  lapses?: number;
  fsrsState?: 0 | 1 | 2 | 3;
}

// Rebuild an FSRS Card from our stored state. Legacy v5 rows have no FSRS
// memory (stability === undefined): treat them as a fresh FSRS card. The old
// SM-2 history gives way on the first FSRS review; `due` is untouched until then,
// so this is invisible to the user until they actually review the card.
function toCard(prev: SrFields, now: Date): Card {
  if (prev.stability === undefined) return createEmptyCard(now);
  return {
    due: new Date(prev.due),
    stability: prev.stability,
    difficulty: prev.difficulty ?? 0,
    // elapsed_days is deprecated and recomputed by FSRS from last_review.
    elapsed_days: 0,
    scheduled_days: prev.interval,
    // enable_short_term=false → cards never sit on a learning step.
    learning_steps: 0,
    reps: prev.repetitions,
    lapses: prev.lapses ?? 0,
    state: (prev.fsrsState ?? State.New) as State,
    last_review: prev.lastReviewedAt ? new Date(prev.lastReviewedAt) : undefined,
  };
}

// Mirror the FSRS Card back onto our state. We keep due/interval/repetitions in
// sync (the `due` index + every db.ts query + the hub badges rely on them) and
// spread non-FSRS fields through untouched (masteryStage transitions are 7.3+).
function fromCard<T extends SrFields>(prev: T, card: Card, now: Date): T {
  return {
    ...prev,
    interval: card.scheduled_days,
    repetitions: card.reps,
    due: card.due.getTime(),
    lastReviewedAt: now.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    lapses: card.lapses,
    fsrsState: card.state as 0 | 1 | 2 | 3,
  };
}

export function schedule<T extends SrFields>(
  prev: T,
  grade: Grade,
  now: Date,
): T {
  const next = engine.next(toCard(prev, now), now, GRADE_TO_RATING[grade]).card;
  return fromCard(prev, next, now);
}

/** Baseline CardReviewState for an A1 card being graded for the first time —
 *  immediately followed by schedule() before persisting (same contract as
 *  freshState). Writing this row is what "introduces" the card: introducedAt
 *  drives the daily new-card throttle via the [language+introducedAt] index. */
export function freshCardState(
  cardId: string,
  language: string,
  now: Date,
): CardReviewState {
  const card = createEmptyCard(now);
  return {
    cardId,
    language,
    interval: card.scheduled_days,
    repetitions: card.reps,
    due: 0,
    lastReviewedAt: null,
    stability: card.stability,
    difficulty: card.difficulty,
    lapses: card.lapses,
    fsrsState: card.state,
    introducedAt: now.getTime(),
  };
}
