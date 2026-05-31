import { makeOpenAICompatibleAdapter } from "./openai";

// Gemini via its OpenAI-compatible endpoint — reuses the same adapter; only the
// key + baseURL differ. Set GEMINI_API_KEY and route a task to "gemini"
// (e.g. LLM_GLOSS_PROVIDER=gemini LLM_GLOSS_MODEL=gemini-2.0-flash).
export const geminiAdapter = makeOpenAICompatibleAdapter({
  name: "gemini",
  apiKeyEnv: "GEMINI_API_KEY",
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});
