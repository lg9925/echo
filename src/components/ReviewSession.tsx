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
import { freshState, schedule } from "@/lib/sr";
import { cancelAllSpeech, speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import type { Sentence } from "@/lib/types";

interface DeckItem {
  sentence: Sentence;
  isNew: boolean;
}

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

  const onReveal = useCallback(() => {
    if (!current || revealed) return;
    setRevealed(true);
    void speak(current.sentence.target, {
      lang: targetBcp47(current.sentence.language),
    });
  }, [current, revealed]);

  const grade = useCallback(
    async (g: "again" | "good") => {
      if (!current) return;
      const prev =
        (await getReview(current.sentence.id)) ??
        freshState(current.sentence.id, current.sentence.language);
      const next = schedule(prev, g, new Date());
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
      setDoneCount((c) => c + 1);
    },
    [current],
  );

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
          </>
        ) : (
          <button
            type="button"
            onClick={onReveal}
            className="w-full py-4 rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            {t("reveal")}
          </button>
        )}
      </section>

      {revealed && (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => grade("again")}
            className="py-4 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium"
          >
            {t("again")}
          </button>
          <button
            type="button"
            onClick={() => grade("good")}
            className="py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
          >
            {t("good")}
          </button>
        </div>
      )}
    </main>
  );
}
