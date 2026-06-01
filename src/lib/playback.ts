// Shadowing playback engine. Plays an ordered queue of segments (native /
// pause / target / gap) through ONE persistent HTMLAudioElement, advancing as
// each segment ends rather than on setTimeout — so the sequence keeps going
// when the screen is locked / app backgrounded (timers freeze in the
// background; media `ended` events and real audio playback don't). Silence
// between sentences is itself a real audio clip for the same reason.
//
// Two modes, chosen at start() by whether a neural-TTS token is configured:
//   • neural  → persistent element + cached/​fetched clips + silence clips +
//               MediaSession. Background-capable.
//   • synth   → SpeechSynthesis (foreground only — the OS suspends it on lock;
//               this is the zero-config fallback when no token is set). No
//               MediaSession, gaps via setTimeout (fine: it can't background).
//
// No React. ShadowPlayer subscribes via useSyncExternalStore and dispatches.

import { getApiToken } from "./settings";
import {
  DEFAULT_SETTINGS,
  nextIndex,
  prevIndex,
  sleep,
  type PlayerSettings,
} from "./player";
import {
  isSpeech,
  queueContext,
  segmentsForSentence,
  type QueueContext,
  type Segment,
  type SegmentKind,
} from "./playbackQueue";
import { cancelAllSpeech, fetchClipBlob, speak, type ClipResult } from "./tts";
import { getSilenceBlob, renderSilenceWav } from "./silentAudio";
import {
  clearMediaSession,
  setPlaybackState,
  setupMediaSession,
  updateMediaMetadata,
} from "./mediaSession";
import type { Sentence } from "./types";

type Status = "idle" | "playing" | "paused";

export interface PlaybackState {
  status: Status;
  sentenceIdx: number;
  segmentKind: SegmentKind | null;
}

export interface StartArgs {
  sentences: Sentence[];
  settings: PlayerSettings;
  nativeLang: string; // "zh-CN"
  targetLang: string; // "de-DE"
  islandName: string;
  startIdx?: number;
}

// ── Engine state ──────────────────────────────────────────────────────────
let gen = 0; // bumped by start/stop/next/prev to invalidate the running chain
let status: Status = "idle";
let useNeural = false;

let el: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let currentAbort: AbortController | null = null;

let sentences: Sentence[] = [];
let settings: PlayerSettings = DEFAULT_SETTINGS;
let nativeLang = "zh-CN";
let targetLang = "de-DE";
let islandName = "";
let sentenceIdx = 0;
let segmentKind: SegmentKind | null = null;
let pending: Segment[] = [];
let metaIdx = -1; // last sentence pushed to MediaSession

let prefetchKey: string | null = null;
let prefetchPromise: Promise<ClipResult | null> | null = null;

// ── External store ──────────────────────────────────────────────────────────
const IDLE: PlaybackState = { status: "idle", sentenceIdx: 0, segmentKind: null };
let snapshot: PlaybackState = IDLE;
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { status, sentenceIdx, segmentKind };
  for (const l of listeners) l();
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export function getSnapshot(): PlaybackState {
  return snapshot;
}
export function getServerSnapshot(): PlaybackState {
  return IDLE;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function ctx(): QueueContext {
  return queueContext(settings, nativeLang, targetLang);
}

function clampIdx(i: number): number {
  if (sentences.length === 0) return 0;
  return Math.min(Math.max(0, i), sentences.length - 1);
}

function ensureElement(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  }
  return el;
}

function setNeuralSource(blob: Blob, rate: number): void {
  const e = ensureElement();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  e.src = currentUrl;
  e.playbackRate = Math.min(2, Math.max(0.5, rate));
  (e as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
}

// Pull the next segment, refilling from the next sentence when the current
// one's segments run out. Returns null to stop (manual-advance, end of list).
function nextSegment(): Segment | null {
  if (pending.length === 0) {
    if (!settings.autoAdvance || sentences.length === 0) return null;
    const ni = nextIndex(sentenceIdx, sentences.length, settings.loop);
    sentenceIdx = ni;
    pending = segmentsForSentence(sentences[ni]!, ni, ctx());
  }
  return pending.shift() ?? null;
}

// The next speech segment we'll need — for prefetching its clip while the
// current segment plays (so the swap is gapless and iOS doesn't suspend us).
function peekNextSpeech(): Segment | null {
  for (const s of pending) if (isSpeech(s)) return s;
  if (settings.autoAdvance && sentences.length) {
    const ni = nextIndex(sentenceIdx, sentences.length, settings.loop);
    for (const s of segmentsForSentence(sentences[ni]!, ni, ctx())) {
      if (isSpeech(s)) return s;
    }
  }
  return null;
}

function clipKey(seg: Segment): string {
  return `${seg.lang}|${seg.text}|${settings.rate}`;
}

function prefetchNext(): void {
  if (!useNeural) return;
  const nx = peekNextSpeech();
  if (!nx) {
    prefetchKey = null;
    prefetchPromise = null;
    return;
  }
  const key = clipKey(nx);
  if (prefetchKey === key) return;
  prefetchKey = key;
  prefetchPromise = fetchClipBlob(nx.text!, nx.lang!, settings.rate).catch(() => null);
}

async function getSpeechClip(seg: Segment): Promise<ClipResult | null> {
  const key = clipKey(seg);
  if (prefetchKey === key && prefetchPromise) {
    const r = await prefetchPromise;
    if (r) return r;
  }
  return fetchClipBlob(seg.text!, seg.lang!, settings.rate).catch(() => null);
}

// Resolves true when the current element finishes naturally, false if aborted.
// A pause (el.pause()) does NOT resolve — the chain parks here until resume.
function playElement(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const e = el!;
    let settled = false;
    const done = (finished: boolean) => {
      if (settled) return;
      settled = true;
      e.onended = null;
      e.onerror = null;
      signal.removeEventListener("abort", onAbort);
      resolve(finished);
    };
    const onAbort = () => {
      e.pause();
      done(false);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    e.onended = () => done(true);
    e.onerror = () => done(true); // skip a bad clip rather than wedge
    signal.addEventListener("abort", onAbort, { once: true });
    e.play().catch(() => done(true));
  });
}

async function playSegment(seg: Segment, signal: AbortSignal): Promise<boolean> {
  segmentKind = seg.kind;
  sentenceIdx = seg.sentenceIdx;
  if (useNeural && seg.sentenceIdx !== metaIdx) {
    metaIdx = seg.sentenceIdx;
    updateMediaMetadata({
      title: sentences[seg.sentenceIdx]?.target ?? "",
      album: islandName,
    });
  }
  emit();

  if (useNeural) {
    if (isSpeech(seg)) {
      const clip = await getSpeechClip(seg);
      if (signal.aborted) return false;
      if (!clip) return true; // fetch failed — skip, keep the session alive
      setNeuralSource(clip.blob, clip.effectiveRate);
    } else {
      const blob = await getSilenceBlob(seg.durationSec ?? 0);
      if (signal.aborted) return false;
      setNeuralSource(blob, 1);
    }
    prefetchNext();
    return playElement(signal);
  }

  // Synth fallback (foreground only).
  if (isSpeech(seg)) {
    try {
      await speak(seg.text!, { lang: seg.lang!, rate: settings.rate, signal });
    } catch {
      /* ignore */
    }
  } else {
    await sleep((seg.durationSec ?? 0) * 1000, signal);
  }
  return !signal.aborted;
}

// Start a fresh playback chain. Bumps `gen` so any parked .then from a previous
// chain becomes a no-op.
function playFrom(): void {
  const myGen = ++gen;
  status = "playing";
  if (useNeural) setPlaybackState("playing");
  emit();

  const step = () => {
    if (myGen !== gen || status !== "playing") return;
    const seg = nextSegment();
    if (!seg) {
      stopInternal();
      return;
    }
    currentAbort = new AbortController();
    void playSegment(seg, currentAbort.signal).then((finished) => {
      if (myGen === gen && status === "playing" && finished) step();
    });
  };
  step();
}

function stopInternal(): void {
  status = "idle";
  segmentKind = null;
  if (useNeural) {
    el?.pause();
    setPlaybackState("paused");
  }
  emit();
}

// ── Public API ──────────────────────────────────────────────────────────────
export function start(args: StartArgs): void {
  sentences = args.sentences;
  settings = args.settings;
  nativeLang = args.nativeLang;
  targetLang = args.targetLang;
  islandName = args.islandName;
  sentenceIdx = clampIdx(args.startIdx ?? 0);
  useNeural = !!getApiToken();
  metaIdx = -1;
  pending = sentences.length
    ? segmentsForSentence(sentences[sentenceIdx]!, sentenceIdx, ctx())
    : [];

  if (useNeural) {
    ensureElement();
    setupMediaSession({ onPlay: resume, onPause: pause, onNext: next, onPrev: prev });
    updateMediaMetadata({ title: sentences[sentenceIdx]?.target ?? "", album: islandName });
    metaIdx = sentenceIdx;
    // Unlock the element INSIDE the caller's user gesture by starting a tiny
    // silence; once an element has been play()ed from a gesture, iOS lets us
    // swap src + play() later (after awaits) without re-gesturing. The real
    // queue takes over immediately below.
    try {
      setNeuralSource(renderSilenceWav(0.05), 1);
      el!.play().catch(() => {});
    } catch {
      /* ignore */
    }
    prefetchNext();
  }
  playFrom();
}

export function pause(): void {
  if (status !== "playing") return;
  status = "paused";
  if (useNeural) {
    el?.pause();
    setPlaybackState("paused");
  } else {
    try {
      window.speechSynthesis?.pause();
    } catch {
      /* ignore */
    }
  }
  emit();
}

export function resume(): void {
  if (status !== "paused") return;
  status = "playing";
  if (useNeural) {
    setPlaybackState("playing");
    el?.play().catch(() => {});
  } else {
    try {
      window.speechSynthesis?.resume();
    } catch {
      /* ignore */
    }
  }
  emit();
}

function seekRelative(dir: 1 | -1): void {
  if (status === "idle" || sentences.length === 0) return;
  currentAbort?.abort();
  if (!useNeural) cancelAllSpeech();
  sentenceIdx =
    dir > 0
      ? nextIndex(sentenceIdx, sentences.length, settings.loop)
      : prevIndex(sentenceIdx, sentences.length, settings.loop);
  metaIdx = -1;
  pending = segmentsForSentence(sentences[sentenceIdx]!, sentenceIdx, ctx());
  playFrom();
}

export function next(): void {
  seekRelative(1);
}
export function prev(): void {
  seekRelative(-1);
}

export function stop(): void {
  gen++; // invalidate the running chain
  currentAbort?.abort();
  status = "idle";
  segmentKind = null;
  pending = [];
  if (useNeural) {
    el?.pause();
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
    clearMediaSession();
  } else {
    cancelAllSpeech();
  }
  emit();
}

// Live settings change. Rate lands on the next clip (fetched at the right
// bucket); mode/pause/gap take effect when the next sentence is queued —
// matching the old loop, which read settings fresh each sentence.
export function updateSettings(next: PlayerSettings): void {
  settings = next;
}
