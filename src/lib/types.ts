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
