import type { LlmProvider } from "../../config";

export interface LlmCompleteParams {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
}

// Adapters do exactly one thing: forward a (system,user) pair to a vendor and
// return the raw text. No prompts, no parsing, no schema — those live in core.
export interface LlmAdapter {
  readonly name: LlmProvider;
  complete(params: LlmCompleteParams): Promise<string>;
  /**
   * Optional streaming variant: calls `onText` with the accumulated text as it
   * arrives, and resolves with the final full text. Providers that don't
   * implement it fall back to the non-streaming path (one final chunk).
   */
  completeStream?(
    params: LlmCompleteParams,
    onText: (textSoFar: string) => void,
  ): Promise<string>;
}
