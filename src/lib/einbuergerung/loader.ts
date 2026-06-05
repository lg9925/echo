// 德国入籍考试 (Leben in Deutschland / Einbürgerungstest) — idempotent loader.
//
// Mirrors seedLoader.ts: fetch the full question bank once, derive the
// filterable fields (day / region / tags) from each question's stable integer
// id + study layer, and bulkPut by id. Re-running is safe — bulkPut overwrites
// the same ids and the `meta` key short-circuits redundant work. quizProgress
// is never touched here (mistake history survives a reload), mirroring reviews.

import { getDb } from "../db";
import type { QuizOption, QuizQuestion, QuizRegion, QuizStudy } from "../types";

/** Bump to force-reload/overwrite the bank after editing the source JSON. */
export const EINBUERGERUNG_VERSION = 1;
const META_KEY = `einbuergerung@${EINBUERGERUNG_VERSION}`;
const SOURCE_URL = "/seed/einbuergerung/leben_in_deutschland_echo_plus.json";

/** Total questions expected in the full bank (300 national + 10 NRW). */
export const EINBUERGERUNG_TOTAL = 310;
/** NRW state questions live in this id range. */
const NRW_MIN = 391;
const NRW_MAX = 400;
const NRW_CATEGORY = "北威州";

interface RawQuestion {
  id: number;
  category: string;
  image: string | null;
  question_de: string;
  question_zh: string;
  options: QuizOption[];
  study?: QuizStudy | null;
}

interface RawBank {
  meta?: unknown;
  questions: RawQuestion[];
}

/** D1–D6 from the id range. 1–50→1 … 251–300→6; NRW (391–400)→6. */
export function dayForId(id: number): number {
  if (id >= NRW_MIN && id <= NRW_MAX) return 6;
  return Math.min(6, Math.max(1, Math.ceil(id / 50)));
}

export function regionForQuestion(id: number, category: string): QuizRegion {
  if ((id >= NRW_MIN && id <= NRW_MAX) || category === NRW_CATEGORY) return "nrw";
  return "national";
}

function toQuizQuestion(raw: RawQuestion): QuizQuestion {
  const study = raw.study ?? null;
  return {
    id: raw.id,
    category: raw.category,
    image: raw.image ?? null,
    question_de: raw.question_de,
    question_zh: raw.question_zh,
    options: raw.options,
    study,
    day: dayForId(raw.id),
    region: regionForQuestion(raw.id, raw.category),
    tags: study?.tags ?? [],
  };
}

/**
 * Load the question bank into IndexedDB if not already present for this
 * version. Idempotent and safe to call on every visit to the module.
 */
export async function ensureEinbuergerungLoaded(): Promise<void> {
  const db = getDb();
  const existing = await db.meta.get(META_KEY);
  if (existing) return;

  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(
      `einbuergerung loader: failed to fetch ${SOURCE_URL} (${response.status})`,
    );
  }
  const raw: RawBank = await response.json();
  const questions = raw.questions.map(toQuizQuestion);

  await db.transaction("rw", db.quizQuestions, db.meta, async () => {
    await db.quizQuestions.bulkPut(questions);
    await db.meta.put({
      key: META_KEY,
      language: "de",
      version: EINBUERGERUNG_VERSION,
      loadedAt: Date.now(),
    });
  });
}
