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

/** Delete a user island and everything tied to it: its sentences and their
 *  spaced-repetition records. Guarded to user islands so seed islands are safe. */
export async function deleteIsland(islandId: string): Promise<void> {
  if (!isUserIslandId(islandId)) return;
  const db = getDb();
  const sentenceIds = (
    await db.sentences.where("islandId").equals(islandId).primaryKeys()
  ) as string[];
  await db.transaction("rw", db.islands, db.sentences, db.reviews, async () => {
    await db.reviews.bulkDelete(sentenceIds);
    await db.sentences.where("islandId").equals(islandId).delete();
    await db.islands.delete(islandId);
  });
}

/** Edit a sentence's content in place. The id never changes, so its
 *  spaced-repetition record stays attached. */
export async function updateSentence(
  id: string,
  patch: Partial<SentenceFields>,
): Promise<void> {
  await getDb().sentences.update(id, patch);
}

/** Delete one sentence: drop its review record too, then close the index gap so
 *  the remaining sentences stay contiguous. Works for seed and user islands. */
export async function deleteSentence(id: string): Promise<void> {
  const db = getDb();
  const sentence = await db.sentences.get(id);
  if (!sentence) return;
  await db.transaction("rw", db.sentences, db.reviews, async () => {
    await db.reviews.delete(id);
    await db.sentences.delete(id);
    const rest = await db.sentences
      .where("[islandId+indexInIsland]")
      .between([sentence.islandId, -Infinity], [sentence.islandId, Infinity])
      .sortBy("indexInIsland");
    await Promise.all(
      rest.map((s, i) =>
        s.indexInIsland === i
          ? Promise.resolve(0)
          : db.sentences.update(s.id, { indexInIsland: i }),
      ),
    );
  });
}

/** Move a sentence to another island: append it at the end of the target and
 *  close the gap in the source. The id never changes, so the spaced-repetition
 *  record follows automatically. Caller should keep source/target same-language. */
export async function moveSentence(
  id: string,
  targetIslandId: string,
): Promise<void> {
  const db = getDb();
  const sentence = await db.sentences.get(id);
  if (!sentence || sentence.islandId === targetIslandId) return;
  const target = await db.islands.get(targetIslandId);
  if (!target) return;
  const sourceIslandId = sentence.islandId;
  await db.transaction("rw", db.sentences, async () => {
    const targetCount = await db.sentences
      .where("islandId")
      .equals(targetIslandId)
      .count();
    await db.sentences.update(id, {
      islandId: targetIslandId,
      islandOrder: target.order,
      indexInIsland: targetCount,
    });
    const rest = await db.sentences
      .where("[islandId+indexInIsland]")
      .between([sourceIslandId, -Infinity], [sourceIslandId, Infinity])
      .sortBy("indexInIsland");
    await Promise.all(
      rest.map((s, i) =>
        s.indexInIsland === i
          ? Promise.resolve(0)
          : db.sentences.update(s.id, { indexInIsland: i }),
      ),
    );
  });
}

/** Persist a new sentence order: assign indexInIsland by position. Pass the
 *  island's full sentence ids in the desired order. */
export async function reorderSentences(
  orderedIds: string[],
): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.sentences, async () => {
    await Promise.all(
      orderedIds.map((id, i) => db.sentences.update(id, { indexInIsland: i })),
    );
  });
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

export interface ScenarioGroup {
  name: string;
  sentences: ScenarioSentence[];
}

/** Partition a generated scenario into sub-islands (原则三: small islands). The
 *  model tags each sentence with a `group` sub-scene label; we make one island
 *  per label, preserving first-seen order. A single/unlabelled scene stays one
 *  island named `islandName`. `max` is a hard cap — any group bigger than it is
 *  chunked into `名 (1)`, `名 (2)`… so no island ever exceeds the limit. */
export function groupScenario(
  sentences: ScenarioSentence[],
  islandName: string,
  max: number,
): ScenarioGroup[] {
  const order: string[] = [];
  const byLabel = new Map<string, ScenarioSentence[]>();
  for (const s of sentences) {
    const label = (s.group ?? "").trim();
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)!.push(s);
  }

  const single = order.length <= 1;
  const cap = max > 0 ? max : DEFAULT_GROUP_CAP;
  const out: ScenarioGroup[] = [];
  for (const label of order) {
    const list = byLabel.get(label)!;
    const baseName = single ? islandName : label || islandName;
    if (list.length <= cap) {
      out.push({ name: baseName, sentences: list });
      continue;
    }
    const chunks = Math.ceil(list.length / cap);
    for (let i = 0; i < chunks; i++) {
      out.push({
        name: `${baseName} (${i + 1})`,
        sentences: list.slice(i * cap, (i + 1) * cap),
      });
    }
  }
  return out;
}

const DEFAULT_GROUP_CAP = 10;

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
