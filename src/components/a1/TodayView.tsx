"use client";

// M1 "Today" surface on the German hub — 打开即练. One primary CTA (the
// composer's next action), a quiet progress bar with the 20-min MVD notch, the
// day's passive plan list, and the M2 if-then onboarding card on first run.
// All planning lives in src/lib/composer.ts (pure, unit-tested); this renders.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getStudyDay,
  listCardReviews,
  listStudyDays,
  putCurriculum,
} from "@/lib/db";
import { ensureA1WordlistLoaded, ensureCurriculum } from "@/lib/a1/loader";
import { buildCardQueue } from "@/lib/a1/deck";
import { currentPhase } from "@/lib/a1/phase";
import { buildReminderIcs } from "@/lib/a1/ics";
import {
  composeToday,
  type Action,
  type TodayPlan,
} from "@/lib/composer";
import { computeStreak, dayKeyLocal } from "@/lib/streak";
import { getA1DailyMinutes } from "@/lib/settings";
import type { ActivityClass, CurriculumState, StudyDay } from "@/lib/types";

interface TodayData {
  plan: TodayPlan;
  streakCurrent: number;
  curriculum: CurriculumState;
}

function cumMinutes(days: StudyDay[]): Partial<Record<ActivityClass, number>> {
  const out: Partial<Record<ActivityClass, number>> = {};
  for (const d of days) {
    for (const key of Object.keys(d.msByActivity) as ActivityClass[]) {
      out[key] = (out[key] ?? 0) + (d.msByActivity[key] ?? 0) / 60_000;
    }
  }
  return out;
}

export function TodayView({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("a1");
  const [data, setData] = useState<TodayData | null>(null);
  // Onboarding form state (shown when no intention is stored yet).
  const [trigger, setTrigger] = useState("");
  const [place, setPlace] = useState("");
  const [remindTime, setRemindTime] = useState("08:00");
  const [onboardDismissed, setOnboardDismissed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const curriculum = await ensureCurriculum(language);
      try {
        await ensureA1WordlistLoaded(language);
      } catch {
        // Offline before first deck load — composer still works, cards act empty.
      }
      const now = Date.now();
      const [days, cardReviews, today] = await Promise.all([
        listStudyDays(language),
        listCardReviews(language),
        getStudyDay(language, dayKeyLocal(now)),
      ]);
      const phase = currentPhase(
        curriculum,
        { activeDays: days.length, introducedWordCards: cardReviews.length },
        now,
      );
      const queue = await buildCardQueue(language, phase, now);
      const plan = composeToday({
        phase,
        dayTargetMinutes: getA1DailyMinutes(),
        cumMinutes: cumMinutes(days),
        today,
        dueCards: queue.dueCount,
        newAllowance: Math.min(queue.newAllowance, queue.queue.length),
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        hvptReady: true,
        examDrillsReady: true,
      });
      setData({
        plan,
        streakCurrent: computeStreak(days, dayKeyLocal(now)).current,
        curriculum,
      });
    } catch (err) {
      console.error(err);
    }
  }, [language]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; state settles after IO (load-effect pattern used across the app)
    void reload();
  }, [reload]);

  const saveIntention = useCallback(async () => {
    if (!data || !trigger.trim() || !place.trim()) return;
    const next: CurriculumState = {
      ...data.curriculum,
      intention: { trigger: trigger.trim(), place: place.trim(), createdAt: Date.now() },
      updatedAt: Date.now(),
    };
    await putCurriculum(next);
    setData({ ...data, curriculum: next });
  }, [data, trigger, place]);

  const downloadIcs = useCallback(() => {
    if (!data?.curriculum.intention) return;
    const { trigger: tr, place: pl } = data.curriculum.intention;
    const ics = buildReminderIcs({
      summary: t("icsSummary"),
      description: t("intentionLine", { trigger: tr, place: pl }),
      timeHHMM: remindTime,
      nowMs: Date.now(),
    });
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "echo-a1-daily.ics";
    a.click();
    URL.revokeObjectURL(url);
  }, [data, remindTime, t]);

  if (data === null) return null;

  const { plan, curriculum } = data;
  const intention = curriculum.intention;
  const showOnboarding = !intention && !onboardDismissed;

  const ACTION_HREF: Record<Action["kind"], string | null> = {
    srs_round: `/${uiLocale}/a1/cards/`,
    shadow_input: "#islands",
    output_task: `/${uiLocale}/a1/output/`,
    dictation: `/${uiLocale}/a1/diktat/`,
    exam_drill: `/${uiLocale}/einbuergerung/`,
    hvpt_round: `/${uiLocale}/a1/hvpt/`,
    realuse: null,
    buffer: `/${uiLocale}/a1/cards/`,
  };
  const ACTION_LABEL: Record<Action["kind"], string> = {
    srs_round: t("planSrs"),
    shadow_input: t("planShadow"),
    output_task: t("planOutput"),
    dictation: t("planDiktat"),
    exam_drill: t("planExam"),
    hvpt_round: t("planHvpt"),
    realuse: t("planRealuse"),
    buffer: t("planBuffer"),
  };

  const pct = Math.min(100, Math.round((plan.doneMinutes / plan.targetMinutes) * 100));
  const mvdPct = Math.min(100, Math.round((20 / plan.targetMinutes) * 100));

  return (
    <section className="space-y-4">
      {showOnboarding && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950 space-y-3">
          <p className="text-sm font-medium">{t("onboardTitle")}</p>
          <div className="flex flex-wrap items-center gap-2 text-base">
            <input
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder={t("onboardTriggerPh")}
              className="w-32 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
            />
            <span className="text-sm">{t("onboardAfter")}</span>
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder={t("onboardPlacePh")}
              className="w-32 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
            />
            <span className="text-sm">{t("onboardSuffix")}</span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveIntention()}
              disabled={!trigger.trim() || !place.trim()}
              className="px-4 py-2 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm font-medium disabled:opacity-40"
            >
              {t("onboardSave")}
            </button>
            <button
              type="button"
              onClick={() => setOnboardDismissed(true)}
              className="px-4 py-2 rounded-lg text-sm text-zinc-500"
            >
              {t("onboardSkip")}
            </button>
          </div>
        </div>
      )}

      {intention && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            {t("intentionLine", { trigger: intention.trigger, place: intention.place })}
          </span>
          <span className="flex items-center gap-1.5">
            <input
              type="time"
              value={remindTime}
              onChange={(e) => setRemindTime(e.target.value)}
              className="rounded border border-zinc-200 dark:border-zinc-800 bg-transparent px-1 text-xs"
              aria-label={t("icsTimeLabel")}
            />
            <button type="button" onClick={downloadIcs} className="underline underline-offset-2">
              {t("icsDownload")}
            </button>
          </span>
        </div>
      )}

      {/* 今天的下一个动作 — the ONE primary CTA. */}
      {plan.next ? (
        <a
          href={ACTION_HREF[plan.next.kind] ?? `/${uiLocale}/a1/`}
          className="block rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 p-6 hover:opacity-90"
        >
          <p className="text-xs opacity-70 mb-1">{t("nextActionLabel")}</p>
          <p className="text-2xl font-semibold">{ACTION_LABEL[plan.next.kind]}</p>
          <p className="text-sm opacity-70 mt-1">
            {t("estMinutes", { n: plan.next.estMinutes })}
            {plan.next.mvdPart ? ` · ${t("mvdTag")}` : ""}
          </p>
        </a>
      ) : (
        <div className="rounded-xl bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 p-6">
          <p className="text-2xl font-semibold">{t("dayDone")}</p>
        </div>
      )}

      {/* Progress toward the day target, with the MVD notch. */}
      <div>
        <div className="relative h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-zinc-900 dark:bg-zinc-100 rounded-full"
            style={{ width: `${pct}%` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-amber-500"
            style={{ left: `${mvdPct}%` }}
            title={t("mvdTag")}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-500 mt-1 tabular-nums">
          <span>
            {plan.doneMinutes}/{plan.targetMinutes} min
            {plan.mvdComplete ? ` · ${t("mvdDone")}` : ""}
          </span>
          <span>🔥 {data.streakCurrent}</span>
        </div>
      </div>

      {/* The day's passive plan — visible, zero decisions. */}
      <ul className="space-y-1">
        {plan.plan.map((a, i) => (
          <li key={a.id} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <span>{plan.done[i] ? "✅" : "⬜"}</span>
            <span className={plan.done[i] ? "line-through opacity-60" : ""}>
              {ACTION_LABEL[a.kind]}
            </span>
            <span className="text-xs text-zinc-400 tabular-nums">{a.estMinutes}′</span>
            {a.mvdPart && <span className="text-xs text-amber-600 dark:text-amber-500">{t("mvdTag")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
