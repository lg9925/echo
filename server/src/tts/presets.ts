// Voice presets live in config.ts (one table for the whole server). Re-exported
// here so the tts module has a local home for any future preset-shaping logic.
export { VOICE_PRESETS, voicePresetFor, type VoicePreset } from "../config";
