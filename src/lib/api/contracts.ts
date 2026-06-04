// Wire types for the echo-server API.
//
// MIRROR: server/src/contracts.ts. Keep the two in sync — this copy exists so
// the static frontend build has no dependency on the backend package.

export type TargetLanguage = "de" | "en";

// --- learner profile (optional generation context, per target language) ---

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface LearnerProfile {
  level: CefrLevel | null;
  /** Free-text background/goal: profession, interests, textbook, target exam… */
  background: string;
}

// --- /v1/compose ("想说") ---

export interface ComposeRequest {
  language: TargetLanguage;
  native: string;
  profile?: LearnerProfile;
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
  profile?: LearnerProfile;
  /** 每个子岛的句子上限(默认 10);生成时按子场景拆,每组不超过它。 */
  maxPerIsland?: number;
}

export interface ScenarioSentence {
  native: string;
  target: string;
  frame: string;
  literal: string;
  note: string;
  variants: string[];
  ipa: string | null;
  /** 子场景分组名(如 "药店/问诊");用于把大场景拆成多个 ≤max 的子岛。 */
  group?: string | null;
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
  profile?: LearnerProfile;
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
  profile?: LearnerProfile;
}

export interface KeywordItem {
  term: string;
  meaning: string;
  indices: number[];
}

export interface KeywordsResult {
  keywords: KeywordItem[];
}

// --- /v1/ask ("随手助手" Q&A) ---

export interface AskRequest {
  language: TargetLanguage;
  question: string;
  profile?: LearnerProfile;
}

export interface AskResult {
  answer: string;
  /** 可一键「加入学习」的例句(target=外语,native=中文)。 */
  examples: { target: string; native: string }[];
  /** 可一键「收进字词表」的关键词(term=外语,meaning=中文释义)。 */
  words: { term: string; meaning: string }[];
}

// --- /v1/jobs (async queue: submit a slow task → poll for the result) ---

export type JobTask =
  | "compose"
  | "gloss"
  | "scenario"
  | "split"
  | "keywords"
  | "ask";

export interface JobSubmitRequest {
  task: JobTask;
  input: unknown;
}

export interface JobSubmitResult {
  jobId: string;
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobState {
  status: JobStatus;
  /** Scenario sentence count so far (0 for other tasks). */
  progress: number;
  /** Present when status === "done"; shape = the task's *Result. */
  result?: unknown;
  /** Present when status === "error". */
  error?: string;
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
