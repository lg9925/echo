import type { TtsAdapter } from "./types";

// STUB. Wire the TODO and set GOOGLE creds, then route to "google" in config.ts.
export const googleTtsAdapter: TtsAdapter = {
  name: "google",
  async synthesize(/* { text, voice, lang } */) {
    // TODO(key): enable with Google Cloud Text-to-Speech —
    //   POST https://texttospeech.googleapis.com/v1/text:synthesize
    //   body: { input:{text}, voice:{languageCode:lang, name:voice}, audioConfig:{audioEncoding:"MP3"} }
    //   auth: API key (?key=) or OAuth bearer; response.audioContent is base64 mp3.
    //   return { audio: Buffer.from(audioContent, "base64"), mime: "audio/mpeg" };
    throw new Error(
      "google TTS adapter is a stub — set Google creds and wire the TODO in tts/adapters/google.ts",
    );
  },
};
