import { describe, expect, it } from "vitest";
import { isMvd } from "./studyLog";

describe("isMvd", () => {
  const base = {
    srsQueueCleared: false,
    srsCardsGraded: 0,
    inputUnits: 0,
    outputUnits: 0,
  };

  it("needs SRS + input + output together", () => {
    expect(isMvd({ ...base, srsCardsGraded: 5, inputUnits: 1, outputUnits: 1 })).toBe(true);
    expect(isMvd({ ...base, srsCardsGraded: 5, inputUnits: 1 })).toBe(false);
    expect(isMvd({ ...base, srsCardsGraded: 5, outputUnits: 1 })).toBe(false);
    expect(isMvd({ ...base, inputUnits: 1, outputUnits: 1 })).toBe(false);
  });

  it("a cleared queue satisfies the SRS leg even below 5 cards", () => {
    expect(
      isMvd({ ...base, srsQueueCleared: true, srsCardsGraded: 2, inputUnits: 1, outputUnits: 1 }),
    ).toBe(true);
  });
});
