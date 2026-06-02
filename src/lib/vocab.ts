// 字词表 (vocabulary) — a context-rich index of key words, centered on the
// islands. An entry is NOT a review card; it only becomes one when the user
// explicitly adds it to learning (see vocabToCard + addSentenceToIsland).
// No React.

import { findVocabByTerm, getDb, listVocab } from "./db";
import type { SentenceFields } from "./cards";
import type { VocabEntry, VocabRef } from "./types";

export { listVocab };

function vocabId(language: string): string {
  return `${language}.v.${crypto.randomUUID().slice(0, 8)}`;
}

export async function addVocab(fields: {
  language: string;
  term: string;
  meaning?: string;
  refs?: VocabRef[];
}): Promise<VocabEntry> {
  const entry: VocabEntry = {
    id: vocabId(fields.language),
    language: fields.language,
    term: fields.term.trim(),
    meaning: (fields.meaning ?? "").trim(),
    refs: fields.refs ?? [],
    createdAt: Date.now(),
  };
  await getDb().vocab.add(entry);
  return entry;
}

export async function updateVocab(
  id: string,
  patch: Partial<Pick<VocabEntry, "term" | "meaning" | "refs">>,
): Promise<void> {
  await getDb().vocab.update(id, patch);
}

export async function deleteVocab(id: string): Promise<void> {
  await getDb().vocab.delete(id);
}

function sameRef(a: VocabRef, b: VocabRef): boolean {
  return a.sentenceId != null && a.sentenceId === b.sentenceId;
}

/**
 * Add a term, or merge into the existing entry for that (language, term):
 * union new refs (dedup by sentenceId), and fill an empty meaning. Returns the
 * entry. This is how island key words + the supplementary sources converge.
 */
export async function upsertVocab(
  language: string,
  term: string,
  meaning: string,
  refs: VocabRef[],
): Promise<VocabEntry> {
  const trimmed = term.trim();
  const existing = await findVocabByTerm(language, trimmed);
  if (!existing) {
    return addVocab({ language, term: trimmed, meaning, refs });
  }
  const mergedRefs = [...existing.refs];
  for (const r of refs) {
    const dup = r.sentenceId != null && mergedRefs.some((m) => sameRef(m, r));
    if (!dup) mergedRefs.push(r);
  }
  const patch: Partial<VocabEntry> = { refs: mergedRefs };
  if (!existing.meaning.trim() && meaning.trim()) patch.meaning = meaning.trim();
  await getDb().vocab.update(existing.id, patch);
  return { ...existing, ...patch };
}

export interface KeywordLike {
  term: string;
  meaning: string;
  indices: number[];
}

/** Merge AI-extracted island key words into the 字词表 (dedup + merge refs). */
export async function mergeKeywords(
  language: string,
  islandId: string,
  sentences: { id: string; target: string }[],
  keywords: KeywordLike[],
): Promise<number> {
  let added = 0;
  for (const kw of keywords) {
    if (!kw.term.trim()) continue;
    const refs: VocabRef[] = kw.indices
      .map((i) => sentences[i])
      .filter((s): s is { id: string; target: string } => Boolean(s))
      .map((s) => ({ sentenceId: s.id, islandId, text: s.target }));
    await upsertVocab(language, kw.term, kw.meaning, refs);
    added += 1;
  }
  return added;
}

/** Turn a vocab entry into a learning card's fields (term→target, meaning→native). */
export function vocabToCard(entry: VocabEntry): SentenceFields {
  return {
    native: entry.meaning,
    target: entry.term,
    ipa: null,
    frame: "",
    literal: "",
    note: "",
    variants: [],
  };
}
