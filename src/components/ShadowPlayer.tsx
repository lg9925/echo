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
import { cancelAllSpeech, speak, stripParentheticals, unlockSpeech } from "@/lib/tts";
import { getApiToken } from "@/lib/settings";
import {
  getServerSnapshot as pbGetServerSnapshot,
  getSnapshot as pbGetSnapshot,
  next as pbNext,
  pause as pbPause,
  prev as pbPrev,
  resume as pbResume,
  start as pbStart,
  stop as pbStop,
  subscribe as pbSubscribe,
  updateSettings as pbUpdateSettings,
} from "@/lib/playback";
import {
  DEFAULT_SETTINGS,
  loadPlayerSettings,
  type PlayerMode,
  type PlayerSettings,
  nextIndex,
  prevIndex,
  savePlayerSettings,
  sleep,
} from "@/lib/player";
import { NATIVE_LANG_BCP47, targetBcp47 } from "@/lib/lang";
import { logActivity } from "@/lib/studyLog";
import type { Sentence } from "@/lib/types";
import { TargetTokenized } from "./TargetTokenized";
import { KeywordExtractor } from "./KeywordExtractor";

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
  // Local state drives the synth fallback (no token). The neural engine has its
  // own store; `idx`/`isPlaying` below normalise the two so the UI is one path.
  const [localIdx, setLocalIdx] = useState(0);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [settings, setSettings] = useState<PlayerSettings>(DEFAULT_SETTINGS);
  const [playingVariantIdx, setPlayingVariantIdx] = useState<number | null>(
    null,
  );

  // Neural engine (background-capable + MediaSession) when a TTS token exists;
  // otherwise the SpeechSynthesis fallback loop below. Decided after mount to
  // avoid an SSR/client hydration mismatch on localStorage.
  const [engineEnabled, setEngineEnabled] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot token check after mount (SSR has no localStorage)
    setEngineEnabled(!!getApiToken());
  }, []);
  const engineState = useSyncExternalStore(
    pbSubscribe,
    pbGetSnapshot,
    pbGetServerSnapshot,
  );
  const idx = engineEnabled ? engineState.sentenceIdx : localIdx;
  const isPlaying = engineEnabled
    ? engineState.status === "playing"
    : localPlaying;

  // Restore persisted settings AFTER hydration (useState init can't, because
  // SSR sees no localStorage and React reconciles against the SSR'd value).
  useEffect(() => {
    const persisted = loadPlayerSettings();
    if (persisted !== DEFAULT_SETTINGS) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage rehydration after mount
      setSettings(persisted);
    }
  }, []);

  // Persist on every change.
  useEffect(() => {
    savePlayerSettings(settings);
  }, [settings]);
  const ttsSupported = useSyncExternalStore(
    () => () => {},
    () => "speechSynthesis" in window,
    () => true,
  );

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // M2/M7 instrumentation: each sentence advance while playing = one shadowed
  // input unit (MVD's 可理解输入 leg). Duration = time on the previous sentence,
  // capped so a backgrounded tab can't log an hour on one sentence.
  const shadowTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying) {
      shadowTickRef.current = null;
      return;
    }
    const now = Date.now();
    if (shadowTickRef.current !== null) {
      const elapsed = Math.min(now - shadowTickRef.current, 60_000);
      logActivity({
        language,
        source: "shadow",
        durationMs: elapsed,
        units: 1,
      }).catch(() => {});
    }
    shadowTickRef.current = now;
  }, [idx, isPlaying, language]);

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

  // Synth fallback loop (no token) — re-runs on (localPlaying, localIdx,
  // sentences). The neural path is driven by the engine instead. SpeechSynthesis
  // can't play backgrounded, so this stays the simple setTimeout-gapped loop.
  useEffect(() => {
    if (engineEnabled) return;
    if (!localPlaying) return;
    if (!sentences || !sentences[localIdx]) return;

    const ctrl = new AbortController();
    const targetLang = targetBcp47(language);

    (async () => {
      const current = sentences[localIdx]!;
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

      if (settingsRef.current.autoAdvance) {
        setLocalIdx((current) =>
          nextIndex(current, sentences.length, settingsRef.current.loop),
        );
      } else {
        setLocalPlaying(false);
      }
    })();

    return () => {
      ctrl.abort();
      cancelAllSpeech();
    };
  }, [engineEnabled, localPlaying, localIdx, sentences, language]);

  // Push live settings changes into the engine (rate lands on the next clip;
  // mode/pause/gap on the next sentence).
  useEffect(() => {
    if (engineEnabled) pbUpdateSettings(settings);
  }, [engineEnabled, settings]);

  // Tear the engine down when leaving the player.
  useEffect(() => {
    return () => {
      pbStop();
    };
  }, []);

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

  // Must run inside the tap gesture (iOS unlocks the audio element on the first
  // gesture-initiated play()).
  const startEngine = useCallback(
    (startIdx: number) => {
      if (!sentences) return;
      pbStart({
        sentences,
        settings: settingsRef.current,
        nativeLang: NATIVE_LANG_BCP47,
        targetLang: targetBcp47(language),
        islandName,
        startIdx,
      });
    },
    [sentences, language, islandName],
  );

  const onPlayPause = useCallback(() => {
    if (engineEnabled) {
      if (engineState.status === "playing") pbPause();
      else if (engineState.status === "paused") pbResume();
      else startEngine(idx);
      return;
    }
    unlockSpeech(); // iOS: unlock SpeechSynthesis inside the tap gesture
    setLocalPlaying((p) => !p);
  }, [engineEnabled, engineState.status, idx, startEngine]);

  const onNext = useCallback(() => {
    if (!sentences) return;
    if (engineEnabled) {
      if (engineState.status === "idle") {
        startEngine(nextIndex(idx, sentences.length, settingsRef.current.loop));
      } else {
        pbNext();
      }
      return;
    }
    unlockSpeech();
    cancelAllSpeech();
    setLocalIdx((current) =>
      nextIndex(current, sentences.length, settingsRef.current.loop),
    );
    setLocalPlaying(true);
  }, [engineEnabled, engineState.status, idx, sentences, startEngine]);

  const onPrev = useCallback(() => {
    if (!sentences) return;
    if (engineEnabled) {
      if (engineState.status === "idle") {
        startEngine(prevIndex(idx, sentences.length, settingsRef.current.loop));
      } else {
        pbPrev();
      }
      return;
    }
    unlockSpeech();
    cancelAllSpeech();
    setLocalIdx((current) =>
      prevIndex(current, sentences.length, settingsRef.current.loop),
    );
    setLocalPlaying(true);
  }, [engineEnabled, engineState.status, idx, sentences, startEngine]);

  const setMode = useCallback((mode: PlayerMode) => {
    setSettings((s) => ({ ...s, mode }));
  }, []);
  const setAutoAdvance = useCallback((autoAdvance: boolean) => {
    setSettings((s) => ({ ...s, autoAdvance }));
  }, []);
  const setRate = useCallback((rate: number) => {
    setSettings((s) => ({ ...s, rate }));
  }, []);
  const setPauseSec = useCallback((pauseSec: number) => {
    setSettings((s) => ({ ...s, pauseSec }));
  }, []);
  const setGapSec = useCallback((gapSec: number) => {
    setSettings((s) => ({ ...s, gapSec }));
  }, []);

  const stopForOneShot = useCallback(() => {
    if (engineEnabled) pbPause();
    else {
      cancelAllSpeech();
      setLocalPlaying(false);
    }
  }, [engineEnabled]);

  const onTapWord = useCallback(
    (word: string) => {
      stopForOneShot();
      void speak(word, {
        lang: targetBcp47(language),
        rate: settingsRef.current.rate,
      });
    },
    [language, stopForOneShot],
  );

  const speakVariant = useCallback(
    async (text: string, i: number) => {
      stopForOneShot();
      setPlayingVariantIdx(i);
      try {
        await speak(stripParentheticals(text), {
          lang: targetBcp47(language),
          rate: settingsRef.current.rate,
        });
      } finally {
        setPlayingVariantIdx((current) => (current === i ? null : current));
      }
    },
    [language, stopForOneShot],
  );

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

      <KeywordExtractor
        language={language}
        islandId={islandId}
        islandName={islandName}
      />

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
            <TargetTokenized target={sentence.target} onTapWord={onTapWord} />
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
              <p className="text-xs text-zinc-500 mt-2">
                {t("tapVariantHint")}
              </p>
              <ul className="mt-2 space-y-1">
                {sentence.variants.map((v, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => speakVariant(v, i)}
                      className={`block w-full text-left px-2 py-2 rounded-md text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                        playingVariantIdx === i
                          ? "bg-zinc-100 dark:bg-zinc-900"
                          : ""
                      }`}
                    >
                      {v}
                    </button>
                  </li>
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
            {t("advance")}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAutoAdvance(true)}
              className={`flex-1 px-3 py-2 rounded-lg border ${
                settings.autoAdvance
                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              {t("autoAdvance")}
            </button>
            <button
              type="button"
              onClick={() => setAutoAdvance(false)}
              className={`flex-1 px-3 py-2 rounded-lg border ${
                !settings.autoAdvance
                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              {t("manualAdvance")}
            </button>
          </div>
        </div>

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

        {/* Fine-tuning sliders — good defaults, hidden by default (原则一). */}
        <details className="space-y-4">
          <summary className="cursor-pointer select-none text-xs text-zinc-500">
            {t("advancedControls")}
          </summary>

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

          <div className={settings.autoAdvance ? "" : "opacity-50"}>
            <label className="flex items-baseline justify-between text-xs text-zinc-500 mb-1">
              <span>{t("gapLabel")}</span>
              <span className="tabular-nums">
                {t("seconds", { n: settings.gapSec })}
              </span>
            </label>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={settings.gapSec}
              onChange={(e) => setGapSec(parseInt(e.target.value, 10))}
              disabled={!settings.autoAdvance}
              className="w-full"
            />
          </div>
        </details>
      </section>
    </main>
  );
}
