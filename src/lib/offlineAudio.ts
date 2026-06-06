// Per-island offline audio. Pre-generates + caches the target-language clips of
// every sentence in an island so the whole island plays offline. No React.
//
// Scope (product decision): TARGET language, NORMAL speed only. Native (zh)
// falls back to the browser's built-in voice offline, and slow playback
// re-generates on demand — both keep the download small and cheap.
import { listSentencesByIsland } from "./db";
import { audioKey, deleteCachedAudio, getCachedAudio } from "./audioCache";
import { fetchClipBlob } from "./tts";

// Mirrors how playback speaks a sentence's target segment: segmentsForSentence()
// emits { text: sentence.target, lang: targetLang } and fetchClipBlob() keys it
// in the normal rate bucket. Same (text, lang-shortcode, bucket) → same key, so
// a downloaded clip is exactly the one the player reads back. (audioKey
// normalises "de-DE" → "de", so passing the island's short lang here matches.)
function targetKey(lang: string, target: string): string {
  return audioKey({ lang, voiceBucket: "default", rateBucket: "normal", text: target });
}

export interface IslandAudioStatus {
  total: number;
  /** How many target clips are already cached (offline-ready). */
  cached: number;
}

export async function islandAudioStatus(
  islandId: string,
  lang: string,
): Promise<IslandAudioStatus> {
  const sentences = await listSentencesByIsland(islandId);
  const hits = await Promise.all(
    sentences.map((s) => getCachedAudio(targetKey(lang, s.target))),
  );
  return { total: sentences.length, cached: hits.filter(Boolean).length };
}

export interface DownloadResult {
  total: number;
  /** Newly fetched from the server this run. */
  downloaded: number;
  alreadyCached: number;
  failed: number;
}

// Generate + cache any missing target clips, one sentence at a time (gentle on
// the server; the content-addressed server cache warms clip by clip). Reports
// progress after each sentence. Aborts cleanly if `signal` fires.
export async function downloadIsland(
  islandId: string,
  lang: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<DownloadResult> {
  const sentences = await listSentencesByIsland(islandId);
  const total = sentences.length;
  let downloaded = 0;
  let alreadyCached = 0;
  let failed = 0;

  for (let i = 0; i < sentences.length; i++) {
    if (signal?.aborted) break;
    const key = targetKey(lang, sentences[i]!.target);
    if (await getCachedAudio(key)) {
      alreadyCached++;
    } else {
      try {
        // Caches the clip as a side effect (ensureCachedAudio in tts.ts).
        await fetchClipBlob(sentences[i]!.target, lang, 1, signal);
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

export async function deleteIslandAudio(
  islandId: string,
  lang: string,
): Promise<void> {
  const sentences = await listSentencesByIsland(islandId);
  await Promise.all(
    sentences.map((s) => deleteCachedAudio(targetKey(lang, s.target))),
  );
}
