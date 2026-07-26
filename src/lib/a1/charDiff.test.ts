import { describe, expect, it } from "vitest";
import {
  charAccuracy,
  classifyDictationErrors,
  diffChars,
  normalizeForDiff,
} from "./charDiff";

describe("normalizeForDiff", () => {
  it("forgives whitespace and terminal punctuation, keeps case and umlauts", () => {
    expect(normalizeForDiff("  Ich  wohne in Köln. ")).toBe("Ich wohne in Köln");
    expect(normalizeForDiff("Wie geht's?")).toBe("Wie geht's");
    expect(normalizeForDiff("Köln")).toBe("Köln"); // umlaut untouched
  });
});

describe("charAccuracy", () => {
  it("is 1 for an exact match modulo normalization", () => {
    expect(charAccuracy("Ich wohne in Köln.", "Ich wohne in Köln")).toBe(1);
  });
  it("penalizes a single wrong character proportionally", () => {
    const acc = charAccuracy("Ich wohne in Köln", "Ich wohne in Koln");
    expect(acc).toBeCloseTo(1 - 1 / "Ich wohne in Köln".length, 5);
  });
  it("is case-strict (German orthography is trained)", () => {
    expect(charAccuracy("Die Wohnung", "die wohnung")).toBeLessThan(1);
  });
  it("clamps at 0 for garbage", () => {
    expect(charAccuracy("Ja", "xxxxxxxxxxxxxxxxxxxxxx")).toBe(0);
  });
});

describe("diffChars", () => {
  it("emits same ops for identical strings", () => {
    const ops = diffChars("abc", "abc");
    expect(ops).toHaveLength(3);
    expect(ops.every((o) => o.op === "same")).toBe(true);
  });
  it("marks a substitution as one sub op", () => {
    const ops = diffChars("Haus", "Haut");
    expect(ops.filter((o) => o.op === "sub")).toHaveLength(1);
    expect(ops.filter((o) => o.op === "same")).toHaveLength(3);
  });
  it("marks missing characters as del and extra as ins", () => {
    expect(diffChars("Straße", "Strae").some((o) => o.op === "del")).toBe(true);
    expect(diffChars("Haus", "Hauss").some((o) => o.op === "ins")).toBe(true);
  });
});

describe("classifyDictationErrors", () => {
  it("tags umlaut confusion as PHONEME", () => {
    const tags = classifyDictationErrors("Ich wohne in Köln", "Ich wohne in Koln");
    expect(tags).toContainEqual({ type: "PHONEME", detail: "umlaut-ö" });
  });
  it("tags a missing word as VOCAB with the word as detail", () => {
    const tags = classifyDictationErrors("Ich wohne in Köln", "Ich wohne in");
    expect(tags).toContainEqual({ type: "VOCAB", detail: "köln" });
  });
  it("tags a wrong ending as MORPHOLOGY:ending", () => {
    const tags = classifyDictationErrors("Ich wohne hier", "Ich wohnen hier");
    expect(tags).toContainEqual({ type: "MORPHOLOGY", detail: "ending" });
  });
  it("tags case-only difference as MORPHOLOGY:capitalization", () => {
    const tags = classifyDictationErrors("Die Wohnung ist klein", "Die wohnung ist klein");
    expect(tags).toContainEqual({ type: "MORPHOLOGY", detail: "capitalization" });
  });
  it("returns nothing for a perfect answer", () => {
    expect(classifyDictationErrors("Das ist gut", "Das ist gut")).toHaveLength(0);
  });
});
