import { describe, expect, it } from "vitest";
import {
  buildHvptRound,
  contrastStatus,
  HVPT_BANK,
  isMasteredPair,
  makeHvptItem,
} from "./hvpt";
import type { HvptProgress } from "../types";

function progress(pairId: string, p: Partial<HvptProgress>): HvptProgress {
  return {
    pairId,
    attempts: 1,
    correct: 0,
    wrong: 0,
    streak: 0,
    updatedAt: 0,
    ...p,
  };
}

const contrast = HVPT_BANK.contrasts[0]!;

describe("bank shape", () => {
  it("has three contrasts with ≥12 pairs each and unique ids", () => {
    expect(HVPT_BANK.contrasts).toHaveLength(3);
    const ids = new Set<string>();
    for (const c of HVPT_BANK.contrasts) {
      expect(c.pairs.length).toBeGreaterThanOrEqual(12);
      for (const p of c.pairs) {
        expect(ids.has(p.id)).toBe(false);
        ids.add(p.id);
        expect(p.a).not.toBe(p.b); // audibly different words, never homophone-identical text
      }
    }
  });
});

describe("buildHvptRound", () => {
  it("orders unseen → wrong → rest → mastered", () => {
    const [p0, p1, p2] = contrast.pairs;
    const prog = [
      progress(p0!.id, { attempts: 5, streak: 3, correct: 5 }), // mastered
      progress(p1!.id, { attempts: 2, wrong: 1 }), // wrong pool
      progress(p2!.id, { attempts: 2, correct: 2 }), // rest
      // everything else unseen
    ];
    const round = buildHvptRound(contrast, prog, contrast.pairs.length, () => 0.4);
    const pos = (id: string) => round.findIndex((p) => p.id === id);
    const firstSeenPos = Math.min(pos(p1!.id), pos(p2!.id), pos(p0!.id));
    // All unseen pairs come before any seen pair.
    expect(firstSeenPos).toBeGreaterThanOrEqual(contrast.pairs.length - 3);
    // Wrong before rest before mastered.
    expect(pos(p1!.id)).toBeLessThan(pos(p2!.id));
    expect(pos(p2!.id)).toBeLessThan(pos(p0!.id));
  });

  it("caps the round size", () => {
    expect(buildHvptRound(contrast, [], 5, () => 0.4)).toHaveLength(5);
  });
});

describe("makeHvptItem", () => {
  it("picks word and voice from the rng deterministically", () => {
    const pair = contrast.pairs[0]!;
    const a = makeHvptItem(pair, () => 0.1);
    expect(a.spoken).toBe("a");
    const b = makeHvptItem(pair, () => 0.9);
    expect(b.spoken).toBe("b");
    expect(a.voice).not.toBe(b.voice);
  });
});

describe("mastery + status", () => {
  it("streak ≥ 3 is mastered", () => {
    expect(isMasteredPair(progress("x", { streak: 3 }))).toBe(true);
    expect(isMasteredPair(progress("x", { streak: 2 }))).toBe(false);
    expect(isMasteredPair(undefined)).toBe(false);
  });

  it("contrastStatus counts seen and mastered", () => {
    const prog = [
      progress(contrast.pairs[0]!.id, { attempts: 3, streak: 3 }),
      progress(contrast.pairs[1]!.id, { attempts: 1 }),
    ];
    const s = contrastStatus(contrast, prog);
    expect(s.total).toBe(contrast.pairs.length);
    expect(s.seen).toBe(2);
    expect(s.mastered).toBe(1);
  });
});
