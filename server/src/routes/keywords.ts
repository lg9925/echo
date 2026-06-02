import { Hono } from "hono";
import { keywords } from "../llm";
import type { KeywordsRequest } from "../contracts";

const route = new Hono();

route.post("/", async (c) => {
  let body: Partial<KeywordsRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (
    (body.language !== "de" && body.language !== "en") ||
    !body.islandName?.trim() ||
    !Array.isArray(body.sentences) ||
    body.sentences.length === 0
  ) {
    return c.json(
      { error: "missing_fields", detail: "need {language, islandName, sentences[]}" },
      400,
    );
  }
  try {
    const result = await keywords({
      language: body.language,
      islandName: body.islandName,
      sentences: body.sentences,
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
