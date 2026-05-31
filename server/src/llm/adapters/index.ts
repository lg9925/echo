import type { LlmProvider } from "../../config";
import type { LlmAdapter } from "./types";
import { anthropicAdapter } from "./anthropic";
import { openaiAdapter } from "./openai";
import { deepseekAdapter } from "./deepseek";
import { claudeCliAdapter } from "./claudeCli";
import { geminiAdapter } from "./gemini";
import { geminiCliAdapter } from "./geminiCli";

// The registry. Adding a vendor = import its adapter and add one line here.
const ADAPTERS: Record<LlmProvider, LlmAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  deepseek: deepseekAdapter,
  "claude-cli": claudeCliAdapter,
  gemini: geminiAdapter,
  "gemini-cli": geminiCliAdapter,
};

export function getAdapter(provider: LlmProvider): LlmAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new Error(`unknown LLM provider: ${provider}`);
  return adapter;
}
