import type { z } from "zod";
import { type LlmTask } from "../config";
import { resolveRoute } from "../routing";
import type {
  ComposeRequest,
  ComposeResult,
  GlossRequest,
  GlossResult,
  ScenarioRequest,
  ScenarioResult,
  SplitRequest,
  SplitResult,
  KeywordsRequest,
  KeywordsResult,
  AskRequest,
  AskResult,
  JudgeRequest,
  JudgeResult,
  OutputFeedbackRequest,
  OutputFeedbackResult,
} from "../contracts";
import { getAdapter } from "./adapters";
import {
  buildAuthoringPrompt,
  buildGlossPrompt,
  buildScenarioPrompt,
  buildSplitPrompt,
  buildKeywordsPrompt,
  buildAskPrompt,
  buildJudgePrompt,
  buildOutputFeedbackPrompt,
  buildEinbLiteralPrompt,
} from "./prompts";
import {
  composeSchema,
  glossSchema,
  scenarioSchema,
  splitSchema,
  keywordsSchema,
  askSchema,
  judgeSchema,
  outputFeedbackSchema,
} from "./schema";

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
  const route = resolveRoute(task);
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

export function scenario(req: ScenarioRequest): Promise<ScenarioResult> {
  return runStructured("scenario", buildScenarioPrompt(req), scenarioSchema);
}

export function split(req: SplitRequest): Promise<SplitResult> {
  return runStructured("split", buildSplitPrompt(req), splitSchema);
}

export function keywords(req: KeywordsRequest): Promise<KeywordsResult> {
  return runStructured("keywords", buildKeywordsPrompt(req), keywordsSchema);
}

export function ask(req: AskRequest): Promise<AskResult> {
  return runStructured("ask", buildAskPrompt(req), askSchema);
}

export function judge(req: JudgeRequest): Promise<JudgeResult> {
  return runStructured("judge", buildJudgePrompt(req), judgeSchema);
}

// A1 产出反馈 — job-queue only (production routes it to claude-cli; a 2–4 min
// run would blow the tunnel's ~100s cap as a sync route).
export function outputFeedback(
  req: OutputFeedbackRequest,
): Promise<OutputFeedbackResult> {
  return runStructured(
    "output_feedback",
    buildOutputFeedbackPrompt(req),
    outputFeedbackSchema,
  );
}

// 入籍考试逐词直译 — author-time only (not wired to a route/job). Plain-text
// output (the result is a single string), so German quotes „…" in the source
// can't break a JSON wrapper. Strips any stray fences/quotes the model adds.
export async function einbLiteral(
  questionDe: string,
): Promise<{ literal: string }> {
  const route = resolveRoute("einb_literal");
  const adapter = getAdapter(route.provider);
  const { system, user } = buildEinbLiteralPrompt(questionDe);
  const raw = await adapter.complete({
    system,
    user,
    model: route.model,
    maxTokens: route.maxTokens,
  });
  let s = raw.trim();
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  if (s.length > 1 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return { literal: s.trim() };
}

// Streaming variant: `onText` receives the accumulated raw text as it streams
// (the route derives progress from it). Falls back to the non-streaming path
// for providers without completeStream. Final result is still validated.
async function runStructuredStream<S extends z.ZodTypeAny>(
  task: LlmTask,
  prompt: { system: string; user: string },
  schema: S,
  onText: (textSoFar: string) => void,
): Promise<z.infer<S>> {
  const route = resolveRoute(task);
  const adapter = getAdapter(route.provider);
  if (!adapter.completeStream) {
    return runStructured(task, prompt, schema);
  }
  const raw = await adapter.completeStream(
    {
      system: prompt.system,
      user: prompt.user,
      model: route.model,
      maxTokens: route.maxTokens,
    },
    onText,
  );
  try {
    return schema.parse(JSON.parse(extractJson(raw)));
  } catch {
    // Streamed output didn't validate — fall back to one clean (non-stream) try.
    return runStructured(task, prompt, schema);
  }
}

export function scenarioStream(
  req: ScenarioRequest,
  onText: (textSoFar: string) => void,
): Promise<ScenarioResult> {
  return runStructuredStream("scenario", buildScenarioPrompt(req), scenarioSchema, onText);
}
