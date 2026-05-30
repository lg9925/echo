import { Hono } from "hono";
import { scenario } from "../llm";
import type { ScenarioRequest } from "../contracts";

const route = new Hono();

route.post("/", async (c) => {
  let body: Partial<ScenarioRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (!body.description?.trim() || (body.language !== "de" && body.language !== "en")) {
    return c.json({ error: "missing_fields", detail: "need {language:'de'|'en', description}" }, 400);
  }
  try {
    const result = await scenario({ language: body.language, description: body.description });
    return c.json(result);
  } catch (e) {
    return c.json({ error: "llm_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

export default route;
