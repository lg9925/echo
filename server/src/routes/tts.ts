import { Hono } from "hono";
import { tts } from "../tts";
import type { TtsProvider } from "../config";
import type { TtsRequest } from "../contracts";

const route = new Hono();

// Returns binary audio/mpeg (not JSON). The client hashes + caches the bytes.
route.post("/", async (c) => {
  let body: Partial<TtsRequest>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (!body.text?.trim() || !body.lang) {
    return c.json({ error: "missing_fields", detail: "need {text, lang}" }, 400);
  }
  try {
    const { audio, mime } = await tts({
      text: body.text,
      lang: body.lang,
      voice: body.voice,
      rate: body.rate,
      // Explicit vendor (e.g. "edge" for multi-speaker HVPT voices) — an Edge
      // voice id sent to another provider would 404.
      provider: body.provider as TtsProvider | undefined,
    });
    // Buffer → fresh ArrayBuffer slice so Hono streams the exact bytes.
    const ab = audio.buffer.slice(
      audio.byteOffset,
      audio.byteOffset + audio.byteLength,
    ) as ArrayBuffer;
    c.header("Content-Type", mime);
    c.header("Cache-Control", "no-store");
    return c.body(ab);
  } catch (e) {
    return c.json({ error: "tts_failed", detail: e instanceof Error ? e.message : String(e) }, 502);
  }
});

export default route;
