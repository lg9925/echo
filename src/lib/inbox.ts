// Inbox CRUD over Dexie. No React. Processing (compose/gloss calls) lives in
// a later step; this file is just capture + storage + queries.
import { getDb } from "./db";
import type { InboxItem, InboxKind } from "./types";
import type { JobTask, ScenarioResult, TargetLanguage } from "./api/contracts";
import { pollJob, submitJob } from "./api/client";
import { profileForRequest } from "./profile";
import { getMaxIslandSentences } from "./settings";
import {
  addSentencesToIsland,
  createScenarioIsland,
  groupScenario,
  scenarioToFieldsList,
} from "./cards";

export interface ProcessHooks {
  /** Fired the moment the item flips to "processing" (so the UI updates). */
  onStatus?: () => void;
  /** Scenario streaming progress: how many sentences generated so far. */
  onProgress?: (p: { sentences: number }) => void;
}

export interface CaptureInput {
  kind: InboxKind;
  language: TargetLanguage;
  rawText: string;
  inputMode: InboxItem["inputMode"];
}

/** Drop a raw item into the inbox. Returns immediately — no network. */
export async function addToInbox(input: CaptureInput): Promise<InboxItem> {
  const now = Date.now();
  const item: InboxItem = {
    id: crypto.randomUUID(),
    kind: input.kind,
    language: input.language,
    rawText: input.rawText.trim(),
    inputMode: input.inputMode,
    status: "captured",
    createdAt: now,
    updatedAt: now,
  };
  await getDb().inbox.add(item);
  return item;
}

/** Newest first; optionally scoped to one target language. */
export async function listInbox(language?: TargetLanguage): Promise<InboxItem[]> {
  const all = await getDb().inbox.orderBy("createdAt").reverse().toArray();
  return language ? all.filter((i) => i.language === language) : all;
}

export async function getInboxItem(id: string): Promise<InboxItem | undefined> {
  return getDb().inbox.get(id);
}

export async function updateInboxItem(
  id: string,
  patch: Partial<InboxItem>,
): Promise<void> {
  await getDb().inbox.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteInboxItem(id: string): Promise<void> {
  await getDb().inbox.delete(id);
}

// Build island(s) from a "ready" scenario item and mark it "added". Used by the
// assistant to keep its one-step flow while leaving a full inbox trail
// (captured→processing→ready→added). A big scene is split into sub-islands of
// ≤max sentences (原则三), one per sub-scene group. The inbox card has its own
// build path that lets the user edit/drop sentences first; this one builds the
// result as-is.
export async function autoBuildScenarioIsland(
  id: string,
): Promise<{ islands: { id: string; name: string }[] } | null> {
  const item = await getInboxItem(id);
  if (!item || item.kind !== "scenario" || item.status !== "ready" || !item.result) {
    return null;
  }
  const result = item.result as ScenarioResult;
  const groups = groupScenario(
    result.sentences,
    result.islandName,
    getMaxIslandSentences(),
  );
  const created: { id: string; name: string }[] = [];
  for (const g of groups) {
    const island = await createScenarioIsland(item.language, g.name);
    await addSentencesToIsland(island, scenarioToFieldsList(g.sentences));
    created.push({ id: island.id, name: island.name });
  }
  await updateInboxItem(id, {
    status: "added",
    addedIslandId: created[0]?.id,
    addedIslandIds: created.map((c) => c.id),
  });
  return { islands: created };
}

// Map an inbox item to the backend job (task + request body). Each kind reuses
// the existing LLM task; the queue just runs it in the background.
function jobSpecFor(item: InboxItem): { task: JobTask; input: unknown } {
  switch (item.kind) {
    case "say":
      return {
        task: "compose",
        input: {
          language: item.language,
          native: item.rawText,
          profile: profileForRequest(item.language),
        },
      };
    case "understand":
      return {
        task: "gloss",
        input: { language: item.language, query: item.rawText },
      };
    case "ask":
      return {
        task: "ask",
        input: {
          language: item.language,
          question: item.rawText,
          profile: profileForRequest(item.language),
        },
      };
    case "scenario":
      return {
        task: "scenario",
        input: {
          language: item.language,
          description: item.rawText,
          profile: profileForRequest(item.language),
          maxPerIsland: getMaxIslandSentences(),
        },
      };
  }
}

function onPoll(hooks?: ProcessHooks) {
  return (progress: number) => hooks?.onProgress?.({ sentences: progress });
}

// Submit the item as a background job, persist its jobId (so a reload/disconnect
// can resume polling instead of regenerating), then poll to completion.
// captured/error → processing → ready/error. The job keeps running server-side
// even if this page goes away; resumeInboxItem() picks it back up.
export async function processInboxItem(
  id: string,
  hooks?: ProcessHooks,
): Promise<void> {
  const item = await getInboxItem(id);
  if (!item) return;

  await updateInboxItem(id, { status: "processing", error: undefined, jobId: undefined });
  hooks?.onStatus?.();
  try {
    const { task, input } = jobSpecFor(item);
    const jobId = await submitJob(task, input);
    await updateInboxItem(id, { jobId }); // persist for resume
    const result = await pollJob<NonNullable<InboxItem["result"]>>(jobId, onPoll(hooks));
    await updateInboxItem(id, { status: "ready", result });
  } catch (e) {
    await updateInboxItem(id, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// Resume an item left "processing" with a known jobId (page was reloaded or the
// assistant panel closed mid-run). Polls the SAME server-side job — no
// regeneration. If the job is gone/errored (e.g. server restarted → reaper),
// it surfaces as an error the user can retry. Falls back to a fresh run if
// there's no jobId to resume.
export async function resumeInboxItem(
  id: string,
  hooks?: ProcessHooks,
): Promise<void> {
  const item = await getInboxItem(id);
  if (!item) return;
  if (!item.jobId) return processInboxItem(id, hooks);

  hooks?.onStatus?.();
  try {
    const result = await pollJob<NonNullable<InboxItem["result"]>>(item.jobId, onPoll(hooks));
    await updateInboxItem(id, { status: "ready", result });
  } catch (e) {
    await updateInboxItem(id, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
