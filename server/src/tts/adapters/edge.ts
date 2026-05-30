import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { TtsAdapter } from "./types";

// Edge-TTS via msedge-tts: free, no API key, natural German voices. Talks to
// Microsoft's read-aloud websocket over outbound HTTPS.
export const edgeAdapter: TtsAdapter = {
  name: "edge",
  async synthesize({ text, voice, rate }) {
    const engine = new MsEdgeTTS();
    await engine.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = engine.toStream(text, { rate });
    const chunks: Buffer[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        audioStream.on("data", (c: Buffer) => chunks.push(c));
        audioStream.on("end", resolve);
        audioStream.on("error", reject);
      });
    } finally {
      engine.close();
    }

    return { audio: Buffer.concat(chunks), mime: "audio/mpeg" };
  },
};
