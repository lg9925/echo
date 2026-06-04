// Async job store + runner. Slow LLM tasks (scenario/compose/gloss/split/
// keywords/ask) run here in the background so the client can submit → poll
// instead of holding one long request — which the Cloudflare tunnel's ~100s
// edge timeout would otherwise drop. The result is persisted in the `jobs`
// table, so a client that disconnected mid-run gets it on reconnect.
//
// This layer only *dispatches* to llm/index.ts — prompts/schemas stay in the
// core (原则五). It adds no new task types.
import { db } from "./db";
import {
  compose,
  gloss,
  scenario,
  scenarioStream,
  split,
  keywords,
  ask,
} from "./llm";
import type { JobState, JobStatus, JobTask } from "./contracts";

const TASKS: readonly JobTask[] = [
  "compose",
  "gloss",
  "scenario",
  "split",
  "keywords",
  "ask",
];

export function isJobTask(t: unknown): t is JobTask {
  return typeof t === "string" && (TASKS as readonly string[]).includes(t);
}

export async function createJob(
  userId: string,
  task: JobTask,
  input: unknown,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO jobs (id, user_id, task, status, input, progress, created_at, updated_at)
          VALUES (?, ?, ?, 'queued', ?, 0, ?, ?)`,
    args: [id, userId, task, JSON.stringify(input), now, now],
  });
  return id;
}

export async function getJobState(id: string): Promise<JobState | null> {
  const rs = await db.execute({
    sql: "SELECT status, progress, result, error FROM jobs WHERE id = ?",
    args: [id],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    status: row.status as JobStatus,
    progress: Number(row.progress ?? 0),
    result: row.result ? JSON.parse(row.result as string) : undefined,
    error: (row.error as string | null) ?? undefined,
  };
}

async function setProgress(id: string, n: number): Promise<void> {
  await db.execute({
    sql: "UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?",
    args: [n, Date.now(), id],
  });
}

// Run a queued job to completion. Fire-and-forget from the route — the
// long-lived Node process carries it; errors are caught and stored, never
// thrown (nothing is awaiting this).
export async function runJob(id: string): Promise<void> {
  const rs = await db.execute({
    sql: "SELECT task, input FROM jobs WHERE id = ?",
    args: [id],
  });
  const row = rs.rows[0];
  if (!row) return;
  const task = row.task as JobTask;
  const input = JSON.parse(row.input as string);

  await db.execute({
    sql: "UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?",
    args: [Date.now(), id],
  });

  try {
    let result: unknown;
    switch (task) {
      case "compose":
        result = await compose(input);
        break;
      case "gloss":
        result = await gloss(input);
        break;
      case "split":
        result = await split(input);
        break;
      case "keywords":
        result = await keywords(input);
        break;
      case "ask":
        result = await ask(input);
        break;
      case "scenario":
        // Keep the live sentence count by streaming, but write it as progress
        // instead of over the wire (the client polls for it).
        result = await scenarioStream(input, (textSoFar) => {
          const n = (textSoFar.match(/"target"\s*:/g) ?? []).length;
          void setProgress(id, n);
        });
        break;
    }
    await db.execute({
      sql: "UPDATE jobs SET status = 'done', result = ?, updated_at = ? WHERE id = ?",
      args: [JSON.stringify(result), Date.now(), id],
    });
  } catch (e) {
    await db.execute({
      sql: "UPDATE jobs SET status = 'error', error = ?, updated_at = ? WHERE id = ?",
      args: [e instanceof Error ? e.message : String(e), Date.now(), id],
    });
  }
}
