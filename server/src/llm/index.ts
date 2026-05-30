import type { z } from "zod";
import { TASK_ROUTING, type LlmTask } from "../config";
import type {
  ComposeRequest,
  ComposeResult,
  GlossRequest,
  GlossResult,
} from "../contracts";
import { getAdapter } from "./adapters";
import { buildAuthoringPrompt, buildGlossPrompt } from "./prompts";
import { composeSchema, glossSchema } from "./schema";

// Pull a JSON object out of a model reply that may be wrapped in prose or a
// ```json fence.
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let s = fenced?.[1] ?? text;
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s.trim();
}

// Run a task: pick adapter by config, send prompt, parse + validate. On the
// first failure, feed the error back and retry once. Provider-agnostic.
async function runStructured<S extends z.ZodTypeAny>(
  task: LlmTask,
  prompt: { system: string; user: string },
  schema: S,
): Promise<z.infer<S>> {
  const route = TASK_ROUTING[task];
  const adapter = getAdapter(route.provider);
  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      attempt === 0
        ? prompt.user
        : `${prompt.user}\n\n上次输出无法解析或不符合要求,错误:${lastError}\n请只输出严格符合字段要求的 JSON,不要任何解释或代码块。`;

    const raw = await adapter.complete({
      system: prompt.system,
      user,
      model: route.model,
      maxTokens: route.maxTokens,
    });

    try {
      return schema.parse(JSON.parse(extractJson(raw)));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(
    `llm(${task}) failed validation after retry via ${route.provider}/${route.model}: ${lastError}`,
  );
}

export function compose(req: ComposeRequest): Promise<ComposeResult> {
  return runStructured("authoring", buildAuthoringPrompt(req), composeSchema);
}

export function gloss(req: GlossRequest): Promise<GlossResult> {
  return runStructured("gloss", buildGlossPrompt(req), glossSchema);
}
