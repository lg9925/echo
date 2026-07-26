import { describe, expect, it } from "vitest";
import { addDays, computeStreak, dayKeyLocal } from "./streak";
import type { StudyDay } from "./types";

function day(dayKey: string, mvd: boolean): StudyDay {
  return {
    id: `de|${dayKey}`,
    language: "de",
    dayKey,
    msByActivity: {},
    srsCardsGraded: mvd ? 10 : 0,
    srsQueueCleared: mvd,
    inputUnits: mvd ? 1 : 0,
    outputUnits: mvd ? 1 : 0,
    mvd,
    updatedAt: 0,
  };
}

/** n consecutive MVD days ending the day before `endExclusive`. */
function run(endExclusive: string, n: number): StudyDay[] {
  const out: StudyDay[] = [];
  for (let i = n; i >= 1; i--) out.push(day(addDays(endExclusive, -i), true));
  return out;
}

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("dayKeyLocal", () => {
  it("formats a local date", () => {
    expect(dayKeyLocal(new Date(2026, 6, 26, 12).getTime())).toBe("2026-07-26");
  });
});

describe("computeStreak", () => {
  const today = "2026-07-26";

  it("counts a simple run including today", () => {
    const days = [...run(today, 3), day(today, true)];
    expect(computeStreak(days, today).current).toBe(4);
  });

  it("today unfinished is pending — neither breaks nor uses grace", () => {
    const days = run(today, 3);
    const r = computeStreak(days, today);
    expect(r.current).toBe(3);
    expect(r.graceUsedThisMonth).toBe(0);
  });

  it("a single missed day is frozen by grace and the streak survives", () => {
    // 22,23 mvd · 24 missed · 25 mvd · today mvd
    const days = [
      day("2026-07-22", true),
      day("2026-07-23", true),
      day("2026-07-25", true),
      day(today, true),
    ];
    const r = computeStreak(days, today);
    expect(r.current).toBe(4); // frozen day doesn't grow but doesn't reset
    expect(r.graceUsedThisMonth).toBe(1);
    expect(r.frozenDayKeys).toEqual(["2026-07-24"]);
  });

  it("the third miss in a month breaks the streak", () => {
    // 20 mvd · 21,22,23 missed · 24,25,today mvd
    const days = [
      day("2026-07-20", true),
      day("2026-07-24", true),
      day("2026-07-25", true),
      day(today, true),
    ];
    const r = computeStreak(days, today);
    expect(r.current).toBe(3); // broken on the 23rd, rebuilt 24→today
    expect(r.graceUsedThisMonth).toBe(2);
  });

  it("grace resets at the month boundary", () => {
    // June: 2 misses frozen. July: 1 miss — frozen again (new budget).
    const days = [
      day("2026-06-27", true),
      // 06-28, 06-29 missed (freeze 2)
      day("2026-06-30", true),
      day("2026-07-01", true),
      // 07-02 missed (freeze, new month budget)
      day("2026-07-03", true),
      day(today, true), // gap 07-04..07-25 would break; keep range tight instead
    ];
    // Restrict to a contiguous window: recompute with today = 07-04.
    const r = computeStreak(days.slice(0, 5), "2026-07-04");
    expect(r.current).toBe(4);
    expect(r.graceUsedThisMonth).toBe(1);
  });

  it("longest never decreases when the current streak breaks", () => {
    const days = [
      ...run("2026-07-10", 6), // 6-day run 07-04..07-09
      // long gap breaks
      day("2026-07-24", true),
      day("2026-07-25", true),
    ];
    const r = computeStreak(days, today);
    expect(r.longest).toBe(6);
    expect(r.longest).toBeGreaterThanOrEqual(r.current);
  });

  it("no records at all → zeros", () => {
    expect(computeStreak([], today)).toEqual({
      current: 0,
      longest: 0,
      graceUsedThisMonth: 0,
      frozenDayKeys: [],
    });
  });
});
