import { Hono } from "hono";
import { judge } from "../llm";
import type { JudgeRequest } from "../contracts";

// "复习裁判": judge a typed review answer by meaning/naturalness. Synchronous
// (interactive, low-latency, short) — NOT routed through the async job queue.
const route = new Hono();

route.post("/", async (c) => {
  let body: Partial<JudgeRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (
    (body.language !== "de" && body.language !== "en") ||
    !body.native?.trim() ||
    !body.target?.trim() ||
    !body.attempt?.trim()
  ) {
    return c.json(
      { error: "missing_fields", detail: "need {language:'de'|'en', native, target, attempt}" },
      400,
    );
  }
  try {
    const result = await judge({
      language: body.language,
      native: body.native,
      target: body.target,
      attempt: body.attempt,
      profile: body.profile,
    });
    return c.json(result);
  } catch (e) {
    return c.json(
      { error: "llm_failed", detail: e instanceof Error ? e.message : String(e) },
      502,
    );
  }
});

export default route;
