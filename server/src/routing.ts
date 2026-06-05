// Runtime LLM task→provider/model resolution. config.ts computes a routing
// SNAPSHOT once at startup (defaults + LLM_<TASK>_* env). This layer adds
// runtime overrides on top, persisted in the `routing_overrides` table and
// loaded at boot — so switching a task's model takes effect immediately, with
// no restart and no .env edit (原则一: model choice belongs in advanced settings).
//
// API keys never enter this path — only provider/model *names*. Keys stay in
// server env (原则六); the adapter for the chosen provider must be configured.
import {
  PROVIDER_MODELS,
  TASK_ROUTING,
  type LlmProvider,
  type LlmRoute,
  type LlmTask,
} from "./config";
import { db } from "./db";

const overrides = new Map<LlmTask, { provider?: LlmProvider; model?: string }>();

/** The route actually used for a task: runtime override → env → code default.
 *  maxTokens always comes from the base (it's a per-task output budget, not a
 *  user choice). */
export function resolveRoute(task: LlmTask): LlmRoute {
  const base = TASK_ROUTING[task];
  const o = overrides.get(task);
  if (!o) return base;
  const provider = o.provider ?? base.provider;
  // No pinned model = "use this provider's default", resolved live: keep the
  // base model when the provider is unchanged, else the provider's recommended
  // default (PROVIDER_MODELS[provider][0]). So a "default" choice follows
  // catalog updates instead of freezing a version string.
  const model =
    o.model ??
    (provider === base.provider ? base.model : PROVIDER_MODELS[provider]?.[0] ?? base.model);
  return { provider, model, maxTokens: base.maxTokens };
}

/** Current override for a task (if any) — for the admin endpoint to echo back. */
export function getRouteOverride(
  task: LlmTask,
): { provider?: LlmProvider; model?: string } | undefined {
  return overrides.get(task);
}

export async function loadRouteOverrides(): Promise<void> {
  const rs = await db.execute("SELECT task, provider, model FROM routing_overrides");
  overrides.clear();
  for (const row of rs.rows) {
    overrides.set(row.task as LlmTask, {
      provider: (row.provider as LlmProvider | null) ?? undefined,
      model: (row.model as string | null) ?? undefined,
    });
  }
}

/** Set (or clear) a task's override. Passing neither provider nor model clears
 *  it, reverting to env/default. Persists to the DB. */
export async function setRouteOverride(
  task: LlmTask,
  provider: LlmProvider | undefined,
  model: string | undefined,
): Promise<void> {
  if (!provider && !model) {
    overrides.delete(task);
    await db.execute({ sql: "DELETE FROM routing_overrides WHERE task = ?", args: [task] });
    return;
  }
  overrides.set(task, { provider, model });
  await db.execute({
    sql: `INSERT INTO routing_overrides (task, provider, model, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(task) DO UPDATE SET
            provider = excluded.provider,
            model = excluded.model,
            updated_at = excluded.updated_at`,
    args: [task, provider ?? null, model ?? null, Date.now()],
  });
}
