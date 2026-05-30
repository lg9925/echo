// Inbox CRUD over Dexie. No React. Processing (compose/gloss calls) lives in
// a later step; this file is just capture + storage + queries.
import { getDb } from "./db";
import type { InboxItem, InboxKind } from "./types";
import type {
  ComposeResult,
  GlossResult,
  ScenarioResult,
  TargetLanguage,
} from "./api/contracts";
import { apiFetchJson } from "./api/client";

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

// Call the backend to fill in the result. captured/error → processing →
// ready/error. `onProgress` fires as soon as the item flips to "processing"
// so the UI can reflect it immediately (the LLM call may take minutes).
export async function processInboxItem(
  id: string,
  onProgress?: () => void,
): Promise<void> {
  const item = await getInboxItem(id);
  if (!item) return;

  await updateInboxItem(id, { status: "processing", error: undefined });
  onProgress?.();
  try {
    if (item.kind === "say") {
      const result = await apiFetchJson<ComposeResult>("/v1/compose", {
        language: item.language,
        native: item.rawText,
      });
      await updateInboxItem(id, { status: "ready", result });
    } else if (item.kind === "understand") {
      const result = await apiFetchJson<GlossResult>("/v1/gloss", {
        language: item.language,
        query: item.rawText,
      });
      await updateInboxItem(id, { status: "ready", result });
    } else {
      const result = await apiFetchJson<ScenarioResult>("/v1/scenario", {
        language: item.language,
        description: item.rawText,
      });
      await updateInboxItem(id, { status: "ready", result });
    }
  } catch (e) {
    await updateInboxItem(id, {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
