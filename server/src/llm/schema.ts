import { z } from "zod";

// Tolerant null: accept missing/null/"" → null. LLMs are inconsistent here and
// we'd rather coerce than burn a retry on a cosmetic miss.
const nullableStr = z
  .string()
  .nullish()
  .transform((v) => (v == null || v === "" ? null : v));

const article = z.preprocess((v) => {
  if (typeof v === "string") {
    const l = v.toLowerCase();
    return l === "der" || l === "die" || l === "das" ? l : null;
  }
  return v ?? null;
}, z.enum(["der", "die", "das"]).nullable());

// Fields shared by an authoring card and each scenario sentence.
const cardShape = {
  native: z.string(),
  target: z.string(),
  frame: z.string(),
  literal: z.string(),
  note: z.string(),
  variants: z.array(z.string()),
  ipa: nullableStr,
};

export const composeSchema = z.object({
  ...cardShape,
  suggestedIslandName: nullableStr,
});

export const scenarioSchema = z.object({
  islandName: z.string(),
  sentences: z
    .array(z.object({ ...cardShape, group: nullableStr }))
    .min(1),
});

export const splitSchema = z.object({
  groups: z
    .array(
      z.object({
        subIslandName: z.string(),
        indices: z.array(z.number().int()).min(1),
      }),
    )
    .min(2),
});

export const askSchema = z.object({
  answer: z.string(),
  // Optional savable bits the learner can one-tap into their islands / 字词表.
  examples: z
    .array(z.object({ target: z.string(), native: z.string() }))
    .default([]),
  words: z
    .array(z.object({ term: z.string(), meaning: z.string() }))
    .default([]),
});

export const judgeSchema = z.object({
  verdict: z.enum(["correct", "close", "wrong"]),
  // tolerate missing/null → "" (the UI hides empty tips/suggestions).
  tip: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  better: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  // Typed failure diagnosis (srs-error-deck.md §2). Optional + tolerant: a
  // response without it (e.g. a `correct` answer, or an older model) still
  // validates. Only type+detail on the wire — count/lastSeen are client-side.
  errorTags: z
    .array(
      z.object({
        type: z.enum([
          "WORD_ORDER",
          "MORPHOLOGY",
          "PHONEME",
          "VOCAB",
          "FLUENCY_LATENCY",
        ]),
        detail: z
          .string()
          .nullish()
          .transform((v) => v ?? null),
      }),
    )
    .nullish()
    .transform((v) => (v && v.length ? v : undefined)),
});

export const keywordsSchema = z.object({
  keywords: z
    .array(
      z.object({
        term: z.string(),
        meaning: z.string(),
        indices: z.array(z.number().int()),
      }),
    )
    .min(1),
});

export const glossSchema = z.object({
  meaning: z.string(),
  candidates: z
    .array(
      z.object({
        target: z.string(),
        pos: nullableStr,
        article,
        note: nullableStr,
      }),
    )
    .min(1),
  example: z.object({ target: z.string(), native: z.string() }),
  suggestedIslandName: nullableStr,
});
