// Turn inbox results into learning cards. No React.
//
// User-created islands use order 9000+ so listIslands sorts them after the
// seed islands (order 1..N) and they never collide. The per-language
// "picked-up words" island has a fixed, build-time-known id so its shadow
// route is statically generated (see shadow/[islandId]/page.tsx).
import { getDb, listIslands } from "./db";
import type { Island, Sentence } from "./types";
import type {
  ComposeResult,
  GlossCandidate,
  GlossResult,
  ScenarioSentence,
  TargetLanguage,
} from "./api/contracts";

export const PICKED_ISLAND_ORDER = 9000;

export function pickedIslandId(language: string): string {
  return `${language}.u.picked`;
}

// All user-created islands carry a ".u." marker in their id. They have no
// pre-generated /shadow/ route (static export), so they're played via the
// query-param page /[locale]/island/?id=... — see islandHref().
export function isUserIslandId(islandId: string): boolean {
  return /\.u\./.test(islandId);
}

export function isPickedIslandId(islandId: string): boolean {
  return /^[a-z]+\.u\.picked$/.test(islandId);
}

/** Player URL for an island: pretty static route for seed islands, query-param
 *  page for user islands (whose ids aren't known at build time). */
export function islandHref(uiLocale: string, islandId: string): string {
  return isUserIslandId(islandId)
    ? `/${uiLocale}/island/?id=${encodeURIComponent(islandId)}`
    : `/${uiLocale}/shadow/${islandId}/`;
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

function buildSentence(
  island: Island,
  fields: SentenceFields,
  indexInIsland: number,
): Sentence {
  return {
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
  const sentence = buildSentence(island, fields, indexInIsland);
  await db.sentences.add(sentence);
  return sentence;
}

/** Append many sentences in order (one count + one bulk write). */
export async function addSentencesToIsland(
  island: Island,
  fieldsList: SentenceFields[],
): Promise<void> {
  const db = getDb();
  const base = await db.sentences.where("islandId").equals(island.id).count();
  const sentences = fieldsList.map((f, i) => buildSentence(island, f, base + i));
  await db.sentences.bulkAdd(sentences);
}

/** Create a fresh, uniquely-named user island (for a generated scenario). */
export async function createScenarioIsland(
  language: TargetLanguage,
  name: string,
): Promise<Island> {
  const db = getDb();
  const existingUser = (await listIslands(language)).filter((i) =>
    isUserIslandId(i.id),
  ).length;
  const island: Island = {
    id: `${language}.u.${crypto.randomUUID().slice(0, 8)}`,
    language,
    name: name.trim() || "场景",
    order: PICKED_ISLAND_ORDER + 1 + existingUser,
  };
  await db.islands.put(island);
  return island;
}

export function scenarioToFieldsList(
  sentences: ScenarioSentence[],
): SentenceFields[] {
  return sentences.map((s) => ({
    native: s.native,
    target: s.target,
    ipa: s.ipa,
    frame: s.frame,
    literal: s.literal,
    note: s.note,
    variants: s.variants,
  }));
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
