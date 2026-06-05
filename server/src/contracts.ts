// Request/response wire types for echo-server.
//
// MIRROR: src/lib/api/contracts.ts (frontend). Keep the two files in sync —
// the frontend imports its own copy so the static build has no dependency on
// this package. When you change a shape here, change it there too.

export type TargetLanguage = "de" | "en";

// --- 学习画像(可选的生成 context,按目标语言)---

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface LearnerProfile {
  level: CefrLevel | null;
  /** 自由文本背景/目标:职业、兴趣、在跟的教材、想考的级别…… */
  background: string;
}

// --- /v1/compose ("想说": 中文 → 地道外语跟读卡) ---

export interface ComposeRequest {
  language: TargetLanguage;
  /** 用户说的中文。 */
  native: string;
  profile?: LearnerProfile;
}

/** Maps 1:1 onto the fields of a learning card (see src/lib/types.ts Sentence). */
export interface ComposeResult {
  native: string;
  target: string;
  frame: string;
  literal: string;
  note: string;
  variants: string[];
  ipa: string | null;
  /** AI 建议归到哪个岛(岛名);前端用来匹配已有种子岛,匹配不到落 picked 岛。 */
  suggestedIslandName: string | null;
}

// --- /v1/gloss ("想懂": 没懂的外语词/短语 → 含义+候选+例句) ---

export interface GlossRequest {
  language: TargetLanguage;
  /** 听到/拼不准的外语词或短语,可能模糊。 */
  query: string;
}

export interface GlossCandidate {
  /** 纠正/识别成的正确外语。德语名词带冠词,如 "der Tisch"。 */
  target: string;
  /** 词性,如 "名词" / "动词"。 */
  pos: string | null;
  /** 德语名词冠词;非名词或其它语言为 null。 */
  article: "der" | "die" | "das" | null;
  note: string | null;
}

export interface GlossResult {
  /** 中文含义。 */
  meaning: string;
  /** 1–3 个候选(输入模糊时给多个)。 */
  candidates: GlossCandidate[];
  /** 一个自然例句。 */
  example: { target: string; native: string };
  suggestedIslandName: string | null;
}

// --- /v1/scenario ("场景": 一句描述 → 一整串按流程排序的句子) ---

export interface ScenarioRequest {
  language: TargetLanguage;
  /** 场景描述(中文),如 "坐飞机,从办理登机牌到出海关"。 */
  description: string;
  profile?: LearnerProfile;
  /** 每个子岛的句子上限(默认 10);生成时按子场景拆,每组不超过它。 */
  maxPerIsland?: number;
}

/** One card in a generated scenario island (same fields as a Sentence). */
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
  /** 场景岛名(中文),如 "机场流程"。 */
  islandName: string;
  /** 按流程顺序排列的句子,15+。 */
  sentences: ScenarioSentence[];
}

// --- /v1/split ("拆岛": 过大的岛 → 2–3 个子岛分组建议) ---

export interface SplitInputSentence {
  native: string;
  target: string;
}

export interface SplitRequest {
  language: TargetLanguage;
  /** 当前岛名(中文)。 */
  islandName: string;
  /** 岛内全部句子,顺序与下标一致。 */
  sentences: SplitInputSentence[];
  profile?: LearnerProfile;
}

export interface SplitGroup {
  /** 子岛名,用分组标签,如 "酒店/入住"。 */
  subIslandName: string;
  /** 属于这个子岛的句子下标(对应请求里 sentences 的顺序)。 */
  indices: number[];
}

export interface SplitResult {
  /** 2–3 个子岛,按流程顺序;并集覆盖全部句子、互不重叠。 */
  groups: SplitGroup[];
}

// --- /v1/keywords ("提取关键词": 一个岛的句子 → 关键词 + 释义 + 出处) ---

export interface KeywordsRequest {
  language: TargetLanguage;
  islandName: string;
  sentences: { native: string; target: string }[];
  profile?: LearnerProfile;
}

export interface KeywordItem {
  /** 关键词/短语(外语;名词带冠词)。 */
  term: string;
  /** 中文释义。 */
  meaning: string;
  /** 出现在哪些句子(下标,对应请求里 sentences 的顺序)。 */
  indices: number[];
}

export interface KeywordsResult {
  keywords: KeywordItem[];
}

// --- /v1/ask ("随手助手": 学习者的问题 → 中文解答) ---

export interface AskRequest {
  language: TargetLanguage;
  /** 学习者的问题(中文/混合),如 "der/die/das 怎么记"。 */
  question: string;
  profile?: LearnerProfile;
}

export interface AskResult {
  /** 中文解答,可含 Markdown 与地道例句。 */
  answer: string;
  /** 可一键「加入学习」的例句(target=外语,native=中文)。 */
  examples: { target: string; native: string }[];
  /** 可一键「收进字词表」的关键词(term=外语,meaning=中文释义)。 */
  words: { term: string; meaning: string }[];
}

// --- /v1/jobs (async queue: submit a slow task → poll for the result) ---

/** Tasks that can run as a background job. Each `input` is that task's request
 *  body and each `result` is its *Result type (carried untyped over the wire). */
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

// --- /v1/routing (admin: switch which provider+model serves each task) ---

export type LlmTaskName =
  | "authoring"
  | "gloss"
  | "scenario"
  | "split"
  | "keywords"
  | "ask";

export type LlmProviderName =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "claude-cli"
  | "gemini"
  | "gemini-cli";

export interface RoutingTaskState {
  task: LlmTaskName;
  provider: LlmProviderName;
  model: string;
  maxTokens: number;
  /** true when a runtime override is set (vs env/code default). */
  overridden: boolean;
  /** The raw override (or null). `model: null` = "use the provider default"
   *  (resolved live), so it follows catalog updates instead of pinning. */
  override: { provider: LlmProviderName | null; model: string | null } | null;
}

export interface RoutingProviderInfo {
  provider: LlmProviderName;
  /** Whether the provider's credential is present server-side. */
  configured: boolean;
  /** Curated model menu for this provider (first = sensible default). */
  models: string[];
}

export interface RoutingState {
  tasks: RoutingTaskState[];
  providers: RoutingProviderInfo[];
}

/** PUT body. Omit/empty both provider and model to clear the override. */
export interface RoutingUpdate {
  task: LlmTaskName;
  provider?: string;
  model?: string;
}

// --- /v1/tts (returns binary audio/mpeg, not JSON) ---

export interface TtsRequest {
  text: string;
  /** 语种短码或 BCP-47,如 "de" / "de-DE"。 */
  lang: string;
  /** 可选音色预设 id;省略则用 VOICE_PRESETS 默认。 */
  voice?: string;
  /** 0.5–1.5;< 1 视为慢速。 */
  rate?: number;
}

// --- errors ---

export interface ApiError {
  error: string;
  detail?: string;
}
