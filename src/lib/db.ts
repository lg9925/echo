import Dexie, { type EntityTable } from "dexie";
import type {
  AudioCacheEntry,
  InboxItem,
  Island,
  ReviewState,
  Sentence,
  SeedMeta,
  VocabEntry,
} from "./types";

class EchoDB extends Dexie {
  islands!: EntityTable<Island, "id">;
  sentences!: EntityTable<Sentence, "id">;
  reviews!: EntityTable<ReviewState, "sentenceId">;
  meta!: EntityTable<SeedMeta, "key">;
  inbox!: EntityTable<InboxItem, "id">;
  audioCache!: EntityTable<AudioCacheEntry, "key">;
  vocab!: EntityTable<VocabEntry, "id">;

  constructor() {
    super("echo");
    this.version(1).stores({
      islands: "&id, language, order, [language+order]",
      sentences: "&id, islandId, language, [islandId+indexInIsland]",
      reviews: "&sentenceId, language, due, [language+due]",
      meta: "&key, language",
    });
    // v2 only adds tables; v1 tables are inherited untouched (reviews are
    // never wiped). No upgrade fn needed — no data migration.
    this.version(2).stores({
      inbox: "&id, status, language, [status+language], createdAt",
      audioCache: "&key, createdAt",
    });
    // v3 adds the 字词表 (vocab) — additive, no migration.
    this.version(3).stores({
      vocab: "&id, language, [language+term], [language+createdAt]",
    });
  }
}

let _db: EchoDB | null = null;

export function getDb(): EchoDB {
  if (typeof window === "undefined") {
    throw new Error("getDb() called outside the browser");
  }
  if (!_db) {
    _db = new EchoDB();
  }
  return _db;
}

export async function getIsland(id: string): Promise<Island | undefined> {
  return getDb().islands.get(id);
}

export async function listIslands(language: string): Promise<Island[]> {
  const db = getDb();
  return db.islands
    .where("[language+order]")
    .between([language, Dexie.minKey], [language, Dexie.maxKey])
    .sortBy("order");
}

export async function listSentencesByIsland(
  islandId: string,
): Promise<Sentence[]> {
  const db = getDb();
  return db.sentences
    .where("[islandId+indexInIsland]")
    .between([islandId, Dexie.minKey], [islandId, Dexie.maxKey])
    .sortBy("indexInIsland");
}

export async function countSentencesByIsland(
  islandId: string,
): Promise<number> {
  const db = getDb();
  return db.sentences.where("islandId").equals(islandId).count();
}

export async function dueReviews(
  language: string,
  nowMs: number,
): Promise<ReviewState[]> {
  const db = getDb();
  return db.reviews
    .where("[language+due]")
    .between([language, Dexie.minKey], [language, nowMs])
    .toArray();
}

export async function listAllSentences(
  language: string,
): Promise<Sentence[]> {
  const db = getDb();
  return db.sentences.where("language").equals(language).toArray();
}

export async function listAllReviews(
  language: string,
): Promise<ReviewState[]> {
  const db = getDb();
  return db.reviews.where("language").equals(language).toArray();
}

export async function countDueForLanguage(
  language: string,
  nowMs: number,
): Promise<number> {
  const db = getDb();
  const due = await db.reviews
    .where("[language+due]")
    .between([language, Dexie.minKey], [language, nowMs])
    .count();
  const totalSentences = await db.sentences
    .where("language")
    .equals(language)
    .count();
  const totalReviews = await db.reviews
    .where("language")
    .equals(language)
    .count();
  const newCards = Math.max(0, totalSentences - totalReviews);
  return due + newCards;
}

export async function getReview(
  sentenceId: string,
): Promise<ReviewState | undefined> {
  const db = getDb();
  return db.reviews.get(sentenceId);
}

/** Per-island count of cards due-or-new (no review yet) for the hub badges.
 *  One pass over the language's sentences + reviews; grouped by islandId. */
export async function dueCountsByIsland(
  language: string,
  nowMs: number,
): Promise<Record<string, number>> {
  const [sentences, reviews] = await Promise.all([
    listAllSentences(language),
    listAllReviews(language),
  ]);
  const reviewById = new Map(reviews.map((r) => [r.sentenceId, r]));
  const counts: Record<string, number> = {};
  for (const s of sentences) {
    const r = reviewById.get(s.id);
    if (!r || r.due <= nowMs) {
      counts[s.islandId] = (counts[s.islandId] ?? 0) + 1;
    }
  }
  return counts;
}

export async function upsertReview(state: ReviewState): Promise<void> {
  const db = getDb();
  await db.reviews.put(state);
}

export async function getMeta(key: string): Promise<SeedMeta | undefined> {
  const db = getDb();
  return db.meta.get(key);
}

export async function listVocab(language: string): Promise<VocabEntry[]> {
  const db = getDb();
  return db.vocab
    .where("[language+createdAt]")
    .between([language, Dexie.minKey], [language, Dexie.maxKey])
    .reverse()
    .toArray();
}

export async function findVocabByTerm(
  language: string,
  term: string,
): Promise<VocabEntry | undefined> {
  const db = getDb();
  return db.vocab.where("[language+term]").equals([language, term]).first();
}
