// BCP-47 language tags for TTS. The native (prompt-side) language is Chinese;
// each target language maps to a region tag the speech engines understand.
// Shared so ShadowPlayer / ReviewSession / VocabView / KeywordExtractor don't
// each keep their own copy. No React.

export const NATIVE_LANG_BCP47 = "zh-CN";

const TARGET_LANG_MAP: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
  fr: "fr-FR",
};

export function targetBcp47(language: string): string {
  return TARGET_LANG_MAP[language] ?? language;
}
