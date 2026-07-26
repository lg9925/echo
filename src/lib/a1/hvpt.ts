// M6 HVPT (High Variability Phonetic Training) — perception drill logic.
//
// AB discrimination: play ONE word of a minimal pair, spoken by a RANDOM one of
// several speakers (voice variability is the "HV" — it forces the learner to
// track the phonemic contrast, not one speaker's timbre). Instant right/wrong;
// per-pair streak ≥ 3 = mastered; rounds resample unseen → wrong → rest
// (the einbuergerung drill pattern). Perception errors do NOT create SRS cards
// — the weighted resampling IS the remediation loop (感知 ≠ 回忆).

import rawBank from "../../data/hvpt_de.json";
import type { HvptProgress } from "../types";

export interface HvptPair {
  id: string;
  a: string;
  b: string;
  note?: string;
}

export interface HvptContrast {
  id: string;
  title: { zh: string; en: string };
  pairs: HvptPair[];
}

export interface HvptBank {
  version: number;
  contrasts: HvptContrast[];
}

export const HVPT_BANK = rawBank as HvptBank;

/** These are EDGE voice ids — every HVPT speak/prewarm must pin provider
 *  "edge" (HVPT_TTS_PROVIDER), or a differently-routed global default (e.g.
 *  gemini) would 404 on them. */
export const HVPT_TTS_PROVIDER = "edge";

/** Six Edge de-DE neural speakers ≈ classic HVPT speaker variability. Free,
 *  and the server passes any voice id straight through to Edge TTS. */
export const HVPT_VOICES_DE = [
  "de-DE-KatjaNeural",
  "de-DE-ConradNeural",
  "de-DE-AmalaNeural",
  "de-DE-KillianNeural",
  "de-DE-SeraphinaMultilingualNeural",
  "de-DE-FlorianMultilingualNeural",
] as const;

export const HVPT_MASTERY_STREAK = 3;
export const HVPT_ROUND_SIZE = 12;

export function isMasteredPair(p: HvptProgress | undefined): boolean {
  return (p?.streak ?? 0) >= HVPT_MASTERY_STREAK;
}

export function contrastById(id: string): HvptContrast | undefined {
  return HVPT_BANK.contrasts.find((c) => c.id === id);
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Build a round for one contrast: unseen pairs first, then the wrong pool
 * (answered wrong, not yet mastered), then the rest — each bucket shuffled.
 * Mastered pairs still appear at the tail when the round has room (retention).
 */
export function buildHvptRound(
  contrast: HvptContrast,
  progress: HvptProgress[],
  size: number = HVPT_ROUND_SIZE,
  rng: () => number = Math.random,
): HvptPair[] {
  const byId = new Map(progress.map((p) => [p.pairId, p]));
  const unseen: HvptPair[] = [];
  const wrong: HvptPair[] = [];
  const rest: HvptPair[] = [];
  const mastered: HvptPair[] = [];
  for (const pair of contrast.pairs) {
    const p = byId.get(pair.id);
    if (!p || p.attempts === 0) unseen.push(pair);
    else if (isMasteredPair(p)) mastered.push(pair);
    else if (p.wrong > 0) wrong.push(pair);
    else rest.push(pair);
  }
  return [
    ...shuffle(unseen, rng),
    ...shuffle(wrong, rng),
    ...shuffle(rest, rng),
    ...shuffle(mastered, rng),
  ].slice(0, size);
}

export interface HvptItem {
  pair: HvptPair;
  /** Which word the audio speaks. */
  spoken: "a" | "b";
  voice: string;
}

/** One drill item: random word of the pair × random speaker. */
export function makeHvptItem(
  pair: HvptPair,
  rng: () => number = Math.random,
  voices: readonly string[] = HVPT_VOICES_DE,
): HvptItem {
  return {
    pair,
    spoken: rng() < 0.5 ? "a" : "b",
    voice: voices[Math.floor(rng() * voices.length)]!,
  };
}

export interface ContrastStatus {
  total: number;
  seen: number;
  mastered: number;
}

export function contrastStatus(
  contrast: HvptContrast,
  progress: HvptProgress[],
): ContrastStatus {
  const byId = new Map(progress.map((p) => [p.pairId, p]));
  let seen = 0;
  let mastered = 0;
  for (const pair of contrast.pairs) {
    const p = byId.get(pair.id);
    if (p && p.attempts > 0) seen += 1;
    if (isMasteredPair(p)) mastered += 1;
  }
  return { total: contrast.pairs.length, seen, mastered };
}
