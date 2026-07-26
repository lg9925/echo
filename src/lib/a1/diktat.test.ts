import { describe, expect, it } from "vitest";
import type { LadderState } from "./diktat";
import {
  advanceLadder,
  levelBand,
  pickDictationSentences,
  wordCount,
} from "./diktat";
import type { DictationAttempt, Sentence } from "../types";

const base: LadderState = { diktatLevel: 2, diktatUpStreak: 0, diktatDownStreak: 0 };

describe("advanceLadder", () => {
  it("advances after 3 consecutive passes and resets streaks", () => {
    let s = base;
    s = advanceLadder(s, 0.95);
    s = advanceLadder(s, 0.92);
    expect(s.diktatLevel).toBe(2);
    s = advanceLadder(s, 1);
    expect(s).toEqual({ diktatLevel: 3, diktatUpStreak: 0, diktatDownStreak: 0 });
  });

  it("a failure resets the up-streak", () => {
    let s = advanceLadder(advanceLadder(base, 0.95), 0.95);
    expect(s.diktatUpStreak).toBe(2);
    s = advanceLadder(s, 0.5);
    expect(s.diktatUpStreak).toBe(0);
    expect(s.diktatDownStreak).toBe(1);
    expect(s.diktatLevel).toBe(2);
  });

  it("demotes after 2 consecutive failures, floored at level 1", () => {
    let s = advanceLadder(advanceLadder(base, 0.5), 0.5);
    expect(s).toEqual({ diktatLevel: 1, diktatUpStreak: 0, diktatDownStreak: 0 });
    s = advanceLadder(advanceLadder(s, 0.1), 0.1);
    expect(s.diktatLevel).toBe(1); // floor
  });

  it("caps at level 5", () => {
    let s: LadderState = { diktatLevel: 5, diktatUpStreak: 2, diktatDownStreak: 0 };
    s = advanceLadder(s, 0.99);
    expect(s.diktatLevel).toBe(5);
  });

  it("exactly 0.90 counts as a pass", () => {
    expect(advanceLadder(base, 0.9).diktatUpStreak).toBe(1);
  });
});

describe("levelBand / wordCount", () => {
  it("bands match the plan", () => {
    expect(levelBand(1)).toEqual([3, 4]);
    expect(levelBand(3)).toEqual([7, 9]);
    expect(levelBand(5)).toEqual([13, Infinity]);
  });
  it("counts words", () => {
    expect(wordCount("Ich wohne in Köln")).toBe(4);
    expect(wordCount("  Hallo  ")).toBe(1);
  });
});

function sentence(id: string, target: string): Sentence {
  return {
    id,
    islandId: "de.1",
    language: "de",
    islandOrder: 1,
    indexInIsland: 0,
    native: "",
    target,
    ipa: null,
    frame: "",
    literal: "",
    note: "",
    variants: [],
    audio: null,
  };
}

function attempt(text: string, createdAt: number): DictationAttempt {
  return {
    id: String(createdAt),
    language: "de",
    mode: "sentence",
    text,
    typed: "",
    accuracy: 1,
    level: 1,
    createdAt,
  };
}

describe("pickDictationSentences", () => {
  const pool = [
    sentence("a", "Ich wohne hier"), // 3 words → L1
    sentence("b", "Ich wohne in Köln"), // 4 words → L1
    sentence("c", "Ich möchte einen Kaffee bitte haben"), // 6 words → L2
  ];

  it("filters by the level's word-count band", () => {
    const picked = pickDictationSentences(pool, [], 1, 10);
    expect(picked.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("prefers never-dictated, then least recently dictated", () => {
    const picked = pickDictationSentences(
      pool,
      [attempt("Ich wohne hier", 100)],
      1,
      2,
    );
    expect(picked[0]!.id).toBe("b"); // never dictated wins
    expect(picked[1]!.id).toBe("a");
  });

  it("intersects with the offline audio cache when provided", () => {
    const picked = pickDictationSentences(
      pool,
      [],
      1,
      10,
      new Set(["Ich wohne hier"]),
    );
    expect(picked.map((s) => s.id)).toEqual(["a"]);
  });
});
