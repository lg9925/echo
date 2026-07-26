import { describe, expect, it } from "vitest";
import { interleave, interleaveKey, type QueueItem } from "./deck";
import type { CardRecord, CardReviewState } from "../types";

function card(id: string, tags: string[]): CardRecord {
  return {
    id,
    language: "de",
    kind: "word",
    template: "recognition",
    tags,
    payload: {
      lemma: id,
      pos: "other",
      meaningZh: "",
      example: "",
      exampleZh: "",
    },
    createdAt: 0,
  };
}

function review(cardId: string, due: number): CardReviewState {
  return {
    cardId,
    language: "de",
    due,
    interval: 1,
    repetitions: 1,
    lastReviewedAt: due - 1,
    introducedAt: 0,
  };
}

function item(id: string, tags: string[], due?: number): QueueItem {
  return due === undefined
    ? { card: card(id, tags) }
    : { card: card(id, tags), review: review(id, due) };
}

describe("interleaveKey", () => {
  it("prioritizes gender > pattern > dictation > vocab", () => {
    expect(interleaveKey(["gender", "noun"])).toBe("gender");
    expect(interleaveKey(["pattern"])).toBe("pattern");
    expect(interleaveKey(["dictation"])).toBe("dictation");
    expect(interleaveKey(["vocab", "topic:wohnen"])).toBe("vocab");
    expect(interleaveKey([])).toBe("vocab");
  });
});

describe("interleave", () => {
  it("never emits >2 consecutive same-key items while another bucket is non-empty", () => {
    const due = [
      ...Array.from({ length: 8 }, (_, i) => item(`v${i}`, ["vocab"], i + 1)),
      ...Array.from({ length: 3 }, (_, i) => item(`g${i}`, ["gender"], i + 1)),
      ...Array.from({ length: 2 }, (_, i) => item(`p${i}`, ["pattern"], i + 1)),
    ];
    const { queue, keySequence } = interleave(due, [], () => 0.5);
    expect(queue).toHaveLength(13);
    // Check the hard constraint over the emitted key sequence: a run of >2 of
    // one key may only appear once all other buckets are exhausted (i.e. at
    // the tail, where remaining keys are all identical).
    for (let i = 2; i < keySequence.length; i++) {
      const run3 =
        keySequence[i] === keySequence[i - 1] &&
        keySequence[i] === keySequence[i - 2];
      if (run3) {
        const rest = new Set(keySequence.slice(i - 2));
        expect(rest.size).toBe(1);
      }
    }
  });

  it("orders due cards oldest-first within a bucket", () => {
    const due = [
      item("v-late", ["vocab"], 500),
      item("v-early", ["vocab"], 100),
    ];
    const { queue } = interleave(due, [], () => 0.5);
    expect(queue.findIndex((q) => q.card.id === "v-early")).toBeLessThan(
      queue.findIndex((q) => q.card.id === "v-late"),
    );
  });

  it("appends fresh cards behind due cards of the same bucket", () => {
    const due = [item("v-due", ["vocab"], 100)];
    const fresh = [item("v-new", ["vocab"])];
    const { queue } = interleave(due, fresh, () => 0.5);
    expect(queue.map((q) => q.card.id)).toEqual(["v-due", "v-new"]);
  });

  it("logs the exact emitted key sequence (P0 acceptance: 交错可在日志验证)", () => {
    const due = [
      item("g1", ["gender"], 1),
      item("v1", ["vocab"], 1),
      item("g2", ["gender"], 2),
      item("v2", ["vocab"], 2),
    ];
    const { keySequence } = interleave(due, [], () => 0.5);
    expect(keySequence).toHaveLength(4);
    for (let i = 1; i < keySequence.length; i++) {
      expect(keySequence[i]).not.toBe(keySequence[i - 1]); // strict alternation with 2 buckets
    }
  });
});
