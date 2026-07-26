import { describe, expect, it } from "vitest";
import {
  adherence,
  budgetComparison,
  examShare,
  hoursByClass,
  matureRetention,
} from "./stats";
import type { ReviewLogEntry, StudyDay } from "./types";

function day(dayKey: string, msByActivity: StudyDay["msByActivity"], mvd = false): StudyDay {
  return {
    id: `de|${dayKey}`,
    language: "de",
    dayKey,
    msByActivity,
    srsCardsGraded: 0,
    srsQueueCleared: false,
    inputUnits: 0,
    outputUnits: 0,
    mvd,
    updatedAt: 0,
  };
}

function entry(daysAgo: number, interval: number, grade: ReviewLogEntry["grade"]): ReviewLogEntry {
  const now = Date.parse("2026-07-27T12:00:00Z");
  return {
    id: `${daysAgo}-${interval}-${grade}`,
    cardId: "x",
    deck: "card",
    language: "de",
    ts: now - daysAgo * 86_400_000,
    grade,
    scheduledInterval: interval,
    elapsedDays: interval,
  };
}

const NOW = Date.parse("2026-07-27T12:00:00Z");

describe("hoursByClass / budgetComparison / examShare", () => {
  const days = [
    day("2026-07-25", { srs: 3_600_000, input: 7_200_000 }),
    day("2026-07-26", { exam: 1_800_000 }),
  ];

  it("sums hours per class", () => {
    const h = hoursByClass(days);
    expect(h.srs).toBe(1);
    expect(h.input).toBe(2);
    expect(h.exam).toBe(0.5);
  });

  it("actual shares sum to 1 and budget shares mirror the protocol", () => {
    const rows = budgetComparison(days);
    const actualSum = rows.reduce((a, r) => a + r.actualShare, 0);
    expect(actualSum).toBeCloseTo(1, 5);
    const exam = rows.find((r) => r.cls === "exam")!;
    expect(exam.budgetShare).toBeCloseTo(12 / 120, 5);
  });

  it("examShare is the anti-Goodhart number", () => {
    expect(examShare(days)).toBeCloseTo(0.5 / 3.5, 5);
  });
});

describe("matureRetention", () => {
  it("counts only in-window mature reviews and non-again grades", () => {
    const log = [
      entry(5, 30, "good"), // mature, retained
      entry(10, 25, "again"), // mature, lapsed
      entry(3, 5, "again"), // young — excluded
      entry(40, 60, "again"), // out of window — excluded
    ];
    const r = matureRetention(log, NOW);
    expect(r.matureReviews).toBe(2);
    expect(r.retained).toBe(1);
    expect(r.retention).toBe(0.5);
  });

  it("no data → retention null (never fake a number)", () => {
    expect(matureRetention([], NOW).retention).toBeNull();
  });
});

describe("adherence", () => {
  it("execution rate = logged / target over the trailing window", () => {
    // 60 min yesterday, 60 min today, target 120 → 7-day rate = 120/(120*7).
    const days = [
      day("2026-07-26", { srs: 3_600_000 }, true),
      day("2026-07-27", { input: 3_600_000 }, true),
    ];
    const r = adherence(days, 120, "2026-07-27");
    expect(r.executionRate7).toBeCloseTo(120 / (120 * 7), 5);
    expect(r.mvdDays).toBe(2);
  });

  it("longest gap counts consecutive non-MVD days", () => {
    const days = [
      day("2026-07-20", {}, true),
      // 21, 22, 23 missing entirely
      day("2026-07-24", {}, true),
      day("2026-07-25", {}, false), // recorded but not MVD
      day("2026-07-26", {}, true),
    ];
    const r = adherence(days, 120, "2026-07-27");
    // Gap runs: 21–23 (3), 25 (1), 27-today-not-mvd (1) → longest 3.
    expect(r.longestGapDays).toBe(3);
  });
});
