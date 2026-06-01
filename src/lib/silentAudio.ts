// Generate N-second silent audio clips. The playback engine plays these between
// sentences as REAL media so the inter-sentence pause survives backgrounding:
// the persistent audio element fires `ended` when the silence finishes (timers
// freeze in the background, media events don't), keeping the chain alive.
//
// Plain zero-filled 8 kHz / 16-bit mono PCM WAV — iOS Safari plays it from a
// blob URL and honours the exact duration (no MP3 encoder priming/padding). No
// OfflineAudioContext needed; building a 44-byte header over a zero buffer is
// synchronous and dependency-free. No React.

import { getCachedAudio, putCachedAudio, silenceKey } from "./audioCache";

const SAMPLE_RATE = 8000; // plenty for silence; ~16 KB/s

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

/** A valid WAV blob of `seconds` of pure silence. */
export function renderSilenceWav(seconds: number): Blob {
  const numSamples = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // chunk size
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size (PCM)
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  // samples are already zero (silence)

  return new Blob([buffer], { type: "audio/wav" });
}

/** Cache-first: at most ~10 distinct durations ever exist, so they persist. */
export async function getSilenceBlob(seconds: number): Promise<Blob> {
  const key = silenceKey(seconds);
  const hit = await getCachedAudio(key);
  if (hit) return hit.blob;
  const blob = renderSilenceWav(seconds);
  await putCachedAudio({ key, blob, mime: "audio/wav", createdAt: Date.now() });
  return blob;
}
