// Shared error→card pipeline (M4 dictation ∩ M5 output ∩ P2 speaking).
//
// One module owns "a mistake becomes an SRS card": deterministic card ids so a
// repeat failure hits the SAME card (graded Again — never a duplicate), tags
// folded via the existing foldErrorTags, and the review immediately scheduled
// so the card is due now rather than queuing behind the new-card throttle
// (error cards are remediation, not new curriculum).

import type { JudgeErrorTag } from "../api/contracts";
import {
  getCard,
  getCardReview,
  getReview,
  putCard,
  upsertCardReview,
  upsertReview,
} from "../db";
import { foldErrorTags } from "../errorTags";
import { freshCardState, schedule } from "../sr";
import { logReview } from "../studyLog";
import type { CardRecord, DictationErrorPayload } from "../types";

export type ErrorCardSource = "dictation" | "output" | "speaking";

/** Small stable content hash (djb2, hex) for deterministic card ids. */
export function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

export interface CreateErrorCardInput {
  language: string;
  source: ErrorCardSource;
  /** The text to re-practice (dictation: the sentence/number re-dictated). */
  text: string;
  mode?: DictationErrorPayload["mode"];
  numberKind?: DictationErrorPayload["numberKind"];
  sentenceId?: string;
  errorTags: JudgeErrorTag[];
}

/**
 * Upsert the error card + grade it Again (due now). If the underlying island
 * sentence has a ReviewState, the same tags are folded onto it as HISTORY only
 * — the sentence's FSRS state is never graded from a dictation/output mistake
 * (different exercise form, 承重墙 #3).
 */
export async function createErrorCard(
  input: CreateErrorCardInput,
): Promise<CardRecord> {
  const now = new Date();
  const nowMs = now.getTime();
  const id = `${input.language}.a1.dk.${contentHash(input.text)}`;

  const existing = await getCard(id);
  const card: CardRecord = existing ?? {
    id,
    language: input.language,
    kind: "dictation",
    template: "production",
    tags: ["dictation"],
    payload: {
      text: input.text,
      mode: input.mode ?? "sentence",
      numberKind: input.numberKind,
      sentenceId: input.sentenceId,
    },
    createdAt: nowMs,
  };
  await putCard(card);

  const prev = (await getCardReview(id)) ?? freshCardState(id, input.language, now);
  await logReview({
    cardId: id,
    deck: "card",
    language: input.language,
    grade: "again",
    prev,
  });
  const next = schedule(prev, "again", now);
  next.errorTags = foldErrorTags(prev.errorTags, input.errorTags, nowMs);
  await upsertCardReview(next);

  if (input.sentenceId) {
    const sentenceReview = await getReview(input.sentenceId);
    if (sentenceReview) {
      const folded = foldErrorTags(
        sentenceReview.errorTags,
        input.errorTags,
        nowMs,
      );
      if (folded !== sentenceReview.errorTags) {
        await upsertReview({ ...sentenceReview, errorTags: folded });
      }
    }
  }
  return card;
}
