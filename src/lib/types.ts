import type {
  AskResult,
  ComposeResult,
  ErrorType,
  GlossResult,
  OutputFeedbackResult,
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

// --- A1 课程 (Goethe A1 curriculum) — Dexie v6 ---
//
// Objectively-graded card decks (word/cloze/dictation) + study log + streak +
// curriculum state. Cards are SEPARATE from islands/sentences/reviews: reviews
// stays keyed by sentenceId (LLM-judged free production), cards are instant
// offline-graded exercises. One FSRS scheduler, two state tables (sr.ts is
// generic over SrFields). See docs/echo-a1-cc-plan-prompt.md + the plan.

export type CardKind = "word" | "cloze" | "dictation";
/** 承重墙 #3 形态匹配: recognition trains recognition, production trains production. */
export type CardTemplate = "recognition" | "production";

export interface WordCardPayload {
  lemma: string;
  pos:
    | "noun"
    | "verb"
    | "adj"
    | "adv"
    | "prep"
    | "pron"
    | "num"
    | "phrase"
    | "other";
  /** REQUIRED when pos === "noun" — the loader throws on a noun without it. */
  article?: "der" | "die" | "das";
  /** REQUIRED (key present) for nouns; null = no plural exists (die Milch). */
  plural?: string | null;
  meaningZh: string;
  example: string;
  exampleZh: string;
  ipa?: string;
}

export interface ClozePayload {
  /** Island sentence this cloze derives from (target is a snapshot). */
  sentenceId: string;
  target: string;
  clozeIndex: number;
  answer: string;
  hint?: string;
}

export interface DictationErrorPayload {
  text: string;
  mode: "sentence" | "number";
  numberKind?: "phone" | "price" | "time";
  sentenceId?: string;
}

export interface CardRecord {
  /** Deterministic: de.a1.w.<slug>.<template> | de.a1.cz.<sentenceId>.<idx> |
   *  de.a1.dk.<hash> — reloads and repeat failures are idempotent. */
  id: string;
  language: string;
  kind: CardKind;
  template: CardTemplate;
  /** Interleave + filter keys (multiEntry-indexed): gender / pattern / vocab /
   *  dictation / noun / topic:*. */
  tags: string[];
  payload: WordCardPayload | ClozePayload | DictationErrorPayload;
  createdAt: number;
  seedVersion?: number;
}

/** FSRS state for a card. No masteryStage (the stage machine is the sentence
 *  track's exclusive model, learning-method.md §2) and no ease (born on FSRS).
 *  A card with no CardReviewState row is "new" — same by-absence convention as
 *  sentences. */
export interface CardReviewState {
  cardId: string;
  language: string;
  due: number;
  interval: number;
  repetitions: number;
  lastReviewedAt: number | null;
  stability?: number;
  difficulty?: number;
  lapses?: number;
  fsrsState?: 0 | 1 | 2 | 3;
  errorTags?: ErrorTag[];
  /** When the card first entered the queue — drives the daily new-card throttle
   *  via the [language+introducedAt] index. */
  introducedAt: number;
}

export interface DictationAttempt {
  id: string;
  language: string;
  mode: "sentence" | "number";
  numberKind?: "phone" | "price" | "time";
  /** Reference text the audio spoke. */
  text: string;
  typed: string;
  /** 0..1 character accuracy. */
  accuracy: number;
  /** Ladder level at attempt time (1..5). */
  level: number;
  sentenceId?: string;
  createdAt: number;
}

/** 七类学时 (M7). Auto-classified from StudyLogEvent.source — never user-picked. */
export type ActivityClass =
  | "input"
  | "srs"
  | "output"
  | "exam"
  | "hvpt"
  | "realuse"
  | "buffer";

export interface StudyLogEvent {
  id: string;
  language: string;
  activity: ActivityClass;
  source:
    | "review"
    | "cardSession"
    | "diktat"
    | "shadow"
    | "quiz"
    | "outputTask"
    | "hvpt"
    | "speaking"
    | "checkpoint";
  durationMs: number;
  /** Cards graded / sentences dictated / clips shadowed … */
  units: number;
  /** Local-midnight day key "2026-07-26" — indexed. */
  dayKey: string;
  /** Free-form JSON detail, e.g. the interleave key sequence of a card session
   *  (P0 acceptance: 交错调度可在日志中验证). Un-indexed. */
  detail?: string;
  createdAt: number;
}

/** Incrementally-maintained daily rollup so the streak never scans raw events. */
export interface StudyDay {
  /** `${language}|${dayKey}` */
  id: string;
  language: string;
  dayKey: string;
  msByActivity: Partial<Record<ActivityClass, number>>;
  srsCardsGraded: number;
  srsQueueCleared: boolean;
  inputUnits: number;
  outputUnits: number;
  /** MVD (最低可行日) reached — derived + stored for cheap streak walks. */
  mvd: boolean;
  updatedAt: number;
}

/** Append-only per-review log. The ONLY data source for the M7 mature-card
 *  retention report and a future per-user FSRS optimizer — cannot be backfilled,
 *  which is why it ships in P0. */
export interface ReviewLogEntry {
  id: string;
  /** sentenceId (deck "sentence") or cardId (deck "card"). */
  cardId: string;
  deck: "sentence" | "card";
  language: string;
  ts: number;
  grade: "again" | "hard" | "good" | "easy";
  verdict?: string;
  /** Interval (days) that was scheduled when this review came due. */
  scheduledInterval: number;
  elapsedDays: number;
}

export type CurriculumPhase = "cold-start" | "main-build" | "exam-prep";

/** Per-course singleton (`${language}.a1`). Phase is NEVER stored — it is
 *  derived by src/lib/a1/phase.ts (zero-config, cannot desync). */
export interface CurriculumState {
  id: string;
  language: string;
  course: "a1";
  startedAt: number;
  /** The one user-entered fact; drives exam-prep (≤10 days out). */
  examDate: number | null;
  /** M2 if-then implementation intention: "___之后，我就在___做 20 分钟德语". */
  intention?: { trigger: string; place: string; createdAt: number };
  // M4 length-ladder state (rides backup for free):
  diktatLevel: number;
  diktatUpStreak: number;
  diktatDownStreak: number;
  updatedAt: number;
}

// --- P2: HVPT 感知训练 + 检查点 — Dexie v8 ---

/** Per-pair HVPT discrimination stats (mirrors QuizProgress: streak ≥ 3 =
 *  mastered, the drill resamples unseen → wrong → rest). Perception errors do
 *  NOT create SRS cards — the weighted resampling IS the loop. */
export interface HvptProgress {
  pairId: string;
  attempts: number;
  correct: number;
  wrong: number;
  /** Consecutive correct; reset on a wrong answer. ≥3 = mastered. */
  streak: number;
  updatedAt: number;
}

/** M7 checkpoint: one full Goethe A1 digital mock exam's section scores. */
export interface CheckpointRecord {
  id: string;
  language: string;
  kind: "mock-exam";
  takenAt: number;
  scores: { hoeren: number; lesen: number; schreiben: number; sprechen: number };
  /** /100, Goethe digital scale (pass ≥60, internal target ≥75). */
  total: number;
  note?: string;
}

// --- M5 每日产出任务 (output loop) — Dexie v7 ---

export type OutputDraftStatus = "draft" | "submitted" | "reviewed" | "error";

/** One production task per (language, day). Inbox-style status machine so a
 *  submitted job survives reload/disconnect (jobId persisted, polling resumes):
 *  draft → submitted → reviewed | error (error is retryable). */
export interface OutputDraft {
  /** `${language}|${dayKey}` — the day's task, one per day. */
  id: string;
  language: string;
  dayKey: string;
  templateId: string;
  attempt: string;
  status: OutputDraftStatus;
  jobId?: string;
  result?: OutputFeedbackResult;
  error?: string;
  /** Offline self-check ticks against the 3 coverage points (离线降级变体). */
  selfCheck?: boolean[];
  /** Guard: corrections were already turned into error cards. */
  cardsCreated?: boolean;
  createdAt: number;
  updatedAt: number;
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
