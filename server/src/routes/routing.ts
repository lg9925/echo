import { Hono } from "hono";
import { PROVIDER_MODELS, type LlmProvider, type LlmTask } from "../config";
import { getRouteOverride, resolveRoute, setRouteOverride } from "../routing";

// Admin: read/switch which provider+model serves each LLM task, at runtime
// (persisted in the DB, no restart). Gated by the same /v1 Bearer auth. This
// backs the app's advanced-settings "model选择" (原则一). Keys never cross here.
const TASKS: LlmTask[] = ["authoring", "gloss", "scenario", "split", "keywords", "ask"];
const PROVIDERS: LlmProvider[] = [
  "anthropic",
  "openai",
  "deepseek",
  "claude-cli",
  "gemini",
  "gemini-cli",
];

// Whether a provider's credential is present. CLI providers assume the CLI is
// installed/logged-in (can't cheaply probe) → reported available.
function providerConfigured(p: LlmProvider): boolean {
  switch (p) {
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "deepseek":
      return !!process.env.DEEPSEEK_API_KEY;
    case "gemini":
      return !!process.env.GEMINI_API_KEY;
    case "claude-cli":
    case "gemini-cli":
      return true;
  }
}

const route = new Hono();

// Current effective route per task (+ whether it's a runtime override) and the
// provider menu the UI can offer.
route.get("/", (c) => {
  return c.json({
    tasks: TASKS.map((task) => ({
      task,
      ...resolveRoute(task),
      overridden: getRouteOverride(task) !== undefined,
    })),
    providers: PROVIDERS.map((provider) => ({
      provider,
      configured: providerConfigured(provider),
      models: PROVIDER_MODELS[provider],
    })),
  });
});

// Set or clear a task's override. Body: {task, provider?, model?}. Omit/empty
// both provider and model to clear (revert to env/default).
route.put("/", async (c) => {
  let body: { task?: unknown; provider?: unknown; model?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (!TASKS.includes(body.task as LlmTask)) {
    return c.json({ error: "bad_task", detail: `task must be one of ${TASKS.join(", ")}` }, 400);
  }
  const provider = (body.provider as string) || "";
  if (provider && !PROVIDERS.includes(provider as LlmProvider)) {
    return c.json({ error: "bad_provider", detail: `provider must be one of ${PROVIDERS.join(", ")}` }, 400);
  }
  const model = ((body.model as string) || "").trim();
  await setRouteOverride(
    body.task as LlmTask,
    (provider as LlmProvider) || undefined,
    model || undefined,
  );
  const task = body.task as LlmTask;
  return c.json({ task, ...resolveRoute(task), overridden: getRouteOverride(task) !== undefined });
});

export default route;
