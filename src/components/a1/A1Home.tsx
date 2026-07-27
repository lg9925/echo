"use client";

// A1 course home — 零配置直达「今天的下一个动作」(P0 acceptance). One primary
// CTA from the fixed-priority heuristic (src/lib/a1/nextAction.ts — replaced
// wholesale by the P1 composer), cumulative-ability numbers as the PRIMARY
// progress metrics, streak as a secondary chip (learning-method.md §7).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { listCardReviews, listStudyDays, getStudyDay } from "@/lib/db";
import { ensureA1WordlistLoaded, ensureCurriculum } from "@/lib/a1/loader";
import { buildCardQueue } from "@/lib/a1/deck";
import { currentPhase } from "@/lib/a1/phase";
import { nextAction, type NextActionKind } from "@/lib/a1/nextAction";
import { computeStreak, dayKeyLocal, type StreakResult } from "@/lib/streak";
import type { ActivityClass, StudyDay } from "@/lib/types";

interface HomeData {
  action: NextActionKind;
  dueCount: number;
  newAllowance: number;
  introducedCards: number;
  totalHours: number;
  streak: StreakResult;
  today: StudyDay | undefined;
  loadError: boolean;
}

function sumHours(days: StudyDay[]): number {
  let ms = 0;
  for (const d of days) {
    for (const key of Object.keys(d.msByActivity) as ActivityClass[]) {
      ms += d.msByActivity[key] ?? 0;
    }
  }
  return ms / 3_600_000;
}

export function A1Home({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("a1");
  const [data, setData] = useState<HomeData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loadError = false;
      try {
        await ensureCurriculum(language);
        await ensureA1WordlistLoaded(language);
      } catch (err) {
        // Offline before the first load — the deck isn't there yet.
        console.error(err);
        loadError = true;
      }
      try {
        const now = Date.now();
        const [days, cardReviews, today] = await Promise.all([
          listStudyDays(language),
          listCardReviews(language),
          getStudyDay(language, dayKeyLocal(now)),
        ]);
        const curriculum = await ensureCurriculum(language);
        const phase = currentPhase(
          curriculum,
          { activeDays: days.length, introducedWordCards: cardReviews.length },
          now,
        );
        const queue = await buildCardQueue(language, phase, now);
        if (cancelled) return;
        setData({
          action: nextAction({
            dueCardCount: queue.dueCount,
            newAllowance: Math.min(queue.newAllowance, queue.queue.length),
            day: today,
          }),
          dueCount: queue.dueCount,
          newAllowance: queue.newAllowance,
          introducedCards: cardReviews.length,
          totalHours: sumHours(days),
          streak: computeStreak(days, dayKeyLocal(now)),
          today,
          loadError,
        });
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setData({
            action: "cards",
            dueCount: 0,
            newAllowance: 0,
            introducedCards: 0,
            totalHours: 0,
            streak: { current: 0, longest: 0, graceUsedThisMonth: 0, frozenDayKeys: [] },
            today: undefined,
            loadError: true,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  if (data === null) {
    return (
      <main className="p-6">
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      </main>
    );
  }

  const ACTION_TARGET: Record<NextActionKind, { href: string; label: string; desc: string }> = {
    cards: {
      href: `/${uiLocale}/a1/cards/`,
      label: t("actionCards", { n: data.dueCount + Math.min(data.newAllowance, 99) }),
      desc: t("actionCardsDesc"),
    },
    shadow: {
      href: `/${uiLocale}/${language}/`,
      label: t("actionShadow"),
      desc: t("actionShadowDesc"),
    },
    output: {
      href: `/${uiLocale}/a1/output/`,
      label: t("actionOutput"),
      desc: t("actionOutputDesc"),
    },
    diktat: {
      href: `/${uiLocale}/a1/diktat/`,
      label: t("actionDiktat"),
      desc: t("actionDiktatDesc"),
    },
    done: {
      href: `/${uiLocale}/a1/diktat/`,
      label: t("actionDone"),
      desc: t("actionDoneDesc"),
    },
  };
  const action = ACTION_TARGET[data.action];

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between gap-3">
        <a
          href={`/${uiLocale}/${language}/`}
          className="text-sm text-zinc-500 hover:underline underline-offset-4"
        >
          ← {t("backToHub")}
        </a>
        {/* Streak: a quiet secondary chip, never the hero metric. */}
        <span className="text-sm text-zinc-500 tabular-nums">
          🔥 {data.streak.current}
          {data.streak.graceUsedThisMonth > 0 &&
            ` · ${t("graceUsed", { n: data.streak.graceUsedThisMonth })}`}
        </span>
      </header>

      <h1 className="text-xl font-semibold">{t("title")}</h1>

      {data.loadError && (
        <p className="rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 text-sm px-4 py-3">
          {t("deckLoadError")}
        </p>
      )}

      {/* 今天的下一个动作 — the ONE primary CTA. */}
      <a
        href={action.href}
        className="block rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 p-6 hover:opacity-90"
      >
        <p className="text-xs opacity-70 mb-1">{t("nextActionLabel")}</p>
        <p className="text-2xl font-semibold">{action.label}</p>
        <p className="text-sm opacity-70 mt-1">{action.desc}</p>
      </a>

      {/* MVD checklist for today. */}
      {data.today && (
        <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <span>{data.today.srsQueueCleared || data.today.srsCardsGraded >= 5 ? "✅" : "⬜"} {t("mvdSrs")}</span>
          <span>{data.today.inputUnits >= 1 ? "✅" : "⬜"} {t("mvdInput")}</span>
          <span>{data.today.outputUnits >= 1 ? "✅" : "⬜"} {t("mvdOutput")}</span>
        </div>
      )}

      {/* Cumulative ability — the primary progress metrics (永不清零). */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
          <p className="text-2xl font-semibold tabular-nums">{data.introducedCards}</p>
          <p className="text-xs text-zinc-500">{t("statCardsIntroduced")}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
          <p className="text-2xl font-semibold tabular-nums">
            {data.totalHours < 10
              ? data.totalHours.toFixed(1)
              : Math.round(data.totalHours)}
          </p>
          <p className="text-xs text-zinc-500">{t("statHours")}</p>
        </div>
      </section>

      {/* Secondary entries — always reachable, never required. */}
      <section className="flex flex-wrap gap-2">
        <a
          href={`/${uiLocale}/a1/cards/`}
          className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm"
        >
          {t("entryCards")}
        </a>
        <a
          href={`/${uiLocale}/a1/diktat/`}
          className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm"
        >
          {t("entryDiktat")}
        </a>
        <a
          href={`/${uiLocale}/a1/output/`}
          className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm"
        >
          {t("entryOutput")}
        </a>
        <a
          href={`/${uiLocale}/a1/hvpt/`}
          className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm"
        >
          {t("entryHvpt")}
        </a>
        <a
          href={`/${uiLocale}/a1/speaking/`}
          className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm"
        >
          {t("entrySpeaking")}
        </a>
        <a
          href={`/${uiLocale}/a1/stats/`}
          className="px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm"
        >
          {t("entryStats")}
        </a>
      </section>
    </main>
  );
}
