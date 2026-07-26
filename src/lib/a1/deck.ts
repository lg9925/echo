// A1 card deck — due queue, daily new-card throttle, interleaved ordering.
//
// interleave() is a pure function (unit-tested); buildCardQueue() is the thin
// Dexie assembly components call. Interleaving (brief M3: der/die/das 与句型卡
// 按标签交错，不分块) works by bucketing on an interleave key derived from
// tags and round-robin popping across non-empty buckets — while ≥2 buckets are
// non-empty no two consecutive items share a key, and once only one bucket
// remains draining it is allowed (nothing left to alternate with). The emitted
// key sequence is logged with the session-complete event so 交错调度可在日志中
// 验证 (P0 acceptance).

import {
  countCardsIntroducedSince,
  getDb,
  listCardReviews,
  listCards,
} from "../db";
import type { CardRecord, CardReviewState, CurriculumPhase } from "../types";
import { dailyNewLimit } from "./phase";

export interface QueueItem {
  card: CardRecord;
  /** Undefined = new card (introduced when its first review state is written). */
  review?: CardReviewState;
}

/** Interleave bucket key, by tag priority: gender > pattern > dictation > vocab. */
export function interleaveKey(tags: string[]): string {
  if (tags.includes("gender")) return "gender";
  if (tags.includes("pattern")) return "pattern";
  if (tags.includes("dictation")) return "dictation";
  return "vocab";
}

/** Deterministic-input shuffle (Fisher–Yates over a caller-supplied rng). */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Order a session: due cards (oldest due first, per bucket) with the day's new
 * cards appended to their bucket tails, then round-robin across buckets.
 * Returns the ordered items plus the emitted key sequence (for the study log).
 */
export function interleave(
  due: QueueItem[],
  fresh: QueueItem[],
  rng: () => number = Math.random,
): { queue: QueueItem[]; keySequence: string[] } {
  const buckets = new Map<string, QueueItem[]>();
  const push = (item: QueueItem) => {
    const key = interleaveKey(item.card.tags);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  };
  [...due].sort((a, b) => (a.review?.due ?? 0) - (b.review?.due ?? 0)).forEach(push);
  shuffle(fresh, rng).forEach(push);

  const keys = [...buckets.keys()];
  const queue: QueueItem[] = [];
  const keySequence: string[] = [];
  let idx = 0;
  while (buckets.size > 0) {
    const key = keys[idx % keys.length]!;
    const bucket = buckets.get(key);
    if (bucket && bucket.length > 0) {
      const item = bucket.shift()!;
      queue.push(item);
      keySequence.push(key);
      if (bucket.length === 0) buckets.delete(key);
    }
    idx++;
    // Drop exhausted keys from rotation to keep the loop O(n).
    if (!buckets.has(key)) {
      const k = keys.indexOf(key);
      if (k !== -1) keys.splice(k, 1);
    }
  }
  return { queue, keySequence };
}

export interface CardQueueResult {
  queue: QueueItem[];
  keySequence: string[];
  dueCount: number;
  newAllowance: number;
}

/** Start-of-local-day epoch ms. */
export function startOfDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Assemble today's interleaved card session for a language: all due cards +
 * up to the phase's new-card allowance of never-introduced cards (word cards
 * in seed order; cloze/dictation cards created on-device are due-driven, so
 * "new" here is effectively the seed deck marching forward).
 */
export async function buildCardQueue(
  language: string,
  phase: CurriculumPhase,
  nowMs: number,
): Promise<CardQueueResult> {
  const [cards, reviews] = await Promise.all([
    listCards(language),
    listCardReviews(language),
  ]);
  const reviewById = new Map(reviews.map((r) => [r.cardId, r]));

  const due: QueueItem[] = [];
  const fresh: QueueItem[] = [];
  for (const card of cards) {
    const review = reviewById.get(card.id);
    if (review) {
      if (review.due <= nowMs) due.push({ card, review });
    } else {
      fresh.push({ card });
    }
  }

  // Daily throttle counts only WORD cards introduced today — error/cloze cards
  // are remediation/derivation, not new curriculum. The indexed range gives
  // today's introduced ids; kind is resolved in memory (rows are few).
  const introducedToday = await introducedWordCardsToday(language, nowMs);
  const limit = dailyNewLimit(phase);
  const allowance = Math.max(0, limit - introducedToday);
  // Seed order = createdAt order (the loader stamps createdAt incrementally).
  fresh.sort((a, b) => a.card.createdAt - b.card.createdAt);
  const freshTake = fresh
    .filter((i) => i.card.kind === "word")
    .slice(0, allowance)
    // Cloze/dictation cards without a review row enter with the due deck's
    // cadence instead: they were created because of the learner's own
    // sentences/mistakes, not throttled curriculum.
    .concat(fresh.filter((i) => i.card.kind !== "word"));

  const { queue, keySequence } = interleave(due, freshTake);
  return { queue, keySequence, dueCount: due.length, newAllowance: allowance };
}

async function introducedWordCardsToday(
  language: string,
  nowMs: number,
): Promise<number> {
  const since = startOfDayMs(nowMs);
  const total = await countCardsIntroducedSince(language, since);
  if (total === 0) return 0;
  const rows = await getDb()
    .cardReviews.where("[language+introducedAt]")
    .between([language, since], [language, Infinity])
    .toArray();
  const cards = await getDb().cards.bulkGet(rows.map((r) => r.cardId));
  return cards.filter((c) => c?.kind === "word").length;
}
