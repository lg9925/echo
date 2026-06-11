// Offline audio: pre-generate + cache the TTS clips a unit needs, so it plays
// offline. Used by sentence islands (IslandList) and the citizenship quiz
// (EinbuergerungHome). No React.
//
// Scope (product decision): TARGET/German language, NORMAL speed only — the
// same (text, lang, bucket) the players already speak. Native (zh) and slow
// playback fall back to the browser's built-in voice / on-demand synthesis.
import { listSentencesByIsland } from "./db";
import { audioKey, deleteCachedAudio, getCachedAudio } from "./audioCache";
import { fetchClipBlob } from "./tts";
import type { QuizQuestion } from "./types";

// Normal-speed key for one text, matching how speak()/playback key their clips.
// audioKey normalises the lang ("de-DE" → "de"), so the short code is fine here.
function normalKey(lang: string, text: string): string {
  return audioKey({ lang, voiceBucket: "default", rateBucket: "normal", text });
}

export interface AudioStatus {
  total: number;
  /** How many clips are already cached (offline-ready). */
  cached: number;
}
/** @deprecated alias kept for existing island callers. */
export type IslandAudioStatus = AudioStatus;

export interface DownloadResult {
  total: number;
  /** Newly fetched from the server this run. */
  downloaded: number;
  alreadyCached: number;
  failed: number;
}

// ── Generic core over an ordered list of German texts ───────────────────────

// Generate + cache any missing clips, one text at a time (gentle on the server;
// the content-addressed server cache warms clip by clip). Reports progress
// after each. Aborts cleanly if `signal` fires.
async function downloadTexts(
  texts: string[],
  lang: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const total = texts.length;
  let downloaded = 0;
  let alreadyCached = 0;
  let failed = 0;

  for (let i = 0; i < texts.length; i++) {
    if (signal?.aborted) break;
    const key = normalKey(lang, texts[i]!);
    if (await getCachedAudio(key)) {
      alreadyCached++;
    } else {
      try {
        // Caches the clip as a side effect (ensureCachedAudio in tts.ts).
        await fetchClipBlob(texts[i]!, lang, 1, signal);
        downloaded++;
      } catch {
        // No token / offline / server error — count it, keep going.
        failed++;
      }
    }
    onProgress?.(i + 1, total);
  }

  return { total, downloaded, alreadyCached, failed };
}

async function deleteTexts(texts: string[], lang: string): Promise<void> {
  await Promise.all(texts.map((t) => deleteCachedAudio(normalKey(lang, t))));
}

// ── Sentence islands (one clip per sentence: its target) ────────────────────

export async function islandAudioStatus(
  islandId: string,
  lang: string,
): Promise<AudioStatus> {
  const sentences = await listSentencesByIsland(islandId);
  const hits = await Promise.all(
    sentences.map((s) => getCachedAudio(normalKey(lang, s.target))),
  );
  return { total: sentences.length, cached: hits.filter(Boolean).length };
}

export async function downloadIsland(
  islandId: string,
  lang: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const sentences = await listSentencesByIsland(islandId);
  return downloadTexts(sentences.map((s) => s.target), lang, onProgress, signal);
}

export async function deleteIslandAudio(
  islandId: string,
  lang: string,
): Promise<void> {
  const sentences = await listSentencesByIsland(islandId);
  await deleteTexts(sentences.map((s) => s.target), lang);
}

// ── Citizenship quiz (per question: question + each option + anchor word) ───

// The unique German strings a set of questions speaks, mirroring QuizCard's
// speak() calls: the full question, every option, and the study anchor word.
// (Word-by-word taps are out of scope — too many, mostly untapped, cheap to
// synthesise live; they fall back to the browser voice offline.)
export function quizTexts(questions: QuizQuestion[]): string[] {
  const set = new Set<string>();
  const add = (s?: string | null) => {
    const v = s?.trim();
    if (v) set.add(v);
  };
  for (const q of questions) {
    add(q.question_de);
    for (const o of q.options) add(o.de);
    add(q.study?.anchor_q);
  }
  return [...set];
}

// Sync status against a pre-loaded key set (allCachedAudioKeys). Sync because
// the quiz recomputes it on every filter change — hitting IndexedDB per text
// each time would be far too chatty.
export function quizAudioStatus(
  questions: QuizQuestion[],
  lang: string,
  cachedKeys: Set<string>,
): AudioStatus {
  const texts = quizTexts(questions);
  let cached = 0;
  for (const text of texts) {
    if (cachedKeys.has(normalKey(lang, text))) cached++;
  }
  return { total: texts.length, cached };
}

export async function downloadQuizAudio(
  questions: QuizQuestion[],
  lang: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  return downloadTexts(quizTexts(questions), lang, onProgress, signal);
}

export async function deleteQuizAudio(
  questions: QuizQuestion[],
  lang: string,
): Promise<void> {
  await deleteTexts(quizTexts(questions), lang);
}
