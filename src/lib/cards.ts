// Turn inbox results into learning cards. No React.
//
// User-created islands use order 9000+ so listIslands sorts them after the
// seed islands (order 1..N) and they never collide. The per-language
// "picked-up words" island has a fixed, build-time-known id so its shadow
// route is statically generated (see shadow/[islandId]/page.tsx).
import { getDb } from "./db";
import type { Island, Sentence } from "./types";
import type {
  ComposeResult,
  GlossCandidate,
  GlossResult,
  TargetLanguage,
} from "./api/contracts";

export const PICKED_ISLAND_ORDER = 9000;

export function pickedIslandId(language: string): string {
  return `${language}.u.picked`;
}

export function isPickedIslandId(islandId: string): boolean {
  return /^[a-z]+\.u\.picked$/.test(islandId);
}

export async function getOrCreatePickedIsland(
  language: TargetLanguage,
  name: string,
): Promise<Island> {
  const db = getDb();
  const id = pickedIslandId(language);
  const existing = await db.islands.get(id);
  if (existing) return existing;
  const island: Island = { id, language, name, order: PICKED_ISLAND_ORDER };
  await db.islands.put(island);
  return island;
}

export interface SentenceFields {
  native: string;
  target: string;
  ipa: string | null;
  frame: string;
  literal: string;
  note: string;
  variants: string[];
}

/** Append a fully-formed Sentence to an island. Returns the new Sentence. */
export async function addSentenceToIsland(
  island: Island,
  fields: SentenceFields,
): Promise<Sentence> {
  const db = getDb();
  const indexInIsland = await db.sentences
    .where("islandId")
    .equals(island.id)
    .count();
  const sentence: Sentence = {
    id: `${island.id}.${crypto.randomUUID().slice(0, 8)}`,
    islandId: island.id,
    language: island.language,
    islandOrder: island.order,
    indexInIsland,
    native: fields.native,
    target: fields.target,
    ipa: fields.ipa,
    frame: fields.frame,
    literal: fields.literal,
    note: fields.note,
    variants: fields.variants,
    audio: null,
  };
  await db.sentences.add(sentence);
  return sentence;
}

// --- result → SentenceFields mappers ---

export function composeToFields(r: ComposeResult): SentenceFields {
  return {
    native: r.native,
    target: r.target,
    ipa: r.ipa,
    frame: r.frame,
    literal: r.literal,
    note: r.note,
    variants: r.variants,
  };
}

export function glossToFields(
  r: GlossResult,
  candidate: GlossCandidate,
): SentenceFields {
  const note = [candidate.pos, candidate.note].filter(Boolean).join(" · ");
  return {
    native: r.meaning,
    target: candidate.target,
    ipa: null,
    frame: r.example.target,
    literal: r.example.native,
    note,
    variants: [],
  };
}
