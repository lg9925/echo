// Browser speech-to-text via the Web Speech API. Free (Chrome routes to Google).
// Feature-detected with graceful degradation — callers hide the mic when
// unsupported. No React here.

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

// iOS standalone PWA exposes webkitSpeechRecognition but it's unreliable / often
// silently fails. Treat it as unsupported so the UI degrades to typing.
function isIosStandalone(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  return isIOS && standalone;
}

export function isDictationSupported(): boolean {
  if (isIosStandalone()) return false;
  return getCtor() !== null;
}

export interface DictationHandle {
  stop(): void;
  abort(): void;
}

export interface DictationOptions {
  lang: string;
  onResult: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

/** Start one dictation pass. Returns null if unsupported. */
export function startDictation(opts: DictationOptions): DictationHandle | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    let text = "";
    let isFinal = false;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result) continue;
      text += result[0].transcript;
      if (result.isFinal) isFinal = true;
    }
    opts.onResult(text, isFinal);
  };
  rec.onerror = (e) => opts.onError?.(e.error ?? "error");
  rec.onend = () => opts.onEnd?.();

  rec.start();
  return { stop: () => rec.stop(), abort: () => rec.abort() };
}
