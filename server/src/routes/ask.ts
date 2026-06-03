import { Hono } from "hono";
import { ask } from "../llm";
import type { AskRequest } from "../contracts";

const route = new Hono();

route.post("/", async (c) => {
  let body: Partial<AskRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (
    (body.language !== "de" && body.language !== "en") ||
    !body.question?.trim()
  ) {
    return c.json(
      { error: "missing_fields", detail: "need {language:'de'|'en', question}" },
      400,
    );
  }
  try {
    const result = await ask({
      language: body.language,
      question: body.question,
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
