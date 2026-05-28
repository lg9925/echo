"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslations } from "next-intl";
import { listSentencesByIsland } from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";
import { cancelAllSpeech, speak } from "@/lib/tts";
import {
  DEFAULT_SETTINGS,
  type PlayerMode,
  type PlayerSettings,
  nextIndex,
  prevIndex,
  sleep,
} from "@/lib/player";
import type { Sentence } from "@/lib/types";

const NATIVE_LANG_BCP47 = "zh-CN";

const TARGET_LANG_MAP: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
  fr: "fr-FR",
};

function targetBcp47(language: string): string {
  return TARGET_LANG_MAP[language] ?? language;
}

export function ShadowPlayer({
  islandId,
  language,
  uiLocale,
  islandName,
}: {
  islandId: string;
  language: string;
  uiLocale: string;
  islandName: string;
}) {
  const t = useTranslations("player");
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [settings, setSettings] = useState<PlayerSettings>(DEFAULT_SETTINGS);
  const ttsSupported = useSyncExternalStore(
    () => () => {},
    () => "speechSynthesis" in window,
    () => true,
  );

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Load sentences once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSeedLoaded(language);
        const list = await listSentencesByIsland(islandId);
        if (!cancelled) setSentences(list);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [islandId, language]);

  // Play loop — re-runs whenever (isPlaying, idx, sentences) changes.
  useEffect(() => {
    if (!isPlaying) return;
    if (!sentences || !sentences[idx]) return;

    const ctrl = new AbortController();
    const targetLang = targetBcp47(language);

    (async () => {
      const current = sentences[idx]!;
      const { rate, pauseSec, gapSec, mode } = settingsRef.current;

      if (mode === "bilingual") {
        await speak(current.native, {
          lang: NATIVE_LANG_BCP47,
          rate,
          signal: ctrl.signal,
        });
        if (ctrl.signal.aborted) return;
        await sleep(pauseSec * 1000, ctrl.signal);
        if (ctrl.signal.aborted) return;
        await speak(current.target, {
          lang: targetLang,
          rate,
          signal: ctrl.signal,
        });
      } else {
        await speak(current.target, {
          lang: targetLang,
          rate,
          signal: ctrl.signal,
        });
      }
      if (ctrl.signal.aborted) return;
      await sleep(gapSec * 1000, ctrl.signal);
      if (ctrl.signal.aborted) return;

      setIdx((current) =>
        nextIndex(current, sentences.length, settingsRef.current.loop),
      );
    })();

    return () => {
      ctrl.abort();
      cancelAllSpeech();
    };
  }, [isPlaying, idx, sentences, language]);

  // Wake Lock: keep screen on while playing (best-effort; iOS often refuses).
  useEffect(() => {
    if (!isPlaying) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    (async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        /* user gesture missing or denied — ignore */
      }
    })();
    return () => {
      sentinel?.release().catch(() => {});
    };
  }, [isPlaying]);

  const onPlayPause = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  const onNext = useCallback(() => {
    if (!sentences) return;
    setIdx((current) =>
      nextIndex(current, sentences.length, settingsRef.current.loop),
    );
    cancelAllSpeech();
  }, [sentences]);

  const onPrev = useCallback(() => {
    if (!sentences) return;
    setIdx((current) =>
      prevIndex(current, sentences.length, settingsRef.current.loop),
    );
    cancelAllSpeech();
  }, [sentences]);

  const setMode = useCallback((mode: PlayerMode) => {
    setSettings((s) => ({ ...s, mode }));
  }, []);
  const setRate = useCallback((rate: number) => {
    setSettings((s) => ({ ...s, rate }));
  }, []);
  const setPauseSec = useCallback((pauseSec: number) => {
    setSettings((s) => ({ ...s, pauseSec }));
  }, []);

  const sentence = sentences?.[idx];
  const total = sentences?.length ?? 0;

  const backHref = `/${uiLocale}/`;

  if (loadError) {
    return (
      <main className="p-6">
        <p className="text-red-600 dark:text-red-400 text-sm">{loadError}</p>
      </main>
    );
  }
  if (!sentences) {
    return (
      <main className="p-6">
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      </main>
    );
  }
  if (sentences.length === 0) {
    return (
      <main className="p-6">
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between">
        <a
          href={backHref}
          className="text-sm text-zinc-500 hover:underline underline-offset-4"
        >
          ← {t("back")}
        </a>
        <h1 className="text-lg font-medium">{islandName}</h1>
        <span className="text-sm text-zinc-500 tabular-nums">
          {t("sentenceProgress", { current: idx + 1, total })}
        </span>
      </header>

      {!ttsSupported && (
        <p className="text-sm text-amber-600">{t("ttsUnsupported")}</p>
      )}

      {sentence && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4 bg-white dark:bg-zinc-950">
          <div>
            <p className="text-xs text-zinc-500 mb-1">native</p>
            <p className="text-lg">{sentence.native}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-1">target</p>
            <p className="text-2xl font-medium">{sentence.target}</p>
            {sentence.ipa && (
              <p className="text-sm text-zinc-500 font-mono mt-1">
                /{sentence.ipa}/
              </p>
            )}
          </div>
          {sentence.literal && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">literal</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {sentence.literal}
              </p>
            </div>
          )}
          {sentence.note && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">{t("note")}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {sentence.note}
              </p>
            </div>
          )}
          {sentence.variants.length > 0 && (
            <details className="text-sm">
              <summary className="text-xs text-zinc-500 cursor-pointer">
                {t("variants")} ({sentence.variants.length})
              </summary>
              <ul className="mt-2 space-y-1 list-disc list-inside text-zinc-600 dark:text-zinc-400">
                {sentence.variants.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <div className="flex gap-2 items-center justify-center">
        <button
          type="button"
          onClick={onPrev}
          className="px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          ◀ {t("prev")}
        </button>
        <button
          type="button"
          onClick={onPlayPause}
          disabled={!ttsSupported}
          className="px-6 py-3 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-40 font-medium min-w-[100px]"
        >
          {isPlaying ? t("pause") : t("play")}
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-4 py-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          {t("next")} ▶
        </button>
      </div>

      <section className="space-y-4 text-sm">
        <div>
          <label className="block text-xs text-zinc-500 mb-2">
            {t("mode")}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("bilingual")}
              className={`flex-1 px-3 py-2 rounded-lg border ${
                settings.mode === "bilingual"
                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              {t("modeBilingual")}
            </button>
            <button
              type="button"
              onClick={() => setMode("target-only")}
              className={`flex-1 px-3 py-2 rounded-lg border ${
                settings.mode === "target-only"
                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              {t("modeTargetOnly")}
            </button>
          </div>
        </div>

        <div>
          <label className="flex items-baseline justify-between text-xs text-zinc-500 mb-1">
            <span>{t("rate")}</span>
            <span className="tabular-nums">{settings.rate.toFixed(1)}x</span>
          </label>
          <input
            type="range"
            min="0.6"
            max="1.4"
            step="0.1"
            value={settings.rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div>
          <label className="flex items-baseline justify-between text-xs text-zinc-500 mb-1">
            <span>{t("pauseLabel")}</span>
            <span className="tabular-nums">
              {t("seconds", { n: settings.pauseSec })}
            </span>
          </label>
          <input
            type="range"
            min="1"
            max="8"
            step="1"
            value={settings.pauseSec}
            onChange={(e) => setPauseSec(parseInt(e.target.value, 10))}
            className="w-full"
          />
        </div>
      </section>
    </main>
  );
}
