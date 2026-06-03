import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { scenario, scenarioStream } from "../llm";
import type { ScenarioRequest } from "../contracts";

const route = new Hono();

function parseBody(body: Partial<ScenarioRequest>): ScenarioRequest | null {
  if (!body.description?.trim() || (body.language !== "de" && body.language !== "en")) {
    return null;
  }
  return { language: body.language, description: body.description, profile: body.profile };
}

// Non-streaming: returns the final card JSON.
route.post("/", async (c) => {
  let body: Partial<ScenarioRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  const req = parseBody(body);
  if (!req) return c.json({ error: "missing_fields", detail: "need {language:'de'|'en', description}" }, 400);
  try {
    return c.json(await scenario(req));
  } catch (e) {
    return c.json({ error: "llm_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// Streaming (SSE): emits `progress` events ({sentences}) as the dialogue
// generates, then a `done` event with the validated result (or `error`).
route.post("/stream", async (c) => {
  let body: Partial<ScenarioRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  const req = parseBody(body);
  if (!req) return c.json({ error: "missing_fields", detail: "need {language:'de'|'en', description}" }, 400);

  return streamSSE(c, async (stream) => {
    let lastCount = -1;
    try {
      const result = await scenarioStream(req, (textSoFar) => {
        // Each card has one "target" field — count them as a progress proxy.
        const sentences = (textSoFar.match(/"target"\s*:/g) ?? []).length;
        if (sentences !== lastCount) {
          lastCount = sentences;
          void stream.writeSSE({ event: "progress", data: JSON.stringify({ sentences }) });
        }
      });
      await stream.writeSSE({ event: "done", data: JSON.stringify(result) });
    } catch (e) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: "llm_failed", detail: e instanceof Error ? e.message : String(e) }),
      });
    }
  });
});

export default route;
