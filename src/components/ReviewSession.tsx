"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getReview,
  listAllReviews,
  listAllSentences,
  listSentencesByIsland,
  upsertReview,
} from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";
import { freshState, schedule, verdictToGrade } from "@/lib/sr";
import { foldErrorTags } from "@/lib/errorTags";
import { cancelAllSpeech, speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import { judge } from "@/lib/api/client";
import { getApiToken } from "@/lib/settings";
import { profileForRequest } from "@/lib/profile";
import type { TargetLanguage, JudgeResult } from "@/lib/api/contracts";
import type { Sentence } from "@/lib/types";
import { MicButton } from "./MicButton";

interface DeckItem {
  sentence: Sentence;
  isNew: boolean;
}

// ErrorType → i18n key for the error-type chips shown under a close/wrong verdict.
const ERROR_TYPE_LABEL_KEY: Record<string, string> = {
  WORD_ORDER: "errWordOrder",
  MORPHOLOGY: "errMorphology",
  VOCAB: "errVocab",
  PHONEME: "errPhoneme",
  FLUENCY_LATENCY: "errFluency",
};

export function ReviewSession({
  language,
  uiLocale,
  islandId,
  islandName,
}: {
  language: string;
  uiLocale: string;
  islandId?: string;
  islandName?: string;
}) {
  const t = useTranslations("review");
  const [queue, setQueue] = useState<DeckItem[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  // Typed-recall: the learner's attempt, the AI verdict (online), and whether
  // this card fell back to self-grading (offline / no backend / judge failed).
  const [attempt, setAttempt] = useState("");
  const [judging, setJudging] = useState(false);
  const [verdict, setVerdict] = useState<JudgeResult | null>(null);
  const [selfGraded, setSelfGraded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSeedLoaded(language);
        const [sentences, reviews] = await Promise.all([
          islandId ? listSentencesByIsland(islandId) : listAllSentences(language),
          listAllReviews(language),
        ]);
        const reviewById = new Map(reviews.map((r) => [r.sentenceId, r]));
        const now = Date.now();
        const deck: DeckItem[] = [];
        for (const s of sentences) {
          const r = reviewById.get(s.id);
          if (!r) {
            deck.push({ sentence: s, isNew: true });
          } else if (r.due <= now) {
            deck.push({ sentence: s, isNew: false });
          }
        }
        // Due cards first (oldest due first), then new cards in source order.
        deck.sort((a, b) => {
          if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
          const da = reviewById.get(a.sentence.id)?.due ?? 0;
          const db = reviewById.get(b.sentence.id)?.due ?? 0;
          return da - db;
        });
        if (!cancelled) setQueue(deck);
      } catch (err) {
        console.error(err);
        if (!cancelled) setQueue([]);
      }
    })();
    return () => {
      cancelled = true;
      cancelAllSpeech();
    };
  }, [language, islandId]);

  const current = queue?.[0];

  const reveal = useCallback(() => {
    if (!current) return;
    setRevealed(true);
    void speak(current.sentence.target, {
      lang: targetBcp47(current.sentence.language),
    });
  }, [current]);

  // Skip typing → straight to reveal + self-grade (the original flow).
  const onReveal = useCallback(() => {
    if (!current || revealed || judging) return;
    reveal();
  }, [current, revealed, judging, reveal]);

  // Submit the typed answer. Online + token → AI judge by meaning/naturalness;
  // otherwise (offline / no backend / judge failed) fall back to self-grading.
  // Either way we reveal — typing never blocks the review.
  const check = useCallback(async () => {
    if (!current || revealed || judging) return;
    const text = attempt.trim();
    if (!text) {
      reveal();
      return;
    }
    const lang = current.sentence.language as TargetLanguage;
    const online =
      typeof navigator !== "undefined" && navigator.onLine && !!getApiToken();
    if (!online) {
      setSelfGraded(true);
      reveal();
      return;
    }
    setJudging(true);
    try {
      const r = await judge({
        language: lang,
        native: current.sentence.native,
        target: current.sentence.target,
        attempt: text,
        profile: profileForRequest(lang),
      });
      setVerdict(r);
      reveal();
    } catch {
      setSelfGraded(true); // backend hiccup → don't block the review
      reveal();
    } finally {
      setJudging(false);
    }
  }, [current, revealed, judging, attempt, reveal]);

  const grade = useCallback(
    async (g: "again" | "good") => {
      if (!current) return;
      const prev =
        (await getReview(current.sentence.id)) ??
        freshState(current.sentence.id, current.sentence.language);
      // again/good is what the user taps; the FSRS grade (again/hard/good) is
      // derived from the AI verdict so the user never hand-picks difficulty.
      const next = schedule(prev, verdictToGrade(g, verdict?.verdict), new Date());
      // Accumulate the judge's typed failures onto the row (no-op on correct /
      // offline self-grade, where there are no errorTags).
      const folded = foldErrorTags(prev.errorTags, verdict?.errorTags, Date.now());
      if (folded) next.errorTags = folded;
      await upsertReview(next);
      cancelAllSpeech();
      setQueue((q) => {
        if (!q) return q;
        if (g === "again") {
          // Move current to the end of the queue.
          return [...q.slice(1), q[0]!];
        }
        return q.slice(1);
      });
      setRevealed(false);
      setAttempt("");
      setVerdict(null);
      setSelfGraded(false);
      setJudging(false);
      setDoneCount((c) => c + 1);
    },
    [current, verdict],
  );

  const suggested: "again" | "good" | null = verdict
    ? verdict.verdict === "wrong"
      ? "again"
      : "good"
    : null;

  if (queue === null) {
    return (
      <main className="p-6">
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      </main>
    );
  }

  if (queue.length === 0) {
    return (
      <main className="flex flex-1 flex-col gap-4 items-center justify-center px-6 py-12">
        <p className="text-2xl">{t("done")}</p>
        {doneCount > 0 && (
          <p className="text-sm text-zinc-500">{doneCount}</p>
        )}
        <a
          href={`/${uiLocale}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline mt-4"
        >
          ← {t("title")}
        </a>
      </main>
    );
  }

  const sentence = current!.sentence;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between gap-3">
        <a
          href={`/${uiLocale}/`}
          className="text-sm text-zinc-500 hover:underline underline-offset-4 shrink-0"
        >
          ← {t("title")}
        </a>
        {islandName && (
          <span className="text-sm font-medium truncate">{islandName}</span>
        )}
        <span className="text-sm text-zinc-500 tabular-nums shrink-0">
          {t("remaining", { n: queue.length })}
        </span>
      </header>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 bg-white dark:bg-zinc-950 min-h-[280px]">
        <div>
          <p className="text-xs text-zinc-500 mb-1">native</p>
          <p className="text-xl">{sentence.native}</p>
        </div>

        {revealed ? (
          <>
            <div>
              <p className="text-xs text-zinc-500 mb-1">target</p>
              <p className="text-2xl font-medium">{sentence.target}</p>
              {sentence.ipa && (
                <p className="text-sm text-zinc-500 font-mono mt-1">
                  /{sentence.ipa}/
                </p>
              )}
            </div>
            {sentence.note && (
              <div>
                <p className="text-xs text-zinc-500 mb-1">note</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {sentence.note}
                </p>
              </div>
            )}
            {attempt && (
              <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4 space-y-2">
                <div>
                  <p className="text-xs text-zinc-500 mb-1">{t("yourAnswer")}</p>
                  <p
                    className={`text-lg ${
                      verdict?.verdict === "wrong"
                        ? "text-red-600 dark:text-red-400"
                        : ""
                    }`}
                  >
                    {attempt}
                  </p>
                </div>
                {verdict && (
                  <div className="space-y-1">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        verdict.verdict === "correct"
                          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200"
                          : verdict.verdict === "close"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                            : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
                      }`}
                    >
                      {verdict.verdict === "correct"
                        ? t("verdictCorrect")
                        : verdict.verdict === "close"
                          ? t("verdictClose")
                          : t("verdictWrong")}
                    </span>
                    {verdict.tip && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        {verdict.tip}
                      </p>
                    )}
                    {verdict.better && (
                      <p className="text-sm">
                        <span className="text-zinc-400">{t("betterLabel")}: </span>
                        {verdict.better}
                      </p>
                    )}
                    {verdict.errorTags && verdict.errorTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {verdict.errorTags.map((tag, i) => (
                          <span
                            key={i}
                            className="inline-block rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 px-2 py-0.5 text-xs"
                          >
                            {t(ERROR_TYPE_LABEL_KEY[tag.type] ?? "errVocab")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {selfGraded && (
                  <p className="text-xs text-zinc-400">{t("judgeOffline")}</p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <textarea
                value={attempt}
                onChange={(e) => setAttempt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void check();
                  }
                }}
                placeholder={t("inputPlaceholder")}
                rows={2}
                disabled={judging}
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-base resize-none"
              />
              <MicButton
                lang={targetBcp47(sentence.language)}
                onText={(text) => setAttempt(text)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onReveal}
                disabled={judging}
                className="py-3 rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
              >
                {t("reveal")}
              </button>
              <button
                type="button"
                onClick={check}
                disabled={judging || !attempt.trim()}
                className="py-3 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium disabled:opacity-40"
              >
                {judging ? t("checking") : t("check")}
              </button>
            </div>
          </div>
        )}
      </section>

      {revealed && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => grade("again")}
            className={`py-4 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium ${
              suggested === "again"
                ? "ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-zinc-950"
                : ""
            }`}
          >
            {t("again")}
          </button>
          <button
            type="button"
            onClick={() => grade("good")}
            className={`py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium ${
              suggested === "good"
                ? "ring-2 ring-offset-2 ring-zinc-400 dark:ring-zinc-500 dark:ring-offset-zinc-950"
                : ""
            }`}
          >
            {t("good")}
          </button>
        </div>
      )}
    </main>
  );
}
