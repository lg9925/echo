import { describe, expect, it } from "vitest";
import {
  assertLexemeValid,
  expandLexeme,
  lemmaSlug,
  type RawLexeme,
} from "./loader";
import type { WordCardPayload } from "../types";

const noun: RawLexeme = {
  lemma: "Wohnung",
  pos: "noun",
  article: "die",
  plural: "Wohnungen",
  zh: "住宅；公寓",
  example: "Die Wohnung ist klein.",
  example_zh: "这套公寓很小。",
  topics: ["wohnen"],
};

describe("lemmaSlug", () => {
  it("transliterates umlauts and strips non-alphanumerics", () => {
    expect(lemmaSlug("Wohnung")).toBe("wohnung");
    expect(lemmaSlug("Bäckerei")).toBe("baeckerei");
    expect(lemmaSlug("Straße")).toBe("strasse");
    expect(lemmaSlug("sich freuen")).toBe("sich-freuen");
  });
});

describe("assertLexemeValid — the noun invariant (P0 acceptance)", () => {
  it("throws, naming the lemma, when a noun has no article", () => {
    expect(() =>
      assertLexemeValid({ ...noun, article: undefined }),
    ).toThrowError(/Wohnung.*article/);
  });
  it("throws when a noun lacks the plural key entirely", () => {
    const rest: Partial<RawLexeme> = { ...noun };
    delete rest.plural;
    expect(() => assertLexemeValid(rest as RawLexeme)).toThrowError(
      /Wohnung.*plural/,
    );
  });
  it("accepts plural: null (pluralless nouns like die Milch)", () => {
    expect(() =>
      assertLexemeValid({ ...noun, lemma: "Milch", plural: null }),
    ).not.toThrow();
  });
  it("ignores the invariant for non-nouns", () => {
    expect(() =>
      assertLexemeValid({ ...noun, pos: "verb", article: undefined }),
    ).not.toThrow();
  });
});

describe("expandLexeme", () => {
  it("a noun expands to recognition + production with the right tags", () => {
    const cards = expandLexeme(noun, "de", 1000, 3);
    expect(cards).toHaveLength(2);
    const [rec, prod] = cards;
    expect(rec!.id).toBe("de.a1.w.wohnung-noun.recognition");
    expect(rec!.tags).toEqual(["vocab", "topic:wohnen"]);
    expect(prod!.id).toBe("de.a1.w.wohnung-noun.production");
    expect(prod!.tags).toEqual(["gender", "noun", "topic:wohnen"]);
    expect((prod!.payload as WordCardPayload).article).toBe("die");
    expect((prod!.payload as WordCardPayload).plural).toBe("Wohnungen");
    expect(rec!.createdAt).toBe(1003); // base + index → seed order preserved
  });

  it("a non-noun expands to recognition only", () => {
    const cards = expandLexeme(
      { ...noun, lemma: "wohnen", pos: "verb", article: undefined },
      "de",
      0,
      0,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.template).toBe("recognition");
  });

  it("homographs with different pos get distinct ids", () => {
    const a = expandLexeme(
      { ...noun, lemma: "essen", pos: "verb", article: undefined },
      "de",
      0,
      0,
    )[0]!;
    const b = expandLexeme(
      { ...noun, lemma: "Essen", pos: "noun", article: "das", plural: null },
      "de",
      0,
      0,
    )[0]!;
    expect(a.id).not.toBe(b.id);
  });
});
