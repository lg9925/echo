import type { TtsAdapter } from "./types";
import { GEMINI_TTS_MODEL } from "../../config";

// Gemini TTS returns raw PCM (16-bit, mono, 24kHz). Wrap it in a WAV container
// so the browser can play it directly via an <audio> element.
function wavFromPcm(pcm: Buffer, sampleRate: number): Buffer {
  const channels = 1;
  const bits = 16;
  const byteRate = sampleRate * channels * (bits / 8);
  const blockAlign = channels * (bits / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

interface GeminiTtsResponse {
  candidates?: {
    content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
  }[];
}

// Gemini TTS via the generateContent API (AUDIO modality + prebuilt voice).
// Uses GEMINI_API_KEY + GEMINI_TTS_MODEL. `voice` is a prebuilt voice name.
export const geminiTtsAdapter: TtsAdapter = {
  name: "gemini",
  async synthesize({ text, voice }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`gemini TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as GeminiTtsResponse;
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) throw new Error("gemini TTS: no audio in response");

    const pcm = Buffer.from(b64, "base64");
    const sampleRate = Number(/rate=(\d+)/.exec(part?.inlineData?.mimeType ?? "")?.[1] ?? 24000);
    return { audio: wavFromPcm(pcm, sampleRate), mime: "audio/wav" };
  },
};
