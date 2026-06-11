// Data backup: export/import all learning data as a single JSON file.
//
// Local-first means local data loss = everything gone, so this is a bottom-line
// feature (project principle 六). No React here — SettingsView calls these.
//
// What's IN the file: islands, sentences, reviews (SR progress), seed meta,
// inbox items, and player settings — across ALL languages.
// What's OUT, by design:
//   - audio blobs: regenerable from text via TTS; keeping them out keeps the
//     file small (the IndexedDB `audioCache` table is skipped entirely).
//   - the API token / base: secrets never travel in a portable file.

import { getDb } from "./db";
import {
  DEFAULT_SETTINGS,
  loadPlayerSettings,
  savePlayerSettings,
  type PlayerSettings,
} from "./player";
import { getProfile, saveProfile } from "./profile";
import type { LearnerProfile } from "./api/contracts";
import type {
  InboxItem,
  Island,
  QuizProgress,
  QuizQuestion,
  ReviewState,
  SeedMeta,
  Sentence,
  VocabEntry,
} from "./types";

export const BACKUP_FORMAT = "echo-backup";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  data: {
    islands: Island[];
    sentences: Sentence[]; // audio is null in storage; no binary travels
    reviews: ReviewState[];
    meta: SeedMeta[];
    inbox: InboxItem[];
    vocab: VocabEntry[];
    // 入籍考试 quiz: questions reload from seed, but quizProgress (stars + stats)
    // is user data with no other source — both travel so a restore is complete.
    quizQuestions: QuizQuestion[];
    quizProgress: QuizProgress[];
    profiles: Record<string, LearnerProfile>;
    playerSettings: PlayerSettings | null;
  };
}

export interface ImportSummary {
  islands: number;
  sentences: number;
  reviews: number;
  meta: number;
  inbox: number;
  vocab: number;
  quizQuestions: number;
  quizProgress: number;
  profiles: number;
  playerSettings: boolean;
}

// All per-language profiles in localStorage (keys echo:profile:<lang>).
// Language-agnostic so adding a language never needs a backup change.
function collectProfiles(): Record<string, LearnerProfile> {
  const out: Record<string, LearnerProfile> = {};
  if (typeof window === "undefined") return out;
  const prefix = "echo:profile:";
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k?.startsWith(prefix)) out[k.slice(prefix.length)] = getProfile(k.slice(prefix.length));
  }
  return out;
}

/** Read every table (all languages) + player settings into a backup object. */
export async function exportBackup(): Promise<BackupFile> {
  const db = getDb();
  const [islands, sentences, reviews, meta, inbox, vocab, quizQuestions, quizProgress] =
    await Promise.all([
      db.islands.toArray(),
      db.sentences.toArray(),
      db.reviews.toArray(),
      db.meta.toArray(),
      db.inbox.toArray(),
      db.vocab.toArray(),
      db.quizQuestions.toArray(),
      db.quizProgress.toArray(),
    ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: {
      islands,
      sentences,
      reviews,
      meta,
      inbox,
      vocab,
      quizQuestions,
      quizProgress,
      profiles: collectProfiles(),
      playerSettings: loadPlayerSettings(),
    },
  };
}

export function backupToBlob(file: BackupFile): Blob {
  return new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
}

/** e.g. echo-backup-20260601-143005.json (local time, from exportedAt). */
export function suggestedFilename(file: BackupFile): string {
  const d = new Date(file.exportedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `echo-backup-${stamp}.json`;
}

/** Parse + validate a backup file's text. Throws on anything unexpected. */
export function parseBackupFile(text: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("not a backup file");
  }
  const obj = parsed as Partial<BackupFile>;
  if (obj.format !== BACKUP_FORMAT) {
    throw new Error("not an Echo backup file");
  }
  if (typeof obj.version !== "number" || obj.version > BACKUP_VERSION) {
    throw new Error(`unsupported backup version: ${String(obj.version)}`);
  }
  if (typeof obj.data !== "object" || obj.data === null) {
    throw new Error("backup file has no data");
  }
  const d = obj.data as Partial<BackupFile["data"]>;
  for (const key of ["islands", "sentences", "reviews", "meta", "inbox"] as const) {
    if (!Array.isArray(d[key])) {
      throw new Error(`backup file is missing "${key}"`);
    }
  }
  // vocab was added later — older backups won't have it; default to empty.
  if (!Array.isArray(d.vocab)) d.vocab = [];
  // quiz tables added later too — default to empty for older backups.
  if (!Array.isArray(d.quizQuestions)) d.quizQuestions = [];
  if (!Array.isArray(d.quizProgress)) d.quizProgress = [];
  // profiles added later too — default to none.
  if (typeof d.profiles !== "object" || d.profiles === null) d.profiles = {};
  return obj as BackupFile;
}

/**
 * Merge a backup into IndexedDB by primary key (upsert). Records present in the
 * file overwrite/restore; extra records already on this device are kept — never
 * deleted. Safe for both "restore after loss" and "move to a new device".
 */
export async function importBackup(file: BackupFile): Promise<ImportSummary> {
  const db = getDb();
  const {
    islands,
    sentences,
    reviews,
    meta,
    inbox,
    vocab,
    quizQuestions,
    quizProgress,
    profiles,
    playerSettings,
  } = file.data;

  await db.transaction(
    "rw",
    [
      db.islands,
      db.sentences,
      db.reviews,
      db.meta,
      db.inbox,
      db.vocab,
      db.quizQuestions,
      db.quizProgress,
    ],
    async () => {
      await db.islands.bulkPut(islands);
      await db.sentences.bulkPut(sentences);
      // Backfill masteryStage for reviews from a pre-v5 backup (a stored row
      // means the card was recalled → stage 2; see db.ts v5 / learning-method §2).
      await db.reviews.bulkPut(
        reviews.map((r) => ({ ...r, masteryStage: r.masteryStage ?? 2 })),
      );
      await db.meta.bulkPut(meta);
      await db.inbox.bulkPut(inbox);
      await db.vocab.bulkPut(vocab ?? []);
      await db.quizQuestions.bulkPut(quizQuestions ?? []);
      await db.quizProgress.bulkPut(quizProgress ?? []);
    },
  );

  const profileEntries = Object.entries(profiles ?? {});
  for (const [lang, p] of profileEntries) {
    saveProfile(lang, { level: p.level ?? null, background: p.background ?? "" });
  }

  let appliedSettings = false;
  if (playerSettings) {
    savePlayerSettings({ ...DEFAULT_SETTINGS, ...playerSettings });
    appliedSettings = true;
  }

  return {
    islands: islands.length,
    sentences: sentences.length,
    reviews: reviews.length,
    meta: meta.length,
    inbox: inbox.length,
    vocab: (vocab ?? []).length,
    quizQuestions: (quizQuestions ?? []).length,
    quizProgress: (quizProgress ?? []).length,
    profiles: profileEntries.length,
    playerSettings: appliedSettings,
  };
}
