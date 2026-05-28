let _voicesCache: SpeechSynthesisVoice[] | null = null;
let _voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (_voicesCache) return Promise.resolve(_voicesCache);
  if (_voicesPromise) return _voicesPromise;

  _voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const initial = synth.getVoices();
    if (initial && initial.length > 0) {
      _voicesCache = initial;
      resolve(initial);
      return;
    }
    const handler = () => {
      const v = synth.getVoices();
      if (v && v.length > 0) {
        _voicesCache = v;
        synth.removeEventListener("voiceschanged", handler);
        resolve(v);
      }
    };
    synth.addEventListener("voiceschanged", handler);
    // Safety fallback: resolve empty after 3s so the app doesn't hang.
    setTimeout(() => {
      const v = synth.getVoices();
      _voicesCache = v;
      synth.removeEventListener("voiceschanged", handler);
      resolve(v);
    }, 3000);
  });

  return _voicesPromise;
}

export async function listVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined") return [];
  return loadVoices();
}

export async function pickVoice(
  lang: string,
): Promise<SpeechSynthesisVoice | undefined> {
  if (typeof window === "undefined") return undefined;
  const voices = await loadVoices();
  const prefix = lang.split("-")[0]!.toLowerCase();
  const exact = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase());
  if (exact) return exact;
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
}

export interface SpeakOptions {
  lang: string;
  rate?: number;
  voice?: SpeechSynthesisVoice;
  signal?: AbortSignal;
}

export async function speak(
  text: string,
  opts: SpeakOptions,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (opts.signal?.aborted) return;

  const synth = window.speechSynthesis;
  const voice = opts.voice ?? (await pickVoice(opts.lang));

  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = opts.lang;
    utterance.rate = opts.rate ?? 1;
    if (voice) utterance.voice = voice;

    let settled = false;
    let safety: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (safety) clearTimeout(safety);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      synth.cancel();
      finish();
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    opts.signal?.addEventListener("abort", onAbort);

    // Safety: if the browser produces no voices (e.g. some embedded Chromes),
    // speak() may never fire end/error. Cap each utterance at a generous bound
    // so the player loop doesn't hang.
    const cap = Math.min(30000, Math.max(2000, text.length * 120));
    safety = setTimeout(() => {
      synth.cancel();
      finish();
    }, cap);

    synth.speak(utterance);
  });
}

export function cancelAllSpeech(): void {
  if (typeof window === "undefined") return;
  window.speechSynthesis.cancel();
}
