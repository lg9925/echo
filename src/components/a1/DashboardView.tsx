"use client";

// M7 仪表: seven-class hours vs the A1 protocol budget (with the 15% 应试
// ceiling drawn in — 防 Goodhart made visible), mature-card retention from the
// append-only reviewLog, adherence tiles, and the 3 mock-exam checkpoints.
// All numbers come from pure aggregators in src/lib/stats.ts — reproducible.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  addCheckpoint,
  listCheckpoints,
  listReviewLog,
  listStudyDays,
} from "@/lib/db";
import {
  adherence,
  budgetComparison,
  examShare,
  matureRetention,
  type AdherenceReport,
  type BudgetRow,
  type RetentionReport,
} from "@/lib/stats";
import { dayKeyLocal } from "@/lib/streak";
import { getA1DailyMinutes } from "@/lib/settings";
import { logActivity } from "@/lib/studyLog";
import type { ActivityClass, CheckpointRecord } from "@/lib/types";

const CLASS_LABEL_KEY: Record<ActivityClass, string> = {
  input: "clsInput",
  srs: "clsSrs",
  output: "clsOutput",
  exam: "clsExam",
  hvpt: "clsHvpt",
  realuse: "clsRealuse",
  buffer: "clsBuffer",
};

const SECTIONS = ["hoeren", "lesen", "schreiben", "sprechen"] as const;

interface DashData {
  budget: BudgetRow[];
  examSharePct: number;
  retention: RetentionReport;
  adherence: AdherenceReport;
  checkpoints: CheckpointRecord[];
}

export function DashboardView({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("a1");
  const [data, setData] = useState<DashData | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const now = Date.now();
      const [days, log, checkpoints] = await Promise.all([
        listStudyDays(language),
        listReviewLog(language),
        listCheckpoints(language),
      ]);
      setData({
        budget: budgetComparison(days),
        examSharePct: Math.round(examShare(days) * 100),
        retention: matureRetention(log, now),
        adherence: adherence(days, getA1DailyMinutes(), dayKeyLocal(now)),
        checkpoints: checkpoints.sort((a, b) => a.takenAt - b.takenAt),
      });
    } catch (err) {
      console.error(err);
    }
  }, [language]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load; state settles after IO (load-effect pattern used across the app)
    void reload();
  }, [reload]);

  const saveCheckpoint = useCallback(async () => {
    const parsed = SECTIONS.map((s) => parseInt(scores[s] ?? "", 10));
    if (parsed.some((n) => !Number.isFinite(n) || n < 0 || n > 25)) return;
    setSaving(true);
    try {
      const now = Date.now();
      await addCheckpoint({
        id: `${language}-cp-${now}`,
        language,
        kind: "mock-exam",
        takenAt: now,
        scores: {
          hoeren: parsed[0]!,
          lesen: parsed[1]!,
          schreiben: parsed[2]!,
          sprechen: parsed[3]!,
        },
        total: parsed.reduce((a, b) => a + b, 0),
      });
      // A mock exam is exam-class study time (~65 min for the A1 digital).
      await logActivity({ language, source: "checkpoint", durationMs: 65 * 60_000, units: 1 });
      setScores({});
      await reload();
    } finally {
      setSaving(false);
    }
  }, [language, scores, reload]);

  if (data === null) {
    return (
      <main className="p-6">
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      </main>
    );
  }

  const maxShare = Math.max(
    ...data.budget.map((r) => Math.max(r.actualShare, r.budgetShare)),
    0.01,
  );
  const canSave = SECTIONS.every((s) => {
    const n = parseInt(scores[s] ?? "", 10);
    return Number.isFinite(n) && n >= 0 && n <= 25;
  });

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header>
        <a
          href={`/${uiLocale}/a1/`}
          className="text-sm text-zinc-500 hover:underline underline-offset-4"
        >
          ← {t("title")}
        </a>
      </header>
      <h1 className="text-xl font-semibold">{t("statsTitle")}</h1>

      {/* Seven-class hours vs budget. */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950 space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium">{t("statsBudgetTitle")}</p>
          <p
            className={`text-xs tabular-nums ${
              data.examSharePct > 15
                ? "text-red-600 dark:text-red-400 font-semibold"
                : "text-zinc-500"
            }`}
          >
            {t("statsExamShare", { pct: data.examSharePct })}
          </p>
        </div>
        <div className="space-y-2">
          {data.budget.map((row) => (
            <div key={row.cls} className="text-xs">
              <div className="flex justify-between text-zinc-500 mb-0.5">
                <span>{t(CLASS_LABEL_KEY[row.cls])}</span>
                <span className="tabular-nums">
                  {row.actualH.toFixed(1)}h / {row.budgetH}h
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-zinc-100 dark:bg-zinc-900 overflow-hidden">
                <div
                  className="absolute inset-y-0 left-0 bg-zinc-900 dark:bg-zinc-100 rounded-full"
                  style={{ width: `${(row.actualShare / maxShare) * 100}%` }}
                />
                {/* Budget marker; the exam class's marker IS the 15% ceiling. */}
                <div
                  className={`absolute inset-y-0 w-0.5 ${
                    row.cls === "exam" ? "bg-red-500" : "bg-amber-500"
                  }`}
                  style={{ left: `${(row.budgetShare / maxShare) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Retention + adherence tiles (quiet, below the hours). */}
      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
          <p className="text-2xl font-semibold tabular-nums">
            {data.retention.retention === null
              ? "—"
              : `${Math.round(data.retention.retention * 100)}%`}
          </p>
          <p className="text-xs text-zinc-500">
            {t("statsRetention", { n: data.retention.matureReviews })}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
          <p className="text-2xl font-semibold tabular-nums">
            {Math.round(data.adherence.executionRate7 * 100)}%
          </p>
          <p className="text-xs text-zinc-500">{t("statsExecution7")}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
          <p className="text-2xl font-semibold tabular-nums">{data.adherence.mvdDays}</p>
          <p className="text-xs text-zinc-500">{t("statsMvdDays")}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950">
          <p className="text-2xl font-semibold tabular-nums">
            {data.adherence.longestGapDays}
          </p>
          <p className="text-xs text-zinc-500">{t("statsLongestGap")}</p>
        </div>
      </section>

      {/* Checkpoints: past mocks + entry form. */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950 space-y-4">
        <p className="text-sm font-medium">{t("statsCheckpointTitle")}</p>

        {data.checkpoints.length > 0 && (
          <div className="space-y-2">
            {data.checkpoints.map((cp) => (
              <div key={cp.id} className="text-sm flex items-center justify-between">
                <span className="text-zinc-500">
                  {new Date(cp.takenAt).toLocaleDateString()}
                </span>
                <span className="tabular-nums">
                  {SECTIONS.map((s) => cp.scores[s]).join(" · ")}
                </span>
                <span
                  className={`font-semibold tabular-nums ${
                    cp.total >= 75
                      ? "text-green-600 dark:text-green-400"
                      : cp.total >= 60
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {cp.total}/100
                </span>
              </div>
            ))}
            <p className="text-xs text-zinc-400">{t("statsCheckpointLines")}</p>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          {SECTIONS.map((s) => (
            <label key={s} className="text-xs text-zinc-500">
              {t(`section_${s}`)}
              <input
                type="number"
                min={0}
                max={25}
                value={scores[s] ?? ""}
                onChange={(e) => setScores((prev) => ({ ...prev, [s]: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void saveCheckpoint()}
          disabled={!canSave || saving}
          className="w-full py-2.5 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm font-medium disabled:opacity-40"
        >
          {t("statsCheckpointSave")}
        </button>
      </section>
    </main>
  );
}
