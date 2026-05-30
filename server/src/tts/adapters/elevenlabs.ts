import type { TtsAdapter } from "./types";

// STUB. Wire the TODO and set ELEVENLABS_API_KEY, then route to "elevenlabs".
export const elevenlabsTtsAdapter: TtsAdapter = {
  name: "elevenlabs",
  async synthesize(/* { text, voice } */) {
    // TODO(key): enable with ELEVENLABS_API_KEY —
    //   POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
    //   headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, accept: "audio/mpeg" }
    //   body: { text, model_id: "eleven_multilingual_v2" }
    //   return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
    throw new Error(
      "elevenlabs TTS adapter is a stub — set ELEVENLABS_API_KEY and wire the TODO in tts/adapters/elevenlabs.ts",
    );
  },
};
