import { makeOpenAICompatibleAdapter } from "./openai";

// DeepSeek speaks the OpenAI chat-completions protocol; only the baseURL and
// key differ. Flip a task to provider "deepseek" in config.ts to use it.
export const deepseekAdapter = makeOpenAICompatibleAdapter({
  name: "deepseek",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  baseURL: "https://api.deepseek.com",
});
