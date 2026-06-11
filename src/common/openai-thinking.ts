import type { ReasoningEffort } from "../settings";

type ThinkingConfig = {
  type: "enabled" | "disabled";
};

type ThinkingRequestOptions = {
  thinking?: ThinkingConfig;
  extra_body?: {
    reasoning_effort?: ReasoningEffort;
  };
};

export function buildThinkingRequestOptions(
  thinkingEnabled: boolean,
  _baseURL?: string,
  reasoningEffort: ReasoningEffort = "max",
  providerName?: string
): ThinkingRequestOptions | Record<string, unknown> {
  // Return type widens to allow OpenAI's flat format

  if (providerName === "openai") {
    // OpenAI format: reasoning_effort as top-level parameter
    if (thinkingEnabled) {
      return { reasoning_effort: reasoningEffort };
    }
    return {};
  }

  // DeepSeek format (default, backward compatible)
  const thinking: ThinkingConfig = { type: thinkingEnabled ? "enabled" : "disabled" };

  return {
    thinking,
    ...(thinkingEnabled ? { extra_body: { reasoning_effort: reasoningEffort } } : {}),
  };
}
