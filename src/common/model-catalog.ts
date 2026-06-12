import type { ModelPricing } from "./model-capabilities";
import { DEFAULT_MODEL_PRICING } from "./model-capabilities";

export type ThinkingEffort = "none" | "low" | "medium" | "high" | "max" | "xhigh";

export type ReasoningType = "effort" | "adaptive" | "extended" | "none";

export type ModelReasoning = {
  type: ReasoningType;
  /** Default effort when thinking is enabled. */
  defaultEffort: ThinkingEffort;
  /** Budget tokens for extended thinking (Claude Haiku). */
  budgetTokens?: number;
};

export type ModelEntry = {
  id: string;
  provider: "deepseek" | "openai" | "anthropic";
  displayName: string;
  reasoning: ModelReasoning;
  contextWindow: number;
  maxOutput: number;
  multimodal: boolean;
  isDefault: boolean;
};

export type ModelCapabilities = ModelEntry & {
  pricing: ModelPricing | null;
};

export const MODEL_CATALOG: ModelEntry[] = [
  // DeepSeek
  {
    id: "deepseek-v4-pro",
    provider: "deepseek",
    displayName: "DeepSeek V4 Pro",
    reasoning: { type: "extended", defaultEffort: "max" },
    contextWindow: 1_000_000,
    maxOutput: 131_072,
    multimodal: true,
    isDefault: true,
  },
  {
    id: "deepseek-v4-flash",
    provider: "deepseek",
    displayName: "DeepSeek V4 Flash",
    reasoning: { type: "extended", defaultEffort: "high" },
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    multimodal: true,
    isDefault: false,
  },
  // OpenAI
  {
    id: "gpt-5.5",
    provider: "openai",
    displayName: "GPT-5.5",
    reasoning: { type: "effort", defaultEffort: "medium" },
    contextWindow: 1_000_000,
    maxOutput: 131_072,
    multimodal: true,
    isDefault: false,
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    displayName: "GPT-5.4",
    reasoning: { type: "effort", defaultEffort: "high" },
    contextWindow: 1_000_000,
    maxOutput: 131_072,
    multimodal: true,
    isDefault: false,
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    displayName: "GPT-5.4 Mini",
    reasoning: { type: "effort", defaultEffort: "high" },
    contextWindow: 400_000,
    maxOutput: 131_072,
    multimodal: true,
    isDefault: false,
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    displayName: "GPT-5.4 Nano",
    reasoning: { type: "effort", defaultEffort: "high" },
    contextWindow: 400_000,
    maxOutput: 131_072,
    multimodal: true,
    isDefault: false,
  },
  // Anthropic
  {
    id: "claude-opus-4-8",
    provider: "anthropic",
    displayName: "Claude Opus 4.8",
    reasoning: { type: "adaptive", defaultEffort: "high" },
    contextWindow: 1_000_000,
    maxOutput: 131_072,
    multimodal: true,
    isDefault: false,
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    displayName: "Claude Sonnet 4.6",
    reasoning: { type: "adaptive", defaultEffort: "high" },
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    multimodal: true,
    isDefault: false,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    reasoning: { type: "extended", defaultEffort: "high", budgetTokens: 16384 },
    contextWindow: 200_000,
    maxOutput: 65_536,
    multimodal: true,
    isDefault: false,
  },
  {
    id: "claude-fable-5",
    provider: "anthropic",
    displayName: "Claude Fable 5",
    reasoning: { type: "adaptive", defaultEffort: "high" },
    contextWindow: 1_000_000,
    maxOutput: 131_072,
    multimodal: true,
    isDefault: false,
  },
  {
    id: "claude-mythos-5",
    provider: "anthropic",
    displayName: "Claude Mythos 5",
    reasoning: { type: "adaptive", defaultEffort: "high" },
    contextWindow: 1_000_000,
    maxOutput: 131_072,
    multimodal: true,
    isDefault: false,
  },
];

/** Thinking options per reasoning type. */
export const THINKING_OPTIONS_BY_TYPE: Record<
  ReasoningType,
  { label: string; effort: ThinkingEffort; thinkingEnabled: boolean }[]
> = {
  effort: [
    { label: "Thinking: xhigh", effort: "xhigh", thinkingEnabled: true },
    { label: "Thinking: high", effort: "high", thinkingEnabled: true },
    { label: "Thinking: medium", effort: "medium", thinkingEnabled: true },
    { label: "Thinking: low", effort: "low", thinkingEnabled: true },
    { label: "Thinking: none", effort: "none", thinkingEnabled: true },
    { label: "No thinking", effort: "high", thinkingEnabled: false },
  ],
  adaptive: [
    { label: "Adaptive: high", effort: "high", thinkingEnabled: true },
    { label: "Adaptive: medium", effort: "medium", thinkingEnabled: true },
    { label: "Adaptive: low", effort: "low", thinkingEnabled: true },
    { label: "No thinking", effort: "high", thinkingEnabled: false },
  ],
  extended: [
    { label: "Thinking: max", effort: "max", thinkingEnabled: true },
    { label: "Thinking: high", effort: "high", thinkingEnabled: true },
    { label: "No thinking", effort: "high", thinkingEnabled: false },
  ],
  none: [{ label: "No thinking", effort: "high", thinkingEnabled: false }],
};

/** Get full capabilities for a model, including pricing. */
export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  const entry = MODEL_CATALOG.find((m) => m.id === modelId);
  if (!entry) return null;
  return { ...entry, pricing: DEFAULT_MODEL_PRICING[modelId] ?? null };
}
