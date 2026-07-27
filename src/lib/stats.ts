// M7 仪表 — pure aggregators over StudyDay / ReviewLogEntry rows. No Dexie, no
// React: DashboardView loads rows and passes them in. Formulas are documented
// here so every number on the dashboard is reproducible by hand.

import { BUDGET_H } from "./composer";
import { addDays } from "./streak";
import type { ActivityClass, ReviewLogEntry, StudyDay } from "./types";

export const ACTIVITY_CLASSES = Object.keys(BUDGET_H) as ActivityClass[];

/** Total hours per class over the given days. */
export function hoursByClass(
  days: StudyDay[],
): Record<ActivityClass, number> {
  const out = Object.fromEntries(
    ACTIVITY_CLASSES.map((c) => [c, 0]),
  ) as Record<ActivityClass, number>;
  for (const d of days) {
    for (const c of ACTIVITY_CLASSES) {
      out[c] += (d.msByActivity[c] ?? 0) / 3_600_000;
    }
  }
  return out;
}

export interface BudgetRow {
  cls: ActivityClass;
  actualH: number;
  budgetH: number;
  /** Share of the actual total (0..1). */
  actualShare: number;
  /** Share of the 120h budget (0..1). */
  budgetShare: number;
}

/** Actual vs A1-protocol budget per class (防 Goodhart: the dashboard draws the
 *  exam class's 15% ceiling from budgetShare). */
export function budgetComparison(days: StudyDay[]): BudgetRow[] {
  const hours = hoursByClass(days);
  const totalActual = ACTIVITY_CLASSES.reduce((a, c) => a + hours[c], 0);
  const totalBudget = ACTIVITY_CLASSES.reduce((a, c) => a + BUDGET_H[c], 0);
  return ACTIVITY_CLASSES.map((cls) => ({
    cls,
    actualH: hours[cls],
    budgetH: BUDGET_H[cls],
    actualShare: totalActual > 0 ? hours[cls] / totalActual : 0,
    budgetShare: BUDGET_H[cls] / totalBudget,
  }));
}

/** 应试学时占比 (0..1) — the anti-Goodhart number (ceiling 0.15). */
export function examShare(days: StudyDay[]): number {
  const hours = hoursByClass(days);
  const total = ACTIVITY_CLASSES.reduce((a, c) => a + hours[c], 0);
  return total > 0 ? hours.exam / total : 0;
}

export const MATURE_INTERVAL_DAYS = 21;
export const RETENTION_WINDOW_DAYS = 30;

export interface RetentionReport {
  matureReviews: number;
  retained: number;
  /** Share of non-again grades among mature reviews (null = no data yet). */
  retention: number | null;
}

/** 成熟卡保留率: among reviews in the trailing window whose card came due with
 *  a scheduled interval ≥ 21 days, the share not graded "again". Comparable to
 *  the FSRS request_retention (0.90). */
export function matureRetention(
  log: ReviewLogEntry[],
  nowMs: number,
): RetentionReport {
  const since = nowMs - RETENTION_WINDOW_DAYS * 86_400_000;
  const mature = log.filter(
    (e) => e.ts >= since && e.scheduledInterval >= MATURE_INTERVAL_DAYS,
  );
  const retained = mature.filter((e) => e.grade !== "again").length;
  return {
    matureReviews: mature.length,
    retained,
    retention: mature.length > 0 ? retained / mature.length : null,
  };
}

export interface AdherenceReport {
  /** logged minutes / (dailyTarget × elapsed days), trailing 7 / 30 days. */
  executionRate7: number;
  executionRate30: number;
  /** Longest run of days with no MVD between the first record and today. */
  longestGapDays: number;
  mvdDays: number;
}

export function adherence(
  days: StudyDay[],
  dailyTargetMinutes: number,
  todayKey: string,
): AdherenceReport {
  const byKey = new Map(days.map((d) => [d.dayKey, d]));
  const minutesOf = (d: StudyDay | undefined) =>
    d
      ? ACTIVITY_CLASSES.reduce((a, c) => a + (d.msByActivity[c] ?? 0), 0) / 60_000
      : 0;

  const rate = (windowDays: number) => {
    let logged = 0;
    for (let i = 0; i < windowDays; i++) {
      logged += minutesOf(byKey.get(addDays(todayKey, -i)));
    }
    return logged / (dailyTargetMinutes * windowDays);
  };

  const keys = days.map((d) => d.dayKey).sort();
  let longestGap = 0;
  let gap = 0;
  if (keys.length > 0) {
    for (let key = keys[0]!; key <= todayKey; key = addDays(key, 1)) {
      if (byKey.get(key)?.mvd) gap = 0;
      else {
        gap += 1;
        longestGap = Math.max(longestGap, gap);
      }
    }
  }

  return {
    executionRate7: rate(7),
    executionRate30: rate(30),
    longestGapDays: longestGap,
    mvdDays: days.filter((d) => d.mvd).length,
  };
}
