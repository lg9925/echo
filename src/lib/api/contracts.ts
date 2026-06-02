// Wire types for the echo-server API.
//
// MIRROR: server/src/contracts.ts. Keep the two in sync — this copy exists so
// the static frontend build has no dependency on the backend package.

export type TargetLanguage = "de" | "en";

// --- /v1/compose ("想说") ---

export interface ComposeRequest {
  language: TargetLanguage;
  native: string;
}

export interface ComposeResult {
  native: string;
  target: string;
  frame: string;
  literal: string;
  note: string;
  variants: string[];
  ipa: string | null;
  suggestedIslandName: string | null;
}

// --- /v1/gloss ("想懂") ---

export interface GlossRequest {
  language: TargetLanguage;
  query: string;
}

export interface GlossCandidate {
  target: string;
  pos: string | null;
  article: "der" | "die" | "das" | null;
  note: string | null;
}

export interface GlossResult {
  meaning: string;
  candidates: GlossCandidate[];
  example: { target: string; native: string };
  suggestedIslandName: string | null;
}

// --- /v1/scenario ("场景") ---

export interface ScenarioRequest {
  language: TargetLanguage;
  description: string;
}

export interface ScenarioSentence {
  native: string;
  target: string;
  frame: string;
  literal: string;
  note: string;
  variants: string[];
  ipa: string | null;
}

export interface ScenarioResult {
  islandName: string;
  sentences: ScenarioSentence[];
}

// --- /v1/split ("拆岛") ---

export interface SplitInputSentence {
  native: string;
  target: string;
}

export interface SplitRequest {
  language: TargetLanguage;
  islandName: string;
  sentences: SplitInputSentence[];
}

export interface SplitGroup {
  subIslandName: string;
  indices: number[];
}

export interface SplitResult {
  groups: SplitGroup[];
}

// --- /v1/keywords ("提取关键词") ---

export interface KeywordsRequest {
  language: TargetLanguage;
  islandName: string;
  sentences: { native: string; target: string }[];
}

export interface KeywordItem {
  term: string;
  meaning: string;
  indices: number[];
}

export interface KeywordsResult {
  keywords: KeywordItem[];
}

// --- /v1/tts (returns binary audio/mpeg) ---

export interface TtsRequest {
  text: string;
  lang: string;
  voice?: string;
  rate?: number;
}

export interface ApiError {
  error: string;
  detail?: string;
}
