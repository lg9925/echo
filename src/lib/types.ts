import type {
  AskResult,
  ComposeResult,
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

export interface ReviewState {
  sentenceId: string;
  language: string;
  ease: number;
  interval: number;
  repetitions: number;
  due: number;
  lastReviewedAt: number | null;
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
