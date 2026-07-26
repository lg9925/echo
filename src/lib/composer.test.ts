import { describe, expect, it } from "vitest";
import {
  composeToday,
  MVD_MINUTES,
  type ComposerInput,
} from "./composer";
import type { StudyDay } from "./types";

function input(overrides: Partial<ComposerInput> = {}): ComposerInput {
  return {
    phase: "main-build",
    dayTargetMinutes: 120,
    cumMinutes: {},
    today: undefined,
    dueCards: 20,
    newAllowance: 15,
    online: true,
    hvptReady: false,
    examDrillsReady: false,
    ...overrides,
  };
}

function day(partial: Partial<StudyDay>): StudyDay {
  return {
    id: "de|2026-07-26",
    language: "de",
    dayKey: "2026-07-26",
    msByActivity: {},
    srsCardsGraded: 0,
    srsQueueCleared: false,
    inputUnits: 0,
    outputUnits: 0,
    mvd: false,
    updatedAt: 0,
    ...partial,
  };
}

describe("composeToday", () => {
  it("head is fixed pedagogical order: SRS → input → output, all MVD parts", () => {
    const plan = composeToday(input()).plan;
    expect(plan.slice(0, 3).map((a) => a.kind)).toEqual([
      "srs_round",
      "shadow_input",
      "output_task",
    ]);
    expect(plan.slice(0, 3).every((a) => a.mvdPart)).toBe(true);
  });

  it("MVD path is ≤3 actions and ≈20 minutes even with a tiny day target", () => {
    const { plan } = composeToday(input({ dayTargetMinutes: MVD_MINUTES, dueCards: 5, newAllowance: 0 }));
    const mvd = plan.filter((a) => a.mvdPart);
    expect(mvd.length).toBeLessThanOrEqual(3);
    const est = mvd.reduce((a, x) => a + x.estMinutes, 0);
    expect(est).toBeLessThanOrEqual(35); // 5' srs + 15' input + 10' output
  });

  it("fills to the day target; no class repeats back-to-back except the buffer tail", () => {
    const { plan } = composeToday(input({ hvptReady: true }));
    const total = plan.reduce((a, x) => a + x.estMinutes, 0);
    expect(total).toBeGreaterThanOrEqual(120);
    for (let i = 4; i < plan.length; i++) {
      if (plan[i]!.kind === "buffer" && plan[i - 1]!.kind === "buffer") continue;
      expect(plan[i]!.cls).not.toBe(plan[i - 1]!.cls);
    }
    // Per-kind caps keep the fill varied: at most 2 dictation chunks.
    expect(plan.filter((a) => a.kind === "dictation").length).toBeLessThanOrEqual(2);
  });

  it("phase gates: exam chunks only in exam-prep, hvpt not in cold-start", () => {
    const build = composeToday(input({ examDrillsReady: true, hvptReady: true }));
    expect(build.plan.some((a) => a.kind === "exam_drill")).toBe(false);

    const prep = composeToday(
      input({ phase: "exam-prep", examDrillsReady: true, hvptReady: true }),
    );
    expect(prep.plan.some((a) => a.kind === "exam_drill")).toBe(true);

    const cold = composeToday(input({ phase: "cold-start", hvptReady: true }));
    expect(cold.plan.some((a) => a.kind === "hvpt_round")).toBe(false);
  });

  it("deficit weighting: a class far behind budget gets filled first", () => {
    // Lots of accumulated SRS/output time, zero input → the first fill chunk
    // should be input-class (dictation).
    const { plan } = composeToday(
      input({
        cumMinutes: { srs: 600, output: 500, input: 0 },
      }),
    );
    expect(plan[3]!.kind).toBe("dictation");
  });

  it("next = first unfinished; completed head items are detected from the rollup", () => {
    const today = day({ srsQueueCleared: true, srsCardsGraded: 8 });
    const { next, done } = composeToday(input({ today }));
    expect(done[0]).toBe(true); // srs_round done
    expect(next?.kind).toBe("shadow_input");
  });

  it("a fully finished MVD reports mvdComplete", () => {
    const today = day({
      srsQueueCleared: true,
      srsCardsGraded: 8,
      inputUnits: 3,
      outputUnits: 1,
      mvd: true,
    });
    const r = composeToday(input({ today }));
    expect(r.mvdComplete).toBe(true);
  });

  it("day target is floored at the MVD", () => {
    const r = composeToday(input({ dayTargetMinutes: 5 }));
    expect(r.targetMinutes).toBe(MVD_MINUTES);
  });
});
