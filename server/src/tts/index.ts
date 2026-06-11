import { TTS_ROUTING, type TtsProvider } from "../config";
import { voicePresetFor } from "./presets";
import { getTtsAdapter } from "./adapters";
import { getCachedTts, putCachedTts, ttsCacheKey } from "./cache";
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
// the adapter. A content-addressed disk cache (cache.ts) sits in front so each
// clip is vendor-generated at most once; the client IndexedDB cache still
// dedups per-device on top of this.
export async function tts(params: TtsParams): Promise<TtsResult> {
  const provider = params.provider ?? TTS_ROUTING.default;
  const preset = voicePresetFor(params.lang);
  const voice = params.voice ?? preset[provider] ?? preset.edge;
  const rate = params.rate ?? 1;

  const key = ttsCacheKey({ provider, lang: params.lang, voice, rate, text: params.text });
  const cached = await getCachedTts(key);
  if (cached) return cached;

  const result = await getTtsAdapter(provider).synthesize({
    text: params.text,
    voice,
    rate,
    lang: params.lang,
  });
  // Best-effort: a failed cache write must never fail the response.
  await putCachedTts(key, result).catch(() => {});
  return result;
}
