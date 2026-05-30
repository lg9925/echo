import type { TtsAdapter } from "./types";

// STUB. Wire the TODO and set OPENAI_API_KEY, then point TTS_ROUTING.default
// (or a per-language route) at "openai" in config.ts. No upper-layer change.
export const openaiTtsAdapter: TtsAdapter = {
  name: "openai",
  async synthesize(/* { text, voice } */) {
    // TODO(key): enable with OPENAI_API_KEY —
    //   import OpenAI from "openai";
    //   const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    //   const res = await client.audio.speech.create({
    //     model: "tts-1", voice, input: text, response_format: "mp3",
    //   });
    //   return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
    throw new Error(
      "openai TTS adapter is a stub — set OPENAI_API_KEY and wire the TODO in tts/adapters/openai.ts",
    );
  },
};
