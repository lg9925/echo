// M5 每日产出任务 (output loop) — template pick + draft lifecycle + job orchestration.
//
// Task GENERATION is local (curated bank in src/data/output_tasks_de.json — no
// LLM, deterministic, offline); only the FEEDBACK is an LLM job. The draft's
// status machine mirrors inbox.ts: draft → submitted → reviewed | error, with
// the jobId persisted so a reload/disconnect resumes polling the same
// server-side job (production routes output_feedback to claude-cli, 2–4 min).
// Each correction becomes an SRS error card via a1/errorCards.ts ("output").

import rawTemplates from "../data/output_tasks_de.json";
import type {
  OutputFeedbackRequest,
  OutputFeedbackResult,
} from "./api/contracts";
import { pollJob, submitJob } from "./api/client";
import { getOutputDraft, listRecentOutputDrafts, putOutputDraft } from "./db";
import { profileForRequest } from "./profile";
import { dayKeyLocal } from "./streak";
import { createErrorCard } from "./a1/errorCards";
import type { OutputDraft } from "./types";
import type { TargetLanguage } from "./api/contracts";

export interface OutputTaskTemplate {
  id: string;
  kind: "question" | "message";
  prompt: { de: string; zh: string };
  coveragePoints: { zh: string }[];
}

const TEMPLATES = rawTemplates as OutputTaskTemplate[];

export function templateById(id: string): OutputTaskTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Small deterministic hash for day-seeded template rotation. */
function hashDay(dayKey: string): number {
  let h = 2166136261;
  for (let i = 0; i < dayKey.length; i++) {
    h = (h ^ dayKey.charCodeAt(i)) * 16777619;
  }
  return h >>> 0;
}

/** Day-seeded pick that skips templates used in the recent drafts. */
export function pickTemplate(
  dayKey: string,
  recentTemplateIds: string[],
): OutputTaskTemplate {
  const recent = new Set(recentTemplateIds);
  const pool = TEMPLATES.filter((t) => !recent.has(t.id));
  const usable = pool.length > 0 ? pool : TEMPLATES;
  return usable[hashDay(dayKey) % usable.length]!;
}

/** Today's draft, created (with a picked template) on first access. */
export async function ensureTodayDraft(
  language: string,
  nowMs: number = Date.now(),
): Promise<OutputDraft> {
  const dayKey = dayKeyLocal(nowMs);
  const existing = await getOutputDraft(language, dayKey);
  if (existing) return existing;
  const recent = await listRecentOutputDrafts(language, 14);
  const template = pickTemplate(dayKey, recent.map((d) => d.templateId));
  const draft: OutputDraft = {
    id: `${language}|${dayKey}`,
    language,
    dayKey,
    templateId: template.id,
    attempt: "",
    status: "draft",
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  await putOutputDraft(draft);
  return draft;
}

export async function saveAttempt(
  draft: OutputDraft,
  attempt: string,
): Promise<OutputDraft> {
  const next = { ...draft, attempt, updatedAt: Date.now() };
  await putOutputDraft(next);
  return next;
}

/** Offline self-check ticks (离线降级变体 — counts as the MVD output leg once
 *  all points are ticked; the draft stays submittable for 补交 later). */
export async function saveSelfCheck(
  draft: OutputDraft,
  selfCheck: boolean[],
): Promise<OutputDraft> {
  const next = { ...draft, selfCheck, updatedAt: Date.now() };
  await putOutputDraft(next);
  return next;
}

function feedbackRequest(draft: OutputDraft): OutputFeedbackRequest {
  const template = templateById(draft.templateId);
  if (!template) throw new Error(`unknown template ${draft.templateId}`);
  return {
    language: draft.language as TargetLanguage,
    taskPrompt: template.prompt.de,
    coveragePoints: template.coveragePoints.map((p) => p.zh),
    attempt: draft.attempt,
    profile: profileForRequest(draft.language),
  };
}

/** Turn each correction into an SRS error card (shared M4/M5 pipeline). The
 *  corrected fragment becomes a re-dictate card; idempotent per draft via the
 *  cardsCreated guard. */
async function createCorrectionCards(draft: OutputDraft): Promise<OutputDraft> {
  if (draft.cardsCreated || !draft.result) return draft;
  for (const c of draft.result.corrections) {
    const text = c.corrected.trim();
    if (!text) continue;
    await createErrorCard({
      language: draft.language,
      source: "output",
      text,
      mode: "sentence",
      errorTags: [c.errorTag],
    });
  }
  const next = { ...draft, cardsCreated: true, updatedAt: Date.now() };
  await putOutputDraft(next);
  return next;
}

/** Submit the draft for feedback and poll to completion. Persists each status
 *  transition; a thrown/failed job lands in status "error" (retryable). */
export async function processDraft(
  draft: OutputDraft,
  onUpdate: (d: OutputDraft) => void,
): Promise<OutputDraft> {
  let current = draft;
  try {
    const jobId = await submitJob("output_feedback", feedbackRequest(current));
    current = { ...current, status: "submitted", jobId, error: undefined, updatedAt: Date.now() };
    await putOutputDraft(current);
    onUpdate(current);
    const result = await pollJob<OutputFeedbackResult>(jobId);
    current = { ...current, status: "reviewed", result, updatedAt: Date.now() };
    await putOutputDraft(current);
    current = await createCorrectionCards(current);
    onUpdate(current);
    return current;
  } catch (e) {
    current = {
      ...current,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      updatedAt: Date.now(),
    };
    await putOutputDraft(current);
    onUpdate(current);
    return current;
  }
}

/** Resume polling a draft whose job was submitted before a reload. */
export async function resumeDraft(
  draft: OutputDraft,
  onUpdate: (d: OutputDraft) => void,
): Promise<OutputDraft> {
  if (draft.status !== "submitted" || !draft.jobId) return draft;
  let current = draft;
  try {
    const result = await pollJob<OutputFeedbackResult>(draft.jobId);
    current = { ...current, status: "reviewed", result, updatedAt: Date.now() };
    await putOutputDraft(current);
    current = await createCorrectionCards(current);
    onUpdate(current);
    return current;
  } catch (e) {
    current = {
      ...current,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      updatedAt: Date.now(),
    };
    await putOutputDraft(current);
    onUpdate(current);
    return current;
  }
}
