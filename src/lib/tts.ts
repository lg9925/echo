import { apiFetchBlob } from "./api/client";
import { getApiToken } from "./settings";
import {
  audioKey,
  getCachedAudio,
  putCachedAudio,
  rateBucketFor,
} from "./audioCache";

// ─────────────────────────────────────────────────────────────────────────
// SpeechSynthesis (fallback path). Kept intact: used when neural TTS is
// unavailable (no token, offline + uncached, or server error).
// ─────────────────────────────────────────────────────────────────────────

let _voicesCache: SpeechSynthesisVoice[] | null = null;
let _voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (_voicesCache) return Promise.resolve(_voicesCache);
  if (_voicesPromise) return _voicesPromise;

  _voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const initial = synth.getVoices();
    if (initial && initial.length > 0) {
      _voicesCache = initial;
      resolve(initial);
      return;
    }
    const handler = () => {
      const v = synth.getVoices();
      if (v && v.length > 0) {
        _voicesCache = v;
        synth.removeEventListener("voiceschanged", handler);
        resolve(v);
      }
    };
    synth.addEventListener("voiceschanged", handler);
    setTimeout(() => {
      const v = synth.getVoices();
      _voicesCache = v;
      synth.removeEventListener("voiceschanged", handler);
      resolve(v);
    }, 3000);
  });

  return _voicesPromise;
}

export async function listVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined") return [];
  return loadVoices();
}

export async function pickVoice(
  lang: string,
): Promise<SpeechSynthesisVoice | undefined> {
  if (typeof window === "undefined") return undefined;
  const voices = await loadVoices();
  const prefix = lang.split("-")[0]!.toLowerCase();
  const exact = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase());
  if (exact) return exact;
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
}

// Synchronous voice pick (no await) — iOS needs synth.speak() called inside the
// user gesture, so the fallback can't wait on the async voiceschanged event.
function pickVoiceSync(lang: string): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined") return undefined;
  const voices = _voicesCache ?? window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return undefined;
  const prefix = lang.split("-")[0]!.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix))
  );
}

let _speechUnlocked = false;
// iOS only allows the FIRST speechSynthesis.speak() from within a user gesture;
// afterwards programmatic calls (the play loop) are allowed. Call this
// synchronously from gesture handlers (e.g. the Play button).
export function unlockSpeech(): void {
  if (_speechUnlocked || typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(" "));
    _speechUnlocked = true;
  } catch {
    /* ignore */
  }
}

export interface SpeakOptions {
  lang: string;
  rate?: number;
  voice?: SpeechSynthesisVoice;
  signal?: AbortSignal;
}

function speakViaSynthesis(text: string, opts: SpeakOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = opts.lang;
    utterance.rate = opts.rate ?? 1;

    let settled = false;
    let safety: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (safety) clearTimeout(safety);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      synth.cancel();
      finish();
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    opts.signal?.addEventListener("abort", onAbort);

    // Safety: some embedded Chromes never fire end/error.
    const cap = Math.min(30000, Math.max(2000, text.length * 120));
    safety = setTimeout(() => {
      synth.cancel();
      finish();
    }, cap);

    // Pick the voice synchronously and speak immediately — staying inside the
    // caller's user gesture so iOS actually produces sound.
    const voice = opts.voice ?? pickVoiceSync(opts.lang);
    if (voice) utterance.voice = voice;
    synth.speak(utterance);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Neural TTS (primary path): cache → server → play. Cache lives in IndexedDB,
// so a clip is generated at most once and replays offline forever.
// ─────────────────────────────────────────────────────────────────────────

let currentAudio: HTMLAudioElement | null = null;

// Fetch (if needed) and cache the clip for (text, lang, rate). Returns the blob.
async function ensureCachedAudio(
  text: string,
  lang: string,
  rate: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const { bucket, serverRate } = rateBucketFor(rate);
  const key = audioKey({ lang, voiceBucket: "default", rateBucket: bucket, text });

  const hit = await getCachedAudio(key);
  if (hit) return hit.blob;

  // Throws (no token / offline / server error) → speak() falls back.
  const blob = await apiFetchBlob("/v1/tts", { text, lang, rate: serverRate }, signal);
  await putCachedAudio({
    key,
    blob,
    mime: blob.type || "audio/mpeg",
    createdAt: Date.now(),
  });
  return blob;
}

export interface ClipResult {
  blob: Blob;
  /** What to set as audio.playbackRate to hit the requested rate. The server
   *  bakes `serverRate` (1, or 0.7 for slow); the rest is time-stretch. */
  effectiveRate: number;
}

// Neural clip + the playbackRate to reach the requested speed. Used by the
// shadowing playback engine (playback.ts), which owns ONE persistent audio
// element instead of going through playBlob's per-clip element. Throws on
// no-token / offline / server error so the caller can decide how to degrade.
export async function fetchClipBlob(
  text: string,
  lang: string,
  rate = 1,
  signal?: AbortSignal,
): Promise<ClipResult> {
  const { serverRate } = rateBucketFor(rate);
  const blob = await ensureCachedAudio(text, lang, rate, signal);
  return { blob, effectiveRate: rate / serverRate };
}

function playBlob(
  blob: Blob,
  playbackRate: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.playbackRate = Math.min(2, Math.max(0.5, playbackRate));
    // Time-stretch without pitch shift when supported.
    (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    currentAudio = audio;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    const onAbort = () => {
      audio.pause();
      finish();
    };

    audio.onended = finish;
    audio.onerror = finish;
    signal?.addEventListener("abort", onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    audio.play().catch(finish);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Public API — unchanged signature & abort semantics.
// ─────────────────────────────────────────────────────────────────────────

export async function speak(text: string, opts: SpeakOptions): Promise<void> {
  if (typeof window === "undefined") return;
  if (opts.signal?.aborted) return;

  const rate = opts.rate ?? 1;

  // Only try neural TTS when a token is configured. Without one the request is
  // doomed, and the extra awaits would push the SpeechSynthesis fallback out of
  // the user-gesture window — iOS then stays silent. Skipping keeps the
  // fallback synchronous inside the tap.
  if (getApiToken()) {
    try {
      const { blob, effectiveRate } = await fetchClipBlob(
        text,
        opts.lang,
        rate,
        opts.signal,
      );
      await playBlob(blob, effectiveRate, opts.signal);
      return;
    } catch {
      // Neural unavailable — fall back to the browser's built-in voices.
    }
    if (opts.signal?.aborted) return;
  }
  await speakViaSynthesis(text, opts);
}

/** Generate + cache a clip without playing (e.g. when an inbox card is added). */
export async function prewarmAudio(text: string, lang: string, rate = 1): Promise<void> {
  try {
    await ensureCachedAudio(text, lang, rate);
  } catch {
    // Best-effort; first real playback will generate it instead.
  }
}

export function cancelAllSpeech(): void {
  if (typeof window === "undefined") return;
  window.speechSynthesis?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

// Strip parenthetical annotations like "(南德/奥地利)" so TTS doesn't read
// Chinese/meta notes mixed into a variant. Handles half- and full-width pairs.
export function stripParentheticals(text: string): string {
  return text.replace(/[（(][^)）]*[)）]/g, "").replace(/\s+/g, " ").trim();
}
