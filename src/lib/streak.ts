// M2 streak — a PURE fold over StudyDay rollups. No mutable streak state exists
// anywhere: the streak can never desync, and "可见进度永不清零" holds
// structurally because the primary UI metrics are cumulative (words introduced,
// hours by class) with the streak as a secondary chip (learning-method.md §7).
//
// Rules (brief M2): a day counts iff its MVD was reached. Each calendar month
// has 2 grace days: the first two non-MVD days of a month are retroactively
// FROZEN (streak neither grows nor breaks); the third breaks it. Today, while
// unfinished, is pending — it neither breaks nor consumes grace.

import type { StudyDay } from "./types";

export const GRACE_DAYS_PER_MONTH = 2;

export interface StreakResult {
  /** Current run of MVD days ending today/yesterday (frozen days excluded). */
  current: number;
  longest: number;
  /** Grace days consumed in today's calendar month. */
  graceUsedThisMonth: number;
  frozenDayKeys: string[];
}

/** Local-date day key "YYYY-MM-DD". */
export function dayKeyLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** dayKey + n days. Arithmetic runs in UTC (keys are plain calendar labels, so
 *  UTC math can never straddle a DST jump). */
export function addDays(dayKey: string, n: number): string {
  const [y = 0, m = 1, d = 1] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x: number) => String(x).padStart(2, "0");
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
}

function monthOf(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/**
 * Chronological forward walk from the first recorded day to today. Forward
 * (not backward) because grace is consumed in calendar order — the first two
 * misses of a month freeze, later ones break — which a backward walk cannot
 * know without looking ahead.
 */
export function computeStreak(
  days: StudyDay[],
  todayKey: string,
): StreakResult {
  const mvdDays = new Set(days.filter((d) => d.mvd).map((d) => d.dayKey));
  const recordedKeys = days.map((d) => d.dayKey).sort();
  const firstKey = recordedKeys[0];

  const frozenDayKeys: string[] = [];
  let current = 0;
  let longest = 0;
  const graceByMonth = new Map<string, number>();

  if (firstKey !== undefined) {
    for (let key = firstKey; key <= todayKey; key = addDays(key, 1)) {
      if (mvdDays.has(key)) {
        current += 1;
        longest = Math.max(longest, current);
        continue;
      }
      // Today, while unfinished, is pending — neither breaks nor uses grace.
      if (key === todayKey) break;
      const month = monthOf(key);
      const used = graceByMonth.get(month) ?? 0;
      if (used < GRACE_DAYS_PER_MONTH) {
        graceByMonth.set(month, used + 1);
        frozenDayKeys.push(key);
        // Frozen: streak survives but doesn't grow.
      } else {
        current = 0;
      }
    }
  }

  return {
    current,
    longest,
    graceUsedThisMonth: graceByMonth.get(monthOf(todayKey)) ?? 0,
    frozenDayKeys,
  };
}
