import type { SessionMessage, ModelUsage } from "../session";
import type { ToolDefinition } from "../prompt";

export type LlmStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; arguments: string }
  | { type: "usage"; usage: ModelUsage }
  | { type: "error"; error: unknown };

export type LlmChatOptions = {
  model: string;
  messages: SessionMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  providerOptions?: Record<string, unknown>;
};

export interface ILlmProvider {
  readonly providerName: string;
  supportsModel(model: string): boolean;
  chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent>;
  getTimeoutMs(model: string): number;
  isMultimodal(model: string): boolean;
}
