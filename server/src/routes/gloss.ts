import { Hono } from "hono";
import { gloss } from "../llm";
import type { GlossRequest } from "../contracts";

const route = new Hono();

route.post("/", async (c) => {
  let body: Partial<GlossRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (!body.query?.trim() || (body.language !== "de" && body.language !== "en")) {
    return c.json({ error: "missing_fields", detail: "need {language:'de'|'en', query}" }, 400);
  }
  try {
    const result = await gloss({ language: body.language, query: body.query });
    return c.json(result);
  } catch (e) {
    return c.json({ error: "llm_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

export default route;
