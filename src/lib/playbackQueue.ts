// Pure functions that turn a sentence + player settings into an ordered list of
// playable "segments". The playback engine (playback.ts) consumes these one at
// a time. Keeping this pure makes the queue shape trivial to reason about and
// test, and keeps the engine focused on side effects. No React, no DOM.

import type { Sentence } from "./types";
import type { PlayerSettings } from "./player";

export type SegmentKind = "native" | "target" | "pause" | "gap";

export interface Segment {
  kind: SegmentKind;
  /** Which sentence this segment belongs to (drives index + MediaSession). */
  sentenceIdx: number;
  /** Speech segments: the text + BCP-47 lang to synthesise. */
  text?: string;
  lang?: string;
  /** Silence segments: how long, in seconds. */
  durationSec?: number;
}

export interface QueueContext {
  mode: PlayerSettings["mode"];
  autoAdvance: PlayerSettings["autoAdvance"];
  pauseSec: number;
  gapSec: number;
  nativeLang: string; // e.g. "zh-CN"
  targetLang: string; // e.g. "de-DE"
}

export function queueContext(
  settings: PlayerSettings,
  nativeLang: string,
  targetLang: string,
): QueueContext {
  return {
    mode: settings.mode,
    autoAdvance: settings.autoAdvance,
    pauseSec: settings.pauseSec,
    gapSec: settings.gapSec,
    nativeLang,
    targetLang,
  };
}

// Segments for one sentence, mirroring the old ShadowPlayer loop:
//   bilingual:   native → pause(pauseSec) → target → gap(gapSec)
//   target-only: target → gap(gapSec)
// The trailing gap is the inter-sentence pause, so it's only added when we'll
// actually advance (auto-advance on). A zero-length pause/gap emits no segment
// (a zero-duration clip would just glitch).
export function segmentsForSentence(
  sentence: Sentence,
  idx: number,
  ctx: QueueContext,
): Segment[] {
  const segs: Segment[] = [];
  if (ctx.mode === "bilingual") {
    segs.push({ kind: "native", sentenceIdx: idx, text: sentence.native, lang: ctx.nativeLang });
    if (ctx.pauseSec > 0) {
      segs.push({ kind: "pause", sentenceIdx: idx, durationSec: ctx.pauseSec });
    }
  }
  segs.push({ kind: "target", sentenceIdx: idx, text: sentence.target, lang: ctx.targetLang });
  if (ctx.autoAdvance && ctx.gapSec > 0) {
    segs.push({ kind: "gap", sentenceIdx: idx, durationSec: ctx.gapSec });
  }
  return segs;
}

export function isSpeech(seg: Segment): boolean {
  return seg.kind === "native" || seg.kind === "target";
}
