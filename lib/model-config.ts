export type ModelEnvironment = {
  LLM_PROVIDER?: string;
  AISPACE_API_KEY?: string;
  AISPACE_BASE_URL?: string;
  AISPACE_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

export type ModelConfig = {
  provider: "aispace" | "anthropic";
  apiKey: string;
  model: string;
  baseUrl?: string;
};

/** Shared selection keeps the UI status and the answer route consistent. Server-only values. */
export function getModelConfig(environment: ModelEnvironment): ModelConfig | null {
  const provider = environment.LLM_PROVIDER?.trim() || (environment.AISPACE_API_KEY?.trim() ? "aispace" : "anthropic");
  if (provider === "aispace" && environment.AISPACE_API_KEY?.trim()) {
    return { provider, apiKey: environment.AISPACE_API_KEY.trim(), model: environment.AISPACE_MODEL?.trim() || "gpt-6.1-sol", baseUrl: environment.AISPACE_BASE_URL?.trim() || "https://ai.xyspace.dev/v1" };
  }
  if (provider === "anthropic" && environment.ANTHROPIC_API_KEY?.trim()) {
    return { provider, apiKey: environment.ANTHROPIC_API_KEY.trim(), model: environment.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5" };
  }
  return null;
}
