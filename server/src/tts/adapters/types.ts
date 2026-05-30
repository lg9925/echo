import type { TtsProvider } from "../../config";

export interface TtsSynthesizeParams {
  text: string;
  /** Vendor-specific voice id (already resolved from presets). */
  voice: string;
  /** Speed multiplier, 1 = normal (< 1 slower). */
  rate: number;
  /** Short code or BCP-47, for adapters that need the locale. */
  lang: string;
}

export interface TtsResult {
  audio: Buffer;
  mime: string;
}

// Adapters do one thing: text → audio bytes. No caching, no preset lookup,
// no routing — those live in core / config.
export interface TtsAdapter {
  readonly name: TtsProvider;
  synthesize(params: TtsSynthesizeParams): Promise<TtsResult>;
}
