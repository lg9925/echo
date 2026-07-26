"use client";

// A1 interleaved card session — word recognition / noun production / cloze /
// dictation-error cards, one FSRS deck, objectively graded (offline, instant).
// Queue building, interleaving and throttling live in src/lib/a1/deck.ts; this
// component dispatches and renders (no business logic in JSX).

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getCardReview,
  listAllReviews,
  listAllSentences,
  listCardReviews,
  listStudyDays,
  upsertCardReview,
} from "@/lib/db";
import { buildCardQueue, type QueueItem } from "@/lib/a1/deck";
import { deriveClozeCards } from "@/lib/a1/cloze";
import { currentPhase } from "@/lib/a1/phase";
import { ensureA1WordlistLoaded, ensureCurriculum } from "@/lib/a1/loader";
import { freshCardState, schedule, type Grade } from "@/lib/sr";
import { foldErrorTags } from "@/lib/errorTags";
import { logActivity, logReview } from "@/lib/studyLog";
import { cancelAllSpeech } from "@/lib/tts";
import type { JudgeErrorTag } from "@/lib/api/contracts";
import type {
  ClozePayload,
  DictationErrorPayload,
  WordCardPayload,
} from "@/lib/types";
import { WordRecognitionCard } from "./WordRecognitionCard";
import { NounProductionCard } from "./NounProductionCard";
import { ClozeCard } from "./ClozeCard";
import { DictationCard } from "./DictationCard";

export function CardSession({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("a1");
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const keySequenceRef = useRef<string[]>([]);
  const sessionLoggedRef = useRef(false);
  const cardShownAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureCurriculum(language);
        await ensureA1WordlistLoaded(language);
        // Opportunistic cloze derivation from recalled island sentences.
        const [sentences, reviews] = await Promise.all([
          listAllSentences(language),
          listAllReviews(language),
        ]);
        await deriveClozeCards(sentences, reviews, Date.now());

        const [days, cardReviews] = await Promise.all([
          listStudyDays(language),
          listCardReviews(language),
        ]);
        const curriculum = await ensureCurriculum(language);
        const phase = currentPhase(
          curriculum,
          // Introduced count approximated by all card reviews (cloze/dictation
          // rows inflate it slightly — harmless for a 300 threshold).
          { activeDays: days.length, introducedWordCards: cardReviews.length },
          Date.now(),
        );
        const result = await buildCardQueue(language, phase, Date.now());
        keySequenceRef.current = result.keySequence;
        if (!cancelled) setQueue(result.queue);
      } catch (err) {
        console.error(err);
        if (!cancelled) setQueue([]);
      }
    })();
    return () => {
      cancelled = true;
      cancelAllSpeech();
    };
  }, [language]);

  const current = queue?.[0];

  useEffect(() => {
    cardShownAtRef.current = Date.now();
  }, [current?.card.id]);

  const grade = useCallback(
    async (g: Grade, errorTags?: JudgeErrorTag[]) => {
      if (!current) return;
      const now = new Date();
      const prev =
        (await getCardReview(current.card.id)) ??
        freshCardState(current.card.id, current.card.language, now);
      await logReview({
        cardId: current.card.id,
        deck: "card",
        language: current.card.language,
        grade: g,
        prev,
      });
      const next = schedule(prev, g, now);
      const folded = foldErrorTags(prev.errorTags, errorTags, now.getTime());
      if (folded) next.errorTags = folded;
      await upsertCardReview(next);

      const remaining = queue!.length - (g === "again" ? 0 : 1);
      await logActivity({
        language,
        source: "cardSession",
        durationMs: Date.now() - cardShownAtRef.current,
        units: 1,
        srsQueueCleared: remaining === 0,
        // The last grade of the session carries the interleave key sequence
        // (P0 acceptance: 交错调度可在日志中验证).
        detail:
          remaining === 0 && !sessionLoggedRef.current
            ? JSON.stringify({ keySequence: keySequenceRef.current })
            : undefined,
      });
      if (remaining === 0) sessionLoggedRef.current = true;

      cancelAllSpeech();
      setQueue((q) => {
        if (!q) return q;
        return g === "again" ? [...q.slice(1), q[0]!] : q.slice(1);
      });
      setDoneCount((c) => c + 1);
    },
    [current, queue, language],
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
        <p className="text-2xl">{t("sessionDone")}</p>
        {doneCount > 0 && <p className="text-sm text-zinc-500">{doneCount}</p>}
        <a
          href={`/${uiLocale}/a1/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline mt-4"
        >
          ← {t("title")}
        </a>
      </main>
    );
  }

  const { card } = queue[0]!;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between gap-3">
        <a
          href={`/${uiLocale}/a1/`}
          className="text-sm text-zinc-500 hover:underline underline-offset-4 shrink-0"
        >
          ← {t("title")}
        </a>
        <span className="text-sm text-zinc-500 tabular-nums shrink-0">
          {t("remaining", { n: queue.length })}
        </span>
      </header>

      {card.kind === "word" && card.template === "recognition" && (
        <WordRecognitionCard
          key={card.id}
          payload={card.payload as WordCardPayload}
          language={language}
          onGrade={grade}
        />
      )}
      {card.kind === "word" && card.template === "production" && (
        <NounProductionCard
          key={card.id}
          payload={card.payload as WordCardPayload}
          language={language}
          onGrade={grade}
        />
      )}
      {card.kind === "cloze" && (
        <ClozeCard
          key={card.id}
          payload={card.payload as ClozePayload}
          language={language}
          onGrade={grade}
        />
      )}
      {card.kind === "dictation" && (
        <DictationCard
          key={card.id}
          payload={card.payload as DictationErrorPayload}
          language={language}
          onGrade={grade}
        />
      )}
    </main>
  );
}
