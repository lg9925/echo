import type {
  AskResult,
  ComposeResult,
  ErrorType,
  GlossResult,
  ScenarioResult,
  TargetLanguage,
} from "./api/contracts";

export interface Island {
  id: string;
  language: string;
  name: string;
  order: number;
}

export interface Sentence {
  id: string;
  islandId: string;
  language: string;
  islandOrder: number;
  indexInIsland: number;
  native: string;
  target: string;
  ipa: string | null;
  frame: string;
  literal: string;
  note: string;
  variants: string[];
  audio: string | null;
}

/** 掌握阶段 (mastery stage), see docs/learning-method.md §2.
 *  0 理解 · 1 模仿 · 2 回忆 · 3 运用. */
export type MasteryStage = 0 | 1 | 2 | 3;

export interface ReviewState {
  sentenceId: string;
  language: string;
  ease: number;
  interval: number;
  repetitions: number;
  due: number;
  lastReviewedAt: number | null;
  /** A review row only exists because the card was actively recalled, so it is
   *  stage 2 by default; a sentence with no row is a new card = stage 0 (by
   *  absence). Stage transitions land in 7.3+ — not wired yet. */
  masteryStage: MasteryStage;
  // FSRS memory state (added with the FSRS swap; learning-method.md §3 /
  // srs-error-deck.md §3). All OPTIONAL + un-indexed → legacy rows (v5, SM-2
  // dimensions only) are initialised lazily on their first FSRS review, so no
  // Dexie migration is needed. `ease` above is now a vestigial SM-2 field.
  /** FSRS stability (days). */
  stability?: number;
  /** FSRS difficulty (1–10). */
  difficulty?: number;
  /** Cumulative lapses (FSRS Card.lapses) — kept so difficulty doesn't drift. */
  lapses?: number;
  /** FSRS State enum: 0 New · 1 Learning · 2 Review · 3 Relearning. */
  fsrsState?: 0 | 1 | 2 | 3;
  /** Accumulated typed failures, folded across reviews by (type, detail) — see
   *  src/lib/errorTags.ts. Optional + un-indexed (no Dexie migration), foundation
   *  for "专练某类错误" / cross-card 专项 later (srs-error-deck.md §6 step 4). */
  errorTags?: ErrorTag[];
}

/** A typed failure accumulated on a ReviewState. The wire form from judge is
 *  JudgeErrorTag (type + detail only); count/lastSeen are folded client-side. */
export interface ErrorTag {
  type: ErrorType;
  detail?: string;
  count: number;
  lastSeen: number;
}

export interface SeedMeta {
  key: string;
  language: string;
  version: number;
  loadedAt: number;
}

export interface RawIsland {
  name: string;
  order: number;
  sentences: RawSentence[];
}

export interface RawSentence {
  native: string;
  target: string;
  ipa?: string;
  frame: string;
  literal: string;
  note: string;
  variants: string[];
}

export interface RawSeed {
  language: string;
  language_label?: string;
  version?: number;
  islands: RawIsland[];
}

// --- Phase 2: inbox + audio cache (Dexie v2) ---

/**
 * 想说 (say) = compose a sentence; 想懂 (understand) = gloss a word;
 * 场景 (scenario) = generate a whole island of sentences from a scene;
 * 提问 (ask) = free-form Q&A kept as a reviewable record.
 */
export type InboxKind = "say" | "understand" | "scenario" | "ask";

export type InboxStatus =
  | "captured" // just dropped in, not processed
  | "processing" // backend call in flight
  | "ready" // result filled, awaiting user confirmation
  | "error" // processing failed (retryable)
  | "added"; // turned into a learning card

export interface InboxItem {
  id: string;
  kind: InboxKind;
  language: TargetLanguage;
  /** What the user typed/spoke, verbatim. */
  rawText: string;
  inputMode: "text" | "voice";
  status: InboxStatus;
  createdAt: number;
  updatedAt: number;
  /** Backend job id while a slow task runs (set on "processing"); lets a
   *  reload/disconnect resume polling the same server-side job. */
  jobId?: string;
  /** Filled when status reaches "ready". Shape depends on kind. */
  result?: ComposeResult | GlossResult | ScenarioResult | AskResult;
  error?: string;
  /** Set when status reaches "added". */
  addedSentenceId?: string;
  addedIslandId?: string;
  /** A scenario can split into several sub-islands; all their ids land here
   *  (addedIslandId stays = the first, for back-compat). */
  addedIslandIds?: string[];
}

/** Cached neural-TTS audio, keyed by hash(lang|voiceBucket|rateBucket|text). */
export interface AudioCacheEntry {
  key: string;
  blob: Blob;
  mime: string;
  createdAt: number;
}

// --- Phase 3f: vocabulary (字词表) — Dexie v3 ---

/** A context where a vocab term appears: links back to a sentence (with a text
 *  snapshot so the context survives even if the sentence is edited/deleted). */
export interface VocabRef {
  sentenceId: string | null;
  islandId: string | null;
  text: string | null;
}

/**
 * 字词表 entry: a key word/phrase the user is collecting, centered on the
 * islands it appears in. An index, NOT a review card — it only becomes a card
 * when the user explicitly "adds to learning".
 */
export interface VocabEntry {
  id: string;
  language: string;
  term: string;
  meaning: string;
  refs: VocabRef[];
  createdAt: number;
}

// --- 德国入籍考试 (Einbürgerungstest) — Dexie v4 ---
//
// A fully ISOLATED quiz module: objective multiple-choice questions, graded by
// `options[].correct` (never by position). It does NOT touch islands/sentences/
// reviews and does NOT use the sentence SR scheduler. See plan & CLAUDE.md 原则五.

/** Either the all-Germany core test (1–300) or the NRW state addendum (391–400). */
export type QuizRegion = "national" | "nrw";

/** Optional memory-aid layer. Absent/empty must not break core answering. */
export interface QuizStudy {
  tags: string[]; // 技巧标签: 否定/数字/价值观/图片/配对 — filter + card badge
  anchor_q: string; // 题干锚点(德)
  anchor_a: string; // 答案锚点(德)
  hint_zh: string; // 一句话中文记忆提示，做完/翻面后显示
}

export interface QuizOption {
  de: string;
  zh: string;
  correct: boolean;
  /** Word-by-word German→Chinese gloss. AI-pregenerated for the correct option
   *  only (practice shows it under the right answer); null otherwise. */
  literal?: string | null;
}

/**
 * One citizenship-test question. `id` is the stable integer primary key
 * (1–300 = national, 391–400 = NRW); `day`/`region`/`tags` are derived at load
 * time from `id` + `study` so they can be indexed for filtering.
 */
export interface QuizQuestion {
  id: number;
  category: string; // 中文细分类，如 "政治·选举"
  image: string | null; // 图片题的图片 URL；普通题为 null
  question_de: string;
  question_zh: string;
  options: QuizOption[]; // 恰好一个 correct=true
  study: QuizStudy | null;
  /** Word-by-word German→Chinese gloss (like a 句子岛 literal). AI-pregenerated
   *  into the source JSON; null until that pass has run. */
  literal: string | null;
  // derived (denormalised for indexing/filtering):
  day: number; // 1–6 (D1–D6)
  region: QuizRegion;
  tags: string[]; // = study?.tags ?? [] (top-level for the multiEntry index)
}

/** Lightweight per-question progress — mistake tracking, NOT dated SR scheduling. */
export interface QuizProgress {
  questionId: number;
  attempts: number;
  correct: number;
  wrong: number;
  lastResult: "correct" | "wrong" | null;
  starred: 0 | 1; // boolean as 0/1 so it's a valid Dexie index key
  /** Consecutive correct answers; reset to 0 on a wrong answer. 连对 3 次 = 掌握
   *  (mistakes graduate out of the 错题本 pool). Not indexed — old rows without
   *  it read as 0, no Dexie migration needed. */
  streak?: number;
  updatedAt: number;
}
