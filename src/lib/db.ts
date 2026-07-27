import Dexie, { type EntityTable } from "dexie";
import type {
  AudioCacheEntry,
  CardRecord,
  CardReviewState,
  CheckpointRecord,
  CurriculumState,
  DictationAttempt,
  HvptProgress,
  InboxItem,
  Island,
  OutputDraft,
  QuizProgress,
  QuizQuestion,
  ReviewLogEntry,
  ReviewState,
  Sentence,
  SeedMeta,
  StudyDay,
  StudyLogEvent,
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
  quizQuestions!: EntityTable<QuizQuestion, "id">;
  quizProgress!: EntityTable<QuizProgress, "questionId">;
  cards!: EntityTable<CardRecord, "id">;
  cardReviews!: EntityTable<CardReviewState, "cardId">;
  dictationAttempts!: EntityTable<DictationAttempt, "id">;
  studyLog!: EntityTable<StudyLogEvent, "id">;
  studyDays!: EntityTable<StudyDay, "id">;
  reviewLog!: EntityTable<ReviewLogEntry, "id">;
  curriculum!: EntityTable<CurriculumState, "id">;
  outputDrafts!: EntityTable<OutputDraft, "id">;
  hvptProgress!: EntityTable<HvptProgress, "pairId">;
  checkpoints!: EntityTable<CheckpointRecord, "id">;

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
    // v4 adds the isolated 入籍考试 (Einbürgerungstest) quiz tables — additive,
    // no migration. quizProgress is never wiped when the question bank reloads.
    this.version(4).stores({
      quizQuestions: "&id, category, day, region, *tags",
      quizProgress: "&questionId, lastResult, starred, updatedAt",
    });
    // v5 adds masteryStage to reviews (掌握阶段, learning-method.md §2). Not
    // indexed — the reviews index string is unchanged; the upgrade only backfills
    // existing rows. A review row only exists because the card was recalled, so
    // every existing row is stage 2; cards with no row stay stage 0 (new) by
    // absence. reviews is never wiped.
    this.version(5).stores({}).upgrade(async (tx) => {
      await tx
        .table("reviews")
        .toCollection()
        .modify((r) => {
          if (r.masteryStage === undefined) r.masteryStage = 2;
        });
    });
    // v6 adds the A1 课程 tables (word/cloze/dictation cards + study log +
    // streak rollup + review log + curriculum state) — purely additive, no
    // migration, reviews untouched. cardReviews is the FSRS state for cards
    // (a card with no row is "new", same by-absence convention as sentences);
    // [language+introducedAt] backs the daily new-card throttle. studyDays is
    // the incrementally-maintained rollup so streak walks never scan studyLog.
    // reviewLog is append-only (M7 retention report — cannot be backfilled).
    this.version(6).stores({
      cards: "&id, language, kind, *tags, [language+kind], createdAt",
      cardReviews: "&cardId, language, [language+due], [language+introducedAt]",
      dictationAttempts: "&id, [language+createdAt]",
      studyLog: "&id, dayKey, [language+dayKey], createdAt",
      studyDays: "&id, dayKey, [language+dayKey]",
      reviewLog: "&id, [language+ts], [deck+ts]",
      curriculum: "&id, language",
    });
    // v7 adds the M5 每日产出任务 drafts — additive, no migration. One row per
    // (language, day); a submitted job's id is persisted so polling resumes
    // after reload (inbox pattern).
    this.version(7).stores({
      outputDrafts: "&id, language, [language+dayKey], status, updatedAt",
    });
    // v8 adds the P2 tables — additive, no migration. hvptProgress mirrors
    // quizProgress (per-pair streak stats, never wiped by content updates);
    // checkpoints holds the 3 mock-exam section scores (M7).
    this.version(8).stores({
      hvptProgress: "&pairId, updatedAt",
      checkpoints: "&id, [language+takenAt]",
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

// --- 德国入籍考试 (Einbürgerungstest) quiz helpers ---

/** All questions, sorted by stable id. Components filter in memory (310 rows). */
export async function listQuizQuestions(): Promise<QuizQuestion[]> {
  const db = getDb();
  return db.quizQuestions.orderBy("id").toArray();
}

export async function countQuizQuestions(): Promise<number> {
  return getDb().quizQuestions.count();
}

export async function listAllQuizProgress(): Promise<QuizProgress[]> {
  return getDb().quizProgress.toArray();
}

/** Record one answer, folding into existing stats. Returns the new progress. */
export async function recordQuizAnswer(
  questionId: number,
  isCorrect: boolean,
  nowMs: number = Date.now(),
): Promise<QuizProgress> {
  const db = getDb();
  const prev = await db.quizProgress.get(questionId);
  const next: QuizProgress = {
    questionId,
    attempts: (prev?.attempts ?? 0) + 1,
    correct: (prev?.correct ?? 0) + (isCorrect ? 1 : 0),
    wrong: (prev?.wrong ?? 0) + (isCorrect ? 0 : 1),
    lastResult: isCorrect ? "correct" : "wrong",
    starred: prev?.starred ?? 0,
    // 连对计数:答错清零;旧行无 streak 视作 0(懒初始化,无迁移)。
    streak: isCorrect ? (prev?.streak ?? 0) + 1 : 0,
    updatedAt: nowMs,
  };
  await db.quizProgress.put(next);
  return next;
}

/** Toggle the 标记复习 (mark-for-review) bookmark on a question. Persistent —
 *  only cleared by unmarking, never by answering. Upserts a minimal row if the
 *  question has no progress yet (defensive: marking should never be lost to a
 *  not-yet-landed recordQuizAnswer). */
export async function setQuizStarred(
  questionId: number,
  starred: 0 | 1,
  nowMs: number = Date.now(),
): Promise<QuizProgress> {
  const db = getDb();
  const prev = await db.quizProgress.get(questionId);
  const next: QuizProgress = {
    questionId,
    attempts: prev?.attempts ?? 0,
    correct: prev?.correct ?? 0,
    wrong: prev?.wrong ?? 0,
    lastResult: prev?.lastResult ?? null,
    streak: prev?.streak ?? 0,
    starred,
    updatedAt: nowMs,
  };
  await db.quizProgress.put(next);
  return next;
}

// --- A1 课程 (Dexie v6) helpers ---

export async function listCards(language: string): Promise<CardRecord[]> {
  return getDb().cards.where("language").equals(language).toArray();
}

export async function getCard(id: string): Promise<CardRecord | undefined> {
  return getDb().cards.get(id);
}

export async function putCard(card: CardRecord): Promise<void> {
  await getDb().cards.put(card);
}

export async function listCardReviews(
  language: string,
): Promise<CardReviewState[]> {
  return getDb().cardReviews.where("language").equals(language).toArray();
}

export async function getCardReview(
  cardId: string,
): Promise<CardReviewState | undefined> {
  return getDb().cardReviews.get(cardId);
}

export async function upsertCardReview(state: CardReviewState): Promise<void> {
  await getDb().cardReviews.put(state);
}

export async function dueCardReviews(
  language: string,
  nowMs: number,
): Promise<CardReviewState[]> {
  return getDb()
    .cardReviews.where("[language+due]")
    .between([language, Dexie.minKey], [language, nowMs])
    .toArray();
}

/** Cards whose first CardReviewState landed in [sinceMs, now] — i.e. cards
 *  introduced today. Backs the daily new-card throttle (refresh-proof: the
 *  count is derived from the introducedAt index, not a mutable counter). */
export async function countCardsIntroducedSince(
  language: string,
  sinceMs: number,
): Promise<number> {
  return getDb()
    .cardReviews.where("[language+introducedAt]")
    .between([language, sinceMs], [language, Dexie.maxKey])
    .count();
}

export async function recordDictationAttempt(
  attempt: DictationAttempt,
): Promise<void> {
  await getDb().dictationAttempts.add(attempt);
}

export async function listDictationAttempts(
  language: string,
): Promise<DictationAttempt[]> {
  return getDb()
    .dictationAttempts.where("[language+createdAt]")
    .between([language, Dexie.minKey], [language, Dexie.maxKey])
    .toArray();
}

export async function getCurriculum(
  language: string,
): Promise<CurriculumState | undefined> {
  return getDb().curriculum.get(`${language}.a1`);
}

export async function putCurriculum(state: CurriculumState): Promise<void> {
  await getDb().curriculum.put(state);
}

export async function getStudyDay(
  language: string,
  dayKey: string,
): Promise<StudyDay | undefined> {
  return getDb().studyDays.get(`${language}|${dayKey}`);
}

export async function putStudyDay(day: StudyDay): Promise<void> {
  await getDb().studyDays.put(day);
}

export async function listStudyDays(language: string): Promise<StudyDay[]> {
  return getDb()
    .studyDays.where("[language+dayKey]")
    .between([language, Dexie.minKey], [language, Dexie.maxKey])
    .toArray();
}

export async function addStudyLogEvent(event: StudyLogEvent): Promise<void> {
  await getDb().studyLog.add(event);
}

export async function addReviewLogEntry(entry: ReviewLogEntry): Promise<void> {
  await getDb().reviewLog.add(entry);
}

export async function getOutputDraft(
  language: string,
  dayKey: string,
): Promise<OutputDraft | undefined> {
  return getDb().outputDrafts.get(`${language}|${dayKey}`);
}

export async function putOutputDraft(draft: OutputDraft): Promise<void> {
  await getDb().outputDrafts.put(draft);
}

export async function listRecentOutputDrafts(
  language: string,
  limit: number,
): Promise<OutputDraft[]> {
  return getDb()
    .outputDrafts.where("[language+dayKey]")
    .between([language, Dexie.minKey], [language, Dexie.maxKey])
    .reverse()
    .limit(limit)
    .toArray();
}

// --- P2 (Dexie v8) helpers ---

export async function listHvptProgress(): Promise<HvptProgress[]> {
  return getDb().hvptProgress.toArray();
}

/** Record one AB answer, folding into existing stats (recordQuizAnswer pattern). */
export async function recordHvptAnswer(
  pairId: string,
  isCorrect: boolean,
  nowMs: number = Date.now(),
): Promise<HvptProgress> {
  const db = getDb();
  const prev = await db.hvptProgress.get(pairId);
  const next: HvptProgress = {
    pairId,
    attempts: (prev?.attempts ?? 0) + 1,
    correct: (prev?.correct ?? 0) + (isCorrect ? 1 : 0),
    wrong: (prev?.wrong ?? 0) + (isCorrect ? 0 : 1),
    streak: isCorrect ? (prev?.streak ?? 0) + 1 : 0,
    updatedAt: nowMs,
  };
  await db.hvptProgress.put(next);
  return next;
}

export async function listCheckpoints(
  language: string,
): Promise<CheckpointRecord[]> {
  return getDb()
    .checkpoints.where("[language+takenAt]")
    .between([language, Dexie.minKey], [language, Dexie.maxKey])
    .toArray();
}

export async function addCheckpoint(record: CheckpointRecord): Promise<void> {
  await getDb().checkpoints.add(record);
}

export async function listReviewLog(language: string): Promise<ReviewLogEntry[]> {
  return getDb()
    .reviewLog.where("[language+ts]")
    .between([language, Dexie.minKey], [language, Dexie.maxKey])
    .toArray();
}
