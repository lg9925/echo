// Goethe A1 wordlist — idempotent loader (clone of einbuergerung/loader.ts).
//
// The seed JSON ships ~650 LEXEMES (not cards); this loader deterministically
// expands them into cards: every lexeme → one recognition card (DE→ZH), every
// noun additionally → one production card (ZH → article buttons + typed
// plural). The noun invariant is ENFORCED here: a noun lexeme missing its
// article or the plural key throws with the lemma named — bad seed data fails
// loudly at load, it never ships a gender-less noun card (P0 acceptance).
// cardReviews is NEVER touched (learning progress survives reloads, mirroring
// quizProgress/reviews).

import { getDb, getCurriculum, putCurriculum } from "../db";
import type { CardRecord, CurriculumState, WordCardPayload } from "../types";

/** Bump to force-reload/overwrite the deck after editing the source JSON. */
export const A1_WORDLIST_VERSION = 1;
const META_KEY_PREFIX = "a1-wordlist";
const SOURCE_URL = "/seed/goethe_a1_de.json";

/** Integrity probe floor: the official Goethe A1 list is ~650 lexemes. */
export const A1_WORDLIST_MIN = 600;

export interface RawLexeme {
  lemma: string;
  pos: WordCardPayload["pos"];
  article?: "der" | "die" | "das";
  plural?: string | null;
  zh: string;
  en?: string;
  ipa?: string;
  example: string;
  example_zh: string;
  topics?: string[];
  freq_rank?: number;
}

export interface RawWordlist {
  language: string;
  version: number;
  lexemes: RawLexeme[];
}

const UMLAUT_SLUG: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

export function lemmaSlug(lemma: string): string {
  return lemma
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUT_SLUG[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Throws (naming the lemma) when a noun violates the article/plural invariant. */
export function assertLexemeValid(lexeme: RawLexeme): void {
  if (lexeme.pos !== "noun") return;
  if (
    lexeme.article !== "der" &&
    lexeme.article !== "die" &&
    lexeme.article !== "das"
  ) {
    throw new Error(
      `a1 wordlist: noun "${lexeme.lemma}" is missing a valid article`,
    );
  }
  if (!("plural" in lexeme)) {
    throw new Error(
      `a1 wordlist: noun "${lexeme.lemma}" is missing the plural key ` +
        `(use null for pluralless nouns)`,
    );
  }
}

/**
 * Deterministic lexeme → card expansion. createdAt is stamped incrementally
 * (base + index) so the new-card queue marches through the list in seed order.
 * The id embeds pos so homographs (essen/Essen) never collide.
 */
export function expandLexeme(
  lexeme: RawLexeme,
  language: string,
  baseCreatedAt: number,
  index: number,
): CardRecord[] {
  assertLexemeValid(lexeme);
  const slug = `${lemmaSlug(lexeme.lemma)}-${lexeme.pos}`;
  const payload: WordCardPayload = {
    lemma: lexeme.lemma,
    pos: lexeme.pos,
    article: lexeme.article,
    plural: lexeme.plural,
    meaningZh: lexeme.zh,
    example: lexeme.example,
    exampleZh: lexeme.example_zh,
    ipa: lexeme.ipa,
  };
  const topicTags = (lexeme.topics ?? []).map((t) => `topic:${t}`);
  const createdAt = baseCreatedAt + index;
  const cards: CardRecord[] = [
    {
      id: `${language}.a1.w.${slug}.recognition`,
      language,
      kind: "word",
      template: "recognition",
      tags: ["vocab", ...topicTags],
      payload,
      createdAt,
      seedVersion: A1_WORDLIST_VERSION,
    },
  ];
  if (lexeme.pos === "noun") {
    cards.push({
      id: `${language}.a1.w.${slug}.production`,
      language,
      kind: "word",
      template: "production",
      tags: ["gender", "noun", ...topicTags],
      payload,
      createdAt,
      seedVersion: A1_WORDLIST_VERSION,
    });
  }
  return cards;
}

/** Cheap integrity probe (no network): the deck is present for this version and
 *  a sampled noun production card actually carries article + plural. Guards
 *  against a stale-SW partial load recorded under the meta flag. */
async function deckLooksComplete(language: string): Promise<boolean> {
  const db = getDb();
  const wordCards = await db.cards
    .where("[language+kind]")
    .equals([language, "word"])
    .toArray();
  const lexemeCount = new Set(
    wordCards.map((c) => (c.payload as WordCardPayload).lemma),
  ).size;
  if (lexemeCount < A1_WORDLIST_MIN) return false;
  const nounProduction = wordCards.find(
    (c) => c.template === "production" && c.tags.includes("gender"),
  );
  if (!nounProduction) return false;
  const p = nounProduction.payload as WordCardPayload;
  return p.article !== undefined && "plural" in p;
}

/**
 * Load the Goethe A1 word deck for a language if not already present for this
 * version AND the stored deck passes the integrity probe. Idempotent; only
 * hits the network when a (re)load is actually needed.
 */
export async function ensureA1WordlistLoaded(language: string): Promise<void> {
  const db = getDb();
  const metaKey = `${META_KEY_PREFIX}-${language}@${A1_WORDLIST_VERSION}`;
  const existing = await db.meta.get(metaKey);
  if (existing && (await deckLooksComplete(language))) return;

  const url = `${SOURCE_URL}?v=${A1_WORDLIST_VERSION}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`a1 wordlist: failed to fetch ${url} (${response.status})`);
  }
  const raw: RawWordlist = await response.json();
  const base = Date.now();
  const cards = raw.lexemes.flatMap((lex, i) =>
    expandLexeme(lex, language, base, i),
  );

  await db.transaction("rw", db.cards, db.meta, async () => {
    await db.cards.bulkPut(cards);
    await db.meta.put({
      key: metaKey,
      language,
      version: A1_WORDLIST_VERSION,
      loadedAt: Date.now(),
    });
  });
}

/** Entering the A1 course = curriculum row exists. Created on first visit to
 *  the A1 home (explicit opt-in — the deck never auto-enrolls, 宪法原则二). */
export async function ensureCurriculum(
  language: string,
): Promise<CurriculumState> {
  const existing = await getCurriculum(language);
  if (existing) return existing;
  const now = Date.now();
  const state: CurriculumState = {
    id: `${language}.a1`,
    language,
    course: "a1",
    startedAt: now,
    examDate: null,
    diktatLevel: 1,
    diktatUpStreak: 0,
    diktatDownStreak: 0,
    updatedAt: now,
  };
  await putCurriculum(state);
  return state;
}
