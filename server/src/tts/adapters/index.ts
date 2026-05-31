import type { TtsProvider } from "../../config";
import type { TtsAdapter } from "./types";
import { edgeAdapter } from "./edge";
import { openaiTtsAdapter } from "./openai";
import { googleTtsAdapter } from "./google";
import { elevenlabsTtsAdapter } from "./elevenlabs";
import { geminiTtsAdapter } from "./gemini";

// Registry. Adding a vendor = import its adapter + one line here.
const TTS_ADAPTERS: Record<TtsProvider, TtsAdapter> = {
  edge: edgeAdapter,
  gemini: geminiTtsAdapter,
  openai: openaiTtsAdapter,
  google: googleTtsAdapter,
  elevenlabs: elevenlabsTtsAdapter,
};

export function getTtsAdapter(provider: TtsProvider): TtsAdapter {
  const adapter = TTS_ADAPTERS[provider];
  if (!adapter) throw new Error(`unknown TTS provider: ${provider}`);
  return adapter;
}
