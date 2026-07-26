// Cloze derivation — deterministic, on-device, no seed data.
//
// For island sentences already recalled at least once (ReviewState.masteryStage
// ≥ 2), derive ONE cloze card blanking a content token. The token choice is a
// pure function of the sentence (same input → same card id), so regeneration is
// idempotent — reruns bulk-ignore existing ids and never duplicate. Cloze cards
// drill the sentence track's patterns (tag "pattern"), they don't fork mastery.

import { getDb } from "../db";
import type { CardRecord, ReviewState, Sentence } from "../types";

/** Max cloze cards derived per queue build — opportunistic, never a job. */
export const CLOZE_DERIVE_CAP = 20;

interface Token {
  text: string;
  index: number;
}

function tokenize(target: string): Token[] {
  const out: Token[] = [];
  const re = /[\p{L}\p{M}']+/gu;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(target)) !== null) {
    out.push({ text: match[0], index: i });
    i++;
  }
  return out;
}

/**
 * Deterministic token pick: prefer the verb-second position (index 1, lowercase
 * — German finite verbs sit there in main clauses), else the first capitalized
 * non-initial token (noun), else the longest token. Returns null when the
 * sentence is too short to blank meaningfully.
 */
export function pickClozeToken(target: string): Token | null {
  const tokens = tokenize(target);
  if (tokens.length < 3) return null;
  const v2 = tokens[1]!;
  if (/^\p{Ll}/u.test(v2.text) && v2.text.length >= 2) return v2;
  const noun = tokens.find(
    (t) => t.index > 0 && /^\p{Lu}/u.test(t.text) && t.text.length >= 3,
  );
  if (noun) return noun;
  return [...tokens].sort((a, b) => b.text.length - a.text.length)[0]!;
}

export function clozeCardId(language: string, sentenceId: string, tokenIndex: number): string {
  return `${language}.a1.cz.${sentenceId}.${tokenIndex}`;
}

export function deriveClozeCard(
  sentence: Sentence,
  nowMs: number,
): CardRecord | null {
  const token = pickClozeToken(sentence.target);
  if (!token) return null;
  return {
    id: clozeCardId(sentence.language, sentence.id, token.index),
    language: sentence.language,
    kind: "cloze",
    template: "production",
    tags: ["pattern"],
    payload: {
      sentenceId: sentence.id,
      target: sentence.target,
      clozeIndex: token.index,
      answer: token.text,
    },
    createdAt: nowMs,
  };
}

/**
 * Opportunistically derive cloze cards for recalled sentences that don't have
 * one yet (capped). Called when the card session builds its queue. bulkAdd with
 * catch-all: existing ids are skipped (deterministic ids make this idempotent).
 */
export async function deriveClozeCards(
  sentences: Sentence[],
  reviews: ReviewState[],
  nowMs: number,
): Promise<number> {
  const recalled = new Set(
    reviews.filter((r) => r.masteryStage >= 2 && r.repetitions > 0).map((r) => r.sentenceId),
  );
  const candidates: CardRecord[] = [];
  for (const s of sentences) {
    if (candidates.length >= CLOZE_DERIVE_CAP) break;
    if (!recalled.has(s.id)) continue;
    const card = deriveClozeCard(s, nowMs);
    if (card) candidates.push(card);
  }
  if (candidates.length === 0) return 0;
  const db = getDb();
  const existing = await db.cards.bulkGet(candidates.map((c) => c.id));
  const fresh = candidates.filter((_, i) => existing[i] === undefined);
  if (fresh.length > 0) await db.cards.bulkAdd(fresh);
  return fresh.length;
}

/** Render helper: the target sentence with the cloze token blanked. */
export function clozeDisplay(target: string, clozeIndex: number): string {
  let i = 0;
  return target.replace(/[\p{L}\p{M}']+/gu, (word) => {
    const out = i === clozeIndex ? "_".repeat(Math.max(4, word.length)) : word;
    i++;
    return out;
  });
}

/** Whitespace-normalized, umlaut- and case-STRICT answer check. */
export function clozeMatches(answer: string, typed: string): boolean {
  return answer.trim() === typed.trim().replace(/\s+/g, " ");
}
