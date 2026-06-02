// Client-side audio cache (IndexedDB). The TTS middle layer's "never generate
// the same clip twice" guarantee lives here: speak() checks the cache before
// ever calling the server. No React.
import { getDb } from "./db";
import type { AudioCacheEntry } from "./types";

export type RateBucket = "normal" | "slow";

// rate < 1 → a truly re-synthesised slow clip (better articulation than
// time-stretching); otherwise normal. serverRate is what we ask the backend
// to bake; fine speed control is applied at playback via audio.playbackRate.
export function rateBucketFor(rate: number): { bucket: RateBucket; serverRate: number } {
  return rate < 1 ? { bucket: "slow", serverRate: 0.7 } : { bucket: "normal", serverRate: 1 };
}

// Stable key per (language, voice preset, rate bucket, text). The composite
// string IS the key — collision-free, no crypto/secure-context dependency.
export function audioKey(parts: {
  lang: string;
  voiceBucket: string;
  rateBucket: RateBucket;
  text: string;
}): string {
  const short = parts.lang.split("-")[0]!.toLowerCase();
  return `${short}|${parts.voiceBucket}|${parts.rateBucket}|${parts.text}`;
}

// Key for a generated silence clip of N seconds. The `__silence__` namespace
// can't collide with a real TTS key (audioKey always has a lang segment first).
export function silenceKey(seconds: number): string {
  return `__silence__|${Math.round(seconds * 10) / 10}`;
}

export async function getCachedAudio(key: string): Promise<AudioCacheEntry | undefined> {
  return getDb().audioCache.get(key);
}

export async function putCachedAudio(entry: AudioCacheEntry): Promise<void> {
  await getDb().audioCache.put(entry);
}
