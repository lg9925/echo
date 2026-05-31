// Central configuration: which provider serves each task, and per-language
// voice presets. Adding a vendor = add an adapter file + one line here.
// Prompts and output schemas live in llm/ (core), never in adapters.

// --- LLM task routing ---

export type LlmProvider =
  | "anthropic"
  | "openai"
  | "deepseek"
  | "claude-cli"
  | "gemini"
  | "gemini-cli";
export type LlmTask = "authoring" | "gloss" | "scenario";

export interface LlmRoute {
  provider: LlmProvider;
  model: string;
  maxTokens: number;
}

// Test-phase defaults: both tasks → Claude. To save cost later, flip `gloss`
// to { provider: "deepseek", model: "deepseek-chat", ... } — no other change.
const DEFAULT_TASK_ROUTING: Record<LlmTask, LlmRoute> = {
  authoring: { provider: "anthropic", model: "claude-sonnet-4-6", maxTokens: 1500 },
  gloss: { provider: "anthropic", model: "claude-sonnet-4-6", maxTokens: 1200 },
  // Scenario generates 15+ cards in one go — needs a big output budget.
  scenario: { provider: "anthropic", model: "claude-sonnet-4-6", maxTokens: 8192 },
};

// Optional per-task env override (no code change needed to switch a provider):
//   LLM_AUTHORING_PROVIDER=openai LLM_AUTHORING_MODEL=gpt-4o-mini
//   LLM_GLOSS_PROVIDER=deepseek   LLM_GLOSS_MODEL=deepseek-chat
function withEnvOverride(task: LlmTask, base: LlmRoute): LlmRoute {
  const up = task.toUpperCase();
  const provider = process.env[`LLM_${up}_PROVIDER`] as LlmProvider | undefined;
  const model = process.env[`LLM_${up}_MODEL`];
  return {
    provider: provider ?? base.provider,
    model: model ?? base.model,
    maxTokens: base.maxTokens,
  };
}

export const TASK_ROUTING: Record<LlmTask, LlmRoute> = {
  authoring: withEnvOverride("authoring", DEFAULT_TASK_ROUTING.authoring),
  gloss: withEnvOverride("gloss", DEFAULT_TASK_ROUTING.gloss),
  scenario: withEnvOverride("scenario", DEFAULT_TASK_ROUTING.scenario),
};

// --- TTS routing ---

export type TtsProvider = "edge" | "openai" | "google" | "elevenlabs" | "gemini";

// Switch the default TTS provider via the TTS_PROVIDER env var (no code change),
// e.g. TTS_PROVIDER=gemini. Defaults to the free Edge-TTS.
export const TTS_ROUTING: { default: TtsProvider } = {
  default: (process.env.TTS_PROVIDER as TtsProvider) || "edge",
};

// Gemini TTS model (preview). Override with GEMINI_TTS_MODEL. Uses GEMINI_API_KEY.
export const GEMINI_TTS_MODEL =
  process.env.GEMINI_TTS_MODEL ?? "gemini-3.1-flash-tts-preview";

// Per-language × per-provider voice presets. `edge` (free) and `gemini` are
// wired up; openai/google/elevenlabs are placeholders the stubs read once keyed.
// Gemini TTS voices are prebuilt names (Kore/Puck/Charon/Aoede/…), multilingual.
export interface VoicePreset {
  edge: string;
  gemini?: string;
  openai?: string;
  google?: string;
  elevenlabs?: string;
}

export const VOICE_PRESETS: Record<string, VoicePreset> = {
  de: {
    edge: "de-DE-KatjaNeural",
    gemini: "Charon",
    openai: "alloy",
    google: "de-DE-Neural2-F",
    elevenlabs: "",
  },
  en: {
    edge: "en-US-AriaNeural",
    gemini: "Aoede",
    openai: "alloy",
    google: "en-US-Neural2-F",
    elevenlabs: "",
  },
  zh: {
    edge: "zh-CN-XiaoxiaoNeural",
    gemini: "Kore",
    openai: "alloy",
    google: "cmn-CN-Neural2-A",
    elevenlabs: "",
  },
};

export function voicePresetFor(lang: string): VoicePreset {
  const short = lang.split("-")[0]!.toLowerCase();
  return VOICE_PRESETS[short] ?? VOICE_PRESETS.en!;
}

// --- runtime env ---

export const PORT = Number(process.env.PORT ?? 8787);
export const ECHO_API_TOKEN = process.env.ECHO_API_TOKEN ?? "";
