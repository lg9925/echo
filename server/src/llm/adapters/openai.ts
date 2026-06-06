import OpenAI from "openai";
import type { LlmProvider } from "../../config";
import type { LlmAdapter } from "./types";

// One factory for every OpenAI-compatible vendor (OpenAI itself, DeepSeek, and
// later a local Ollama on its own baseURL). Only the key + baseURL differ.
export function makeOpenAICompatibleAdapter(opts: {
  name: LlmProvider;
  apiKeyEnv: string;
  baseURL?: string;
}): LlmAdapter {
  let client: OpenAI | null = null;
  const getClient = (): OpenAI => {
    const apiKey = process.env[opts.apiKeyEnv];
    if (!apiKey) throw new Error(`${opts.apiKeyEnv} is not set`);
    if (!client) client = new OpenAI({ apiKey, baseURL: opts.baseURL });
    return client;
  };
  return {
    name: opts.name,
    async complete({ system, user, model, maxTokens }) {
      const res = await getClient().chat.completions.create({
        model,
        max_tokens: maxTokens,
        // Every task on this layer asks for a JSON object — force JSON mode so
        // the model can't break parsing with stray quotes/newlines. (Our prompts
        // all contain the word "JSON", which OpenAI-style endpoints require for
        // this mode. The one plain-text task, einb_literal, runs on claude-cli.)
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      return res.choices[0]?.message?.content ?? "";
    },
  };
}

// OPENAI_BASE_URL lets the same adapter point at an OpenAI-compatible gateway
// (OpenRouter, Azure-style proxy, …) without a new adapter file.
export const openaiAdapter = makeOpenAICompatibleAdapter({
  name: "openai",
  apiKeyEnv: "OPENAI_API_KEY",
  baseURL: process.env.OPENAI_BASE_URL,
});
