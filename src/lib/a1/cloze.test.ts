import { describe, expect, it } from "vitest";
import { clozeDisplay, clozeMatches, pickClozeToken } from "./cloze";

describe("pickClozeToken", () => {
  it("prefers the verb-second position in a main clause", () => {
    const t = pickClozeToken("Ich wohne in Köln");
    expect(t).toEqual({ text: "wohne", index: 1 });
  });
  it("falls back to a capitalized non-initial noun", () => {
    // V2 token is capitalized (not a finite-verb shape) → pick the noun.
    const t = pickClozeToken("Herr Müller kommt heute");
    expect(t?.text).toBe("Müller");
  });
  it("returns null for sentences too short to blank", () => {
    expect(pickClozeToken("Guten Morgen")).toBeNull();
  });
  it("is deterministic", () => {
    const a = pickClozeToken("Wir gehen morgen ins Kino");
    const b = pickClozeToken("Wir gehen morgen ins Kino");
    expect(a).toEqual(b);
  });
});

describe("clozeDisplay", () => {
  it("blanks exactly the chosen token, preserving punctuation", () => {
    expect(clozeDisplay("Ich wohne in Köln.", 1)).toBe("Ich _____ in Köln.");
  });
  it("pads short tokens to a minimum blank width", () => {
    expect(clozeDisplay("Wir sind da", 1)).toBe("Wir ____ da");
  });
});

describe("clozeMatches", () => {
  it("is whitespace-tolerant but case- and umlaut-strict", () => {
    expect(clozeMatches("wohne", " wohne ")).toBe(true);
    expect(clozeMatches("wohne", "Wohne")).toBe(false);
    expect(clozeMatches("Köln", "Koln")).toBe(false);
  });
});
