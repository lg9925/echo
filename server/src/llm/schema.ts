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
  sentences: z.array(z.object(cardShape)).min(1),
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
