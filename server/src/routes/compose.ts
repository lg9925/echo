import { Hono } from "hono";
import { compose } from "../llm";
import type { ComposeRequest } from "../contracts";

const route = new Hono();

route.post("/", async (c) => {
  let body: Partial<ComposeRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (!body.native?.trim() || (body.language !== "de" && body.language !== "en")) {
    return c.json({ error: "missing_fields", detail: "need {language:'de'|'en', native}" }, 400);
  }
  try {
    const result = await compose({
      language: body.language,
      native: body.native,
      profile: body.profile,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: "llm_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

export default route;
