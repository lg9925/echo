import { getDb } from "./db";
import type { Island, RawSeed, Sentence } from "./types";

const DEFAULT_VERSION = 1;

function metaKey(language: string, version: number): string {
  return `${language}@${version}`;
}

function islandId(language: string, order: number): string {
  return `${language}.${order}`;
}

function sentenceId(
  language: string,
  islandOrder: number,
  index: number,
): string {
  return `${language}.${islandOrder}.${index}`;
}

export async function ensureSeedLoaded(language: string): Promise<void> {
  const db = getDb();
  const response = await fetch(`/seed/echo_seed_${language}.json`);
  if (!response.ok) {
    throw new Error(
      `seedLoader: failed to fetch /seed/echo_seed_${language}.json (${response.status})`,
    );
  }
  const raw: RawSeed = await response.json();
  const version = raw.version ?? DEFAULT_VERSION;
  const key = metaKey(language, version);

  const existing = await db.meta.get(key);
  if (existing) return;

  const islands: Island[] = raw.islands.map((isl) => ({
    id: islandId(language, isl.order),
    language,
    name: isl.name,
    order: isl.order,
  }));

  const sentences: Sentence[] = raw.islands.flatMap((isl) =>
    isl.sentences.map((s, index) => ({
      id: sentenceId(language, isl.order, index),
      islandId: islandId(language, isl.order),
      language,
      islandOrder: isl.order,
      indexInIsland: index,
      native: s.native,
      target: s.target,
      ipa: s.ipa ?? null,
      frame: s.frame,
      literal: s.literal,
      note: s.note,
      variants: s.variants,
      audio: null,
    })),
  );

  await db.transaction("rw", db.islands, db.sentences, db.meta, async () => {
    await db.islands.bulkPut(islands);
    await db.sentences.bulkPut(sentences);
    await db.meta.put({
      key,
      language,
      version,
      loadedAt: Date.now(),
    });
  });
}
