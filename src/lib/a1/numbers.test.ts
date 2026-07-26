import { describe, expect, it } from "vitest";
import {
  generatePhone,
  generatePrice,
  generateTime,
  germanNumber,
  matchesNumber,
} from "./numbers";

// Deterministic rng from a fixed sequence.
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("germanNumber", () => {
  it("handles units, teens and inverted tens", () => {
    expect(germanNumber(0)).toBe("null");
    expect(germanNumber(1)).toBe("eins");
    expect(germanNumber(1, false)).toBe("ein");
    expect(germanNumber(12)).toBe("zwölf");
    expect(germanNumber(16)).toBe("sechzehn");
    expect(germanNumber(17)).toBe("siebzehn");
    expect(germanNumber(21)).toBe("einundzwanzig");
    expect(germanNumber(30)).toBe("dreißig");
    expect(germanNumber(55)).toBe("fünfundfünfzig");
    expect(germanNumber(99)).toBe("neunundneunzig");
  });
});

describe("generators", () => {
  it("phone: canonical is all digits and spoken covers each digit", () => {
    const item = generatePhone(seqRng([0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6]));
    expect(item.canonical).toMatch(/^\d{11}$/);
    expect(item.spoken.split(", ")).toHaveLength(11);
  });
  it("price: whole euros say Euro without cents", () => {
    // euros = 3 (rng 0.03 * 100 → 3), cents index 0 → 0
    const item = generatePrice(seqRng([0.03, 0]));
    expect(item.canonical).toBe("3,00");
    expect(item.spoken).toBe("drei Euro");
  });
  it("time: minute 0 speaks bare Uhr", () => {
    const item = generateTime(seqRng([0.5, 0])); // hour 12, minute idx 0
    expect(item.spoken).toBe("zwölf Uhr");
    expect(item.canonical).toBe("12:00");
  });
});

describe("matchesNumber", () => {
  it("phone tolerates spacing and dashes", () => {
    expect(matchesNumber("phone", "01764823910", "0176 482 3910")).toBe(true);
    expect(matchesNumber("phone", "01764823910", "0176-4823910")).toBe(true);
    expect(matchesNumber("phone", "01764823910", "01764823911")).toBe(false);
  });
  it("price tolerates dot/comma, missing cents and €", () => {
    expect(matchesNumber("price", "3,50", "3.50")).toBe(true);
    expect(matchesNumber("price", "3,50", "3,50 €")).toBe(true);
    expect(matchesNumber("price", "3,00", "3")).toBe(true);
    expect(matchesNumber("price", "3,50", "3,5")).toBe(true); // 3,5 = 3,50
    expect(matchesNumber("price", "3,50", "3,05")).toBe(false);
  });
  it("time tolerates dot separator and Uhr suffix", () => {
    expect(matchesNumber("time", "8:15", "8.15")).toBe(true);
    expect(matchesNumber("time", "8:15", "08:15 Uhr")).toBe(true);
    expect(matchesNumber("time", "8:15", "8:50")).toBe(false);
    expect(matchesNumber("time", "8:05", "8:5")).toBe(true); // numeric minute match
  });
});
