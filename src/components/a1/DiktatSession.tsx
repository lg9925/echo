"use client";

// 听写 (Diktat, M4): play sentence audio → type → char-diff highlight →
// instant verdict. Sentence length climbs a ladder (3 consecutive ≥90% up,
// 2 consecutive below down — src/lib/a1/diktat.ts); failures become error
// cards in the A1 deck (src/lib/a1/errorCards.ts). Numbers sub-mode drills
// phone/price/time with pure generators. Fully offline once audio is cached.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getCurriculum,
  listAllSentences,
  listDictationAttempts,
  putCurriculum,
  recordDictationAttempt,
} from "@/lib/db";
import { ensureCurriculum } from "@/lib/a1/loader";
import {
  applyLadder,
  DIKTAT_ACCURACY_THRESHOLD,
  pickDictationSentences,
} from "@/lib/a1/diktat";
import { charAccuracy, classifyDictationErrors, diffChars, type DiffOp } from "@/lib/a1/charDiff";
import {
  generateNumberItem,
  matchesNumber,
  type NumberItem,
  type NumberKind,
} from "@/lib/a1/numbers";
import { createErrorCard } from "@/lib/a1/errorCards";
import { logActivity } from "@/lib/studyLog";
import { allCachedAudioKeys, audioKey } from "@/lib/audioCache";
import { cancelAllSpeech, prewarmAudio, speak, stripParentheticals } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import type { Sentence } from "@/lib/types";
import { DiffLine } from "./DiffLine";

const ROUND_SIZE = 5;

type Mode = "sentence" | NumberKind;

interface RoundItem {
  /** Reference text the user must type (sentence target, or digits display). */
  text: string;
  /** What the TTS speaks. */
  spoken: string;
  sentenceId?: string;
  number?: NumberItem;
}

export function DiktatSession({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("a1");
  const [mode, setMode] = useState<Mode>("sentence");
  const [round, setRound] = useState<RoundItem[] | null>(null);
  const [level, setLevel] = useState(1);
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [passed, setPassed] = useState(false);
  const [accuracy, setAccuracy] = useState(0);
  const [diff, setDiff] = useState<DiffOp[] | null>(null);
  const [empty, setEmpty] = useState(false);
  const itemShownAtRef = useRef(0);

  const bcp47 = targetBcp47(language);

  const buildRound = useCallback(
    async (m: Mode) => {
      setRound(null);
      setIdx(0);
      setTyped("");
      setChecked(false);
      setDiff(null);
      setEmpty(false);
      if (m === "sentence") {
        const curriculum = await ensureCurriculum(language);
        setLevel(curriculum.diktatLevel);
        const [sentences, attempts] = await Promise.all([
          listAllSentences(language),
          listDictationAttempts(language),
        ]);
        // Offline: only sentences whose normal-rate clip is already cached are
        // playable (the SpeechSynthesis fallback still works on most platforms,
        // so this filter only applies when truly offline).
        let cachedTexts: Set<string> | null = null;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const keys = await allCachedAudioKeys();
          cachedTexts = new Set(
            sentences
              .map((s) => s.target)
              .filter((text) =>
                keys.has(
                  audioKey({
                    lang: bcp47,
                    voiceBucket: "default",
                    rateBucket: "normal",
                    text: stripParentheticals(text),
                  }),
                ),
              ),
          );
        }
        const picked = pickDictationSentences(
          sentences,
          attempts,
          curriculum.diktatLevel,
          ROUND_SIZE,
          cachedTexts,
        );
        if (picked.length === 0) {
          setEmpty(true);
          setRound([]);
          return;
        }
        // Prewarm the round's clips while online (best-effort).
        for (const s of picked) void prewarmAudio(stripParentheticals(s.target), bcp47);
        setRound(
          picked.map((s: Sentence) => ({
            text: s.target,
            spoken: stripParentheticals(s.target),
            sentenceId: s.id,
          })),
        );
      } else {
        const items = Array.from({ length: ROUND_SIZE }, () =>
          generateNumberItem(m, Math.random),
        );
        setRound(
          items.map((n) => ({ text: n.display, spoken: n.spoken, number: n })),
        );
      }
    },
    [language, bcp47],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async round build; states settle after IO (mirrors the load-effect pattern elsewhere)
    void buildRound(mode);
    return () => cancelAllSpeech();
  }, [mode, buildRound]);

  const current = round?.[idx];

  const play = useCallback(() => {
    if (!current) return;
    void speak(current.spoken, { lang: bcp47 });
  }, [current, bcp47]);

  useEffect(() => {
    if (current) {
      itemShownAtRef.current = Date.now();
      play();
    }
  }, [current, play]);

  const check = useCallback(async () => {
    if (!current || checked || typed.trim().length === 0) return;
    let ok: boolean;
    let acc: number;
    if (current.number) {
      ok = matchesNumber(current.number.kind, current.number.canonical, typed);
      acc = ok ? 1 : 0;
      setDiff(null);
    } else {
      acc = charAccuracy(current.text, typed);
      ok = acc >= DIKTAT_ACCURACY_THRESHOLD;
      setDiff(diffChars(current.text, typed));
    }
    setAccuracy(acc);
    setPassed(ok);
    setChecked(true);

    await recordDictationAttempt({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      language,
      mode: current.number ? "number" : "sentence",
      numberKind: current.number?.kind,
      text: current.text,
      typed: typed.trim(),
      accuracy: acc,
      level,
      sentenceId: current.sentenceId,
      createdAt: Date.now(),
    });

    if (!current.number) {
      // Ladder rides on the curriculum singleton (sentence mode only).
      const curriculum =
        (await getCurriculum(language)) ?? (await ensureCurriculum(language));
      const nextState = applyLadder(curriculum, acc, Date.now());
      await putCurriculum(nextState);
      setLevel(nextState.diktatLevel);
    }
    if (!ok) {
      await createErrorCard({
        language,
        source: "dictation",
        text: current.text,
        mode: current.number ? "number" : "sentence",
        numberKind: current.number?.kind,
        sentenceId: current.sentenceId,
        errorTags: current.number
          ? [{ type: "VOCAB", detail: `number-${current.number.kind}` }]
          : classifyDictationErrors(current.text, typed),
      });
    }
    await logActivity({
      language,
      source: "diktat",
      durationMs: Date.now() - itemShownAtRef.current,
      units: 1,
    });
  }, [current, checked, typed, language, level]);

  const next = useCallback(() => {
    setTyped("");
    setChecked(false);
    setDiff(null);
    setIdx((i) => i + 1);
  }, []);

  const modeTabs: Array<{ key: Mode; label: string }> = [
    { key: "sentence", label: t("modeSentence") },
    { key: "phone", label: t("modePhone") },
    { key: "price", label: t("modePrice") },
    { key: "time", label: t("modeTime") },
  ];

  if (round === null) {
    return (
      <main className="p-6">
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      </main>
    );
  }

  const roundDone = idx >= round.length;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between gap-3">
        <a
          href={`/${uiLocale}/a1/`}
          className="text-sm text-zinc-500 hover:underline underline-offset-4 shrink-0"
        >
          ← {t("title")}
        </a>
        {mode === "sentence" && (
          <span className="text-sm text-zinc-500 tabular-nums">
            {t("diktatLevel", { level })}
          </span>
        )}
        {!roundDone && (
          <span className="text-sm text-zinc-500 tabular-nums shrink-0">
            {idx + 1}/{round.length}
          </span>
        )}
      </header>

      <div className="flex gap-2">
        {modeTabs.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              mode === m.key
                ? "border-zinc-900 dark:border-zinc-100 font-medium"
                : "border-zinc-300 dark:border-zinc-700 text-zinc-500"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {empty ? (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950">
          <p className="text-sm text-zinc-500">{t("diktatEmpty")}</p>
        </section>
      ) : roundDone ? (
        <section className="flex flex-col items-center gap-4 py-10">
          <p className="text-2xl">{t("roundDone")}</p>
          <button
            type="button"
            onClick={() => void buildRound(mode)}
            className="px-6 py-3 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
          >
            {t("anotherRound")}
          </button>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 bg-white dark:bg-zinc-950 min-h-[240px]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={play}
                className="rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-base"
              >
                🔊 {t("playAgain")}
              </button>
            </div>

            {checked ? (
              <div className="space-y-2">
                {diff ? (
                  <DiffLine ops={diff} />
                ) : (
                  <p
                    className={`text-xl font-medium ${
                      passed
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {typed.trim()} {passed ? "✓" : `→ ${current!.text}`}
                  </p>
                )}
                <p className="text-sm text-zinc-500 tabular-nums">
                  {t("accuracy", { pct: Math.round(accuracy * 100) })}
                  {!passed && ` · ${t("addedToDeck")}`}
                </p>
              </div>
            ) : (
              <textarea
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void check();
                  }
                }}
                placeholder={
                  current?.number ? t("numberPlaceholder") : t("diktatPlaceholder")
                }
                rows={2}
                inputMode={current?.number ? "decimal" : undefined}
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-lg resize-none"
              />
            )}
          </section>

          {checked ? (
            <button
              type="button"
              onClick={next}
              className="py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
            >
              {t("continue")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void check()}
              disabled={typed.trim().length === 0}
              className="py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium disabled:opacity-40"
            >
              {t("check")}
            </button>
          )}
        </>
      )}
    </main>
  );
}

