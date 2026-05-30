import type {
  ComposeResult,
  GlossResult,
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

/** 想说 (say) = compose a sentence; 想懂 (understand) = gloss a word. */
export type InboxKind = "say" | "understand";

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
  /** Filled when status reaches "ready". Shape depends on kind. */
  result?: ComposeResult | GlossResult;
  error?: string;
  /** Set when status reaches "added". */
  addedSentenceId?: string;
  addedIslandId?: string;
}

/** Cached neural-TTS audio, keyed by hash(lang|voiceBucket|rateBucket|text). */
export interface AudioCacheEntry {
  key: string;
  blob: Blob;
  mime: string;
  createdAt: number;
}
