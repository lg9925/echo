import { TTS_ROUTING, type TtsProvider } from "../config";
import { voicePresetFor } from "./presets";
import { getTtsAdapter } from "./adapters";
import type { TtsResult } from "./adapters/types";

export interface TtsParams {
  text: string;
  lang: string;
  /** Explicit vendor voice id; otherwise resolved from presets. */
  voice?: string;
  /** Speed multiplier, 1 = normal. */
  rate?: number;
  /** Override the routed provider (defaults to TTS_ROUTING.default). */
  provider?: TtsProvider;
}

// Core: pick provider by routing, resolve the voice from presets, delegate to
// the adapter. Caching lives on the client (IndexedDB) this version — the
// server is a stateless generator.
export async function tts(params: TtsParams): Promise<TtsResult> {
  const provider = params.provider ?? TTS_ROUTING.default;
  const preset = voicePresetFor(params.lang);
  const voice = params.voice ?? preset[provider] ?? preset.edge;
  const rate = params.rate ?? 1;

  return getTtsAdapter(provider).synthesize({
    text: params.text,
    voice,
    rate,
    lang: params.lang,
  });
}
