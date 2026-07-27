"use client";

// M6 HVPT 感知训练: hear ONE word of a minimal pair (random speaker out of 6)
// → tap which word it was → instant feedback + replay both with the same
// voice. Drill logic in src/lib/a1/hvpt.ts; per-pair streak in Dexie
// hvptProgress. NO pronunciation scoring anywhere — this trains the EAR.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { listHvptProgress, recordHvptAnswer } from "@/lib/db";
import {
  buildHvptRound,
  contrastStatus,
  HVPT_BANK,
  HVPT_TTS_PROVIDER,
  makeHvptItem,
  type ContrastStatus,
  type HvptContrast,
  type HvptItem,
} from "@/lib/a1/hvpt";
import { logActivity } from "@/lib/studyLog";
import { cancelAllSpeech, prewarmAudio, speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";

export function HvptSession({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("a1");
  const [statuses, setStatuses] = useState<Map<string, ContrastStatus> | null>(null);
  const [contrast, setContrast] = useState<HvptContrast | null>(null);
  const [items, setItems] = useState<HvptItem[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState<"a" | "b" | null>(null);
  const [score, setScore] = useState(0);
  const roundStartRef = useRef(0);
  const bcp47 = targetBcp47(language);

  const loadStatuses = useCallback(async () => {
    const progress = await listHvptProgress();
    setStatuses(
      new Map(HVPT_BANK.contrasts.map((c) => [c.id, contrastStatus(c, progress)])),
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; state settles after IO (load-effect pattern used across the app)
    void loadStatuses();
    return () => cancelAllSpeech();
  }, [loadStatuses]);

  const startRound = useCallback(
    async (c: HvptContrast) => {
      const progress = await listHvptProgress();
      const round = buildHvptRound(c, progress).map((pair) => makeHvptItem(pair));
      roundStartRef.current = Date.now();
      setContrast(c);
      setItems(round);
      setIdx(0);
      setScore(0);
      setAnswered(null);
      // Prewarm the first few items' clips (both words, the item's voice).
      for (const item of round.slice(0, 4)) {
        void prewarmAudio(item.pair.a, bcp47, 1, item.voice, HVPT_TTS_PROVIDER);
        void prewarmAudio(item.pair.b, bcp47, 1, item.voice, HVPT_TTS_PROVIDER);
      }
    },
    [bcp47],
  );

  const current = items?.[idx];

  const playCurrent = useCallback(() => {
    if (!current) return;
    const word = current.spoken === "a" ? current.pair.a : current.pair.b;
    void speak(word, {
      lang: bcp47,
      serverVoice: current.voice,
      serverProvider: HVPT_TTS_PROVIDER,
    });
  }, [current, bcp47]);

  useEffect(() => {
    if (current) playCurrent();
  }, [current, playCurrent]);

  // Prewarm a couple of items ahead while this one is on screen.
  useEffect(() => {
    if (!items) return;
    for (const item of items.slice(idx + 1, idx + 3)) {
      void prewarmAudio(item.pair.a, bcp47, 1, item.voice, HVPT_TTS_PROVIDER);
      void prewarmAudio(item.pair.b, bcp47, 1, item.voice, HVPT_TTS_PROVIDER);
    }
  }, [items, idx, bcp47]);

  const answer = useCallback(
    async (choice: "a" | "b") => {
      if (!current || answered) return;
      setAnswered(choice);
      const right = choice === current.spoken;
      if (right) setScore((s) => s + 1);
      await recordHvptAnswer(current.pair.id, right);
    },
    [current, answered],
  );

  const next = useCallback(async () => {
    if (!items) return;
    if (idx + 1 >= items.length) {
      // Round complete → one study-log event (class hvpt) + refreshed statuses.
      await logActivity({
        language,
        source: "hvpt",
        durationMs: Date.now() - roundStartRef.current,
        units: items.length,
      });
      setItems(null);
      setContrast(null);
      await loadStatuses();
      return;
    }
    setAnswered(null);
    setIdx((i) => i + 1);
  }, [items, idx, language, loadStatuses]);

  // ---- contrast chooser ----
  if (!contrast || !items) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
        <header className="flex items-center justify-between gap-3">
          <a
            href={`/${uiLocale}/a1/`}
            className="text-sm text-zinc-500 hover:underline underline-offset-4"
          >
            ← {t("title")}
          </a>
        </header>
        <h1 className="text-xl font-semibold">{t("hvptTitle")}</h1>
        <p className="text-sm text-zinc-500">{t("hvptIntro")}</p>
        <section className="space-y-3">
          {HVPT_BANK.contrasts.map((c) => {
            const s = statuses?.get(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => void startRound(c)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <p className="text-lg font-medium">{c.title.zh}</p>
                {s && (
                  <p className="text-sm text-zinc-500 mt-1 tabular-nums">
                    {t("hvptStatus", { mastered: s.mastered, total: s.total })}
                  </p>
                )}
              </button>
            );
          })}
        </section>
      </main>
    );
  }

  // ---- drill ----
  const right = answered !== null && answered === current!.spoken;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            cancelAllSpeech();
            setItems(null);
            setContrast(null);
          }}
          className="text-sm text-zinc-500 hover:underline underline-offset-4"
        >
          ← {contrast.title.zh}
        </button>
        <span className="text-sm text-zinc-500 tabular-nums">
          {idx + 1}/{items.length} · ✓{score}
        </span>
      </header>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-6 bg-white dark:bg-zinc-950">
        <div className="flex items-center gap-3">
          <p className="text-sm text-zinc-500">{t("hvptWhich")}</p>
          <button
            type="button"
            onClick={playCurrent}
            className="rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-base"
          >
            🔊 {t("playAgain")}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {(["a", "b"] as const).map((side) => {
            const word = side === "a" ? current!.pair.a : current!.pair.b;
            const state = !answered
              ? "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              : side === current!.spoken
                ? "border-green-500 bg-green-50 dark:bg-green-950"
                : side === answered
                  ? "border-red-500 bg-red-50 dark:bg-red-950"
                  : "border-zinc-200 dark:border-zinc-800 opacity-50";
            return (
              <button
                key={side}
                type="button"
                disabled={!!answered}
                onClick={() => void answer(side)}
                className={`py-6 rounded-xl border-2 text-2xl font-medium ${state}`}
              >
                {word}
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="space-y-2">
            <p
              className={`text-sm font-medium ${
                right
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {right ? t("hvptRight") : t("hvptWrong")}
            </p>
            {current!.pair.note && (
              <p className="text-sm text-zinc-500">{current!.pair.note}</p>
            )}
            <div className="flex gap-2">
              {(["a", "b"] as const).map((side) => {
                const word = side === "a" ? current!.pair.a : current!.pair.b;
                return (
                  <button
                    key={side}
                    type="button"
                    onClick={() =>
                      void speak(word, {
                        lang: bcp47,
                        serverVoice: current!.voice,
                        serverProvider: HVPT_TTS_PROVIDER,
                      })
                    }
                    className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-sm"
                  >
                    🔊 {word}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {answered && (
        <button
          type="button"
          onClick={() => void next()}
          className="py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
        >
          {idx + 1 >= items.length ? t("roundDone") : t("continue")}
        </button>
      )}
    </main>
  );
}
