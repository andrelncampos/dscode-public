import type { ChatCompletionMessageParam, ChatCompletionContentPart } from "openai/resources/chat/completions";
import type { SessionMessage } from "../session";
import { isMultimodalModel } from "./model-capabilities";

export type OpenAIMessageConverterOptions = {
  /** Optional callback to render the /init command prompt template. */
  renderInitPrompt?: () => string;
  /** Optional callback to render the /steering-add command prompt template. */
  renderSteeringAddPrompt?: (steeringText: string) => string;
  /** Optional callback to render the /steering-list command prompt template. */
  renderSteeringListPrompt?: () => string;
  /** Optional callback to render the /spec-init command prompt template. */
  renderSpecInitPrompt?: () => string;
  /** Optional callback to render the /spec-plan command prompt template. */
  renderSpecPlanPrompt?: (planText: string) => string;
  /** Optional callback to render the /spec-new command prompt template. */
  renderSpecNewPrompt?: (specNumber: number) => string;
  /** Optional callback to render the /spec-verify command prompt template. */
  renderSpecVerifyPrompt?: (specNumber: number) => string;
  /** Optional callback to render the /spec-implement command prompt template. */
  renderSpecImplementPrompt?: (specNumber: number) => string;
  /** Optional callback to render the /spec-audit command prompt template. */
  renderSpecAuditPrompt?: (specNumber: number) => string;
  /** Optional callback to render the /spec-list command prompt template. */
  renderSpecListPrompt?: () => string;
  /** Optional callback to render the /spec-status command prompt template. */
  renderSpecStatusPrompt?: (specNumber: number | null) => string;
};

/**
 * Converts internal SessionMessage arrays into OpenAI ChatCompletionMessageParam arrays.
 *
 * Handles:
 * - Tool-call / tool-result pairing with interrupt backfill
 * - Thinking-mode reasoning_content injection
 * - Multimodal content (images) filtering by model capability
 * - Compaction filtering
 */
export class OpenAIMessageConverter {
  constructor(private readonly options: OpenAIMessageConverterOptions = {}) {}

  /**
   * Build the OpenAI messages array from session messages, applying compaction
   * filtering, tool pairing, and format conversion.
   */
  buildMessages(messages: SessionMessage[], thinkingEnabled: boolean, model: string): ChatCompletionMessageParam[] {
    const activeMessages = messages.filter((message) => !message.compacted);
    const toolPairings = this.pairToolMessages(activeMessages);
    const openAIMessages: ChatCompletionMessageParam[] = [];

    for (let index = 0; index < activeMessages.length; index += 1) {
      const message = activeMessages[index];
      if (message.role === "tool") {
        continue;
      }

      openAIMessages.push(this.convertMessage(message, thinkingEnabled, model));

      const toolCalls = this.getAssistantToolCalls(message);
      if (toolCalls.length === 0) {
        continue;
      }

      for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
        const toolCallId = this.getToolCallId(toolCalls[toolCallIndex]);
        if (!toolCallId) {
          continue;
        }

        const pairedToolIndex = toolPairings.get(this.buildToolPairingKey(index, toolCallIndex));
        if (pairedToolIndex != null) {
          openAIMessages.push(this.convertMessage(activeMessages[pairedToolIndex], thinkingEnabled, model));
          continue;
        }

        openAIMessages.push(this.buildInterruptedOpenAIToolMessage(toolCalls, toolCallId));
      }
    }

    return openAIMessages;
  }

  /**
   * Returns the trailing assistant message with pending (unexecuted) tool calls,
   * if one exists at the end of the conversation.
   */
  getTrailingPendingToolCallMessage(
    messages: SessionMessage[]
  ): { message: SessionMessage; toolCalls: unknown[] } | { message: null; toolCalls: [] } {
    const activeMessages = messages.filter((message) => !message.compacted);
    const latestMessage = activeMessages[activeMessages.length - 1];
    if (!latestMessage || latestMessage.role !== "assistant") {
      return { message: null, toolCalls: [] };
    }

    const toolCalls = this.getAssistantToolCalls(latestMessage);
    if (toolCalls.length === 0) {
      return { message: null, toolCalls: [] };
    }
    return {
      message: latestMessage,
      toolCalls: toolCalls.filter((toolCall) => Boolean(this.getToolCallId(toolCall))),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private convertMessage(message: SessionMessage, thinkingEnabled: boolean, model: string): ChatCompletionMessageParam {
    const content = this.renderContent(message);
    const base: ChatCompletionMessageParam = {
      role: message.role,
      content,
    } as ChatCompletionMessageParam;

    const messageParams = message.messageParams as
      | { tool_calls?: unknown[]; tool_call_id?: string; reasoning_content?: string }
      | null
      | undefined;
    if (messageParams?.tool_calls) {
      (base as { tool_calls?: unknown[] }).tool_calls = messageParams.tool_calls;
    }
    if (messageParams?.tool_call_id) {
      (base as { tool_call_id?: string }).tool_call_id = messageParams.tool_call_id;
    }
    if (typeof messageParams?.reasoning_content === "string") {
      (base as { reasoning_content?: string }).reasoning_content = messageParams.reasoning_content;
    } else if (thinkingEnabled && message.role === "assistant") {
      (base as { reasoning_content?: string }).reasoning_content = "";
    }

    const supportsMultimodal = isMultimodalModel(model);
    if ((message.role === "user" || message.role === "system") && message.contentParams) {
      const contentParts: ChatCompletionContentPart[] = [];
      if (content) {
        contentParts.push({ type: "text", text: content });
      }
      const params = Array.isArray(message.contentParams) ? message.contentParams : [message.contentParams];
      for (const param of params) {
        const part = param as ChatCompletionContentPart;
        if (!part) {
          continue;
        }
        if (!supportsMultimodal && part.type === "image_url") {
          continue;
        }
        contentParts.push(part);
      }
      const contentValue: string | ChatCompletionContentPart[] = contentParts.length > 0 ? contentParts : content;
      (base as { content: string | ChatCompletionContentPart[] }).content = contentValue;
    }

    return base;
  }

  private renderContent(message: SessionMessage): string {
    if (message.role === "user" && message.content === "/init") {
      return this.options.renderInitPrompt?.() ?? "";
    }
    if (message.role === "user") {
      const steeringAddMatch = message.content?.match(/^\/steering-add\s+(.+)$/s);
      if (steeringAddMatch) {
        return this.options.renderSteeringAddPrompt?.(steeringAddMatch[1].trim()) ?? "";
      }
    }
    if (message.role === "user" && message.content === "/steering-list") {
      return this.options.renderSteeringListPrompt?.() ?? "";
    }
    if (message.role === "user" && message.content === "/spec-init") {
      return this.options.renderSpecInitPrompt?.() ?? "";
    }
    if (message.role === "user") {
      const specPlanMatch = message.content?.match(/^\/spec-plan(?:\s+(.+))?$/s);
      if (specPlanMatch) {
        return this.options.renderSpecPlanPrompt?.(specPlanMatch[1]?.trim() ?? "") ?? "";
      }
    }
    if (message.role === "user") {
      const specNewMatch = message.content?.match(/^\/spec-new\s+(\d+)$/);
      if (specNewMatch) {
        return this.options.renderSpecNewPrompt?.(parseInt(specNewMatch[1], 10)) ?? "";
      }
    }
    if (message.role === "user") {
      const specVerifyMatch = message.content?.match(/^\/spec-verify\s+(\d+)$/);
      if (specVerifyMatch) {
        return this.options.renderSpecVerifyPrompt?.(parseInt(specVerifyMatch[1], 10)) ?? "";
      }
    }
    if (message.role === "user") {
      const specImplementMatch = message.content?.match(/^\/spec-implement\s+(\d+)$/);
      if (specImplementMatch) {
        return this.options.renderSpecImplementPrompt?.(parseInt(specImplementMatch[1], 10)) ?? "";
      }
    }
    if (message.role === "user") {
      const specAuditMatch = message.content?.match(/^\/spec-audit\s+(\d+)$/);
      if (specAuditMatch) {
        return this.options.renderSpecAuditPrompt?.(parseInt(specAuditMatch[1], 10)) ?? "";
      }
    }
    if (message.role === "user" && message.content === "/spec-list") {
      return this.options.renderSpecListPrompt?.() ?? "";
    }
    if (message.role === "user") {
      const specStatusMatch = message.content?.match(/^\/spec-status(?:\s+(\d+))?$/);
      if (specStatusMatch) {
        const specNum = specStatusMatch[1] ? parseInt(specStatusMatch[1], 10) : null;
        return this.options.renderSpecStatusPrompt?.(specNum) ?? "";
      }
    }
    return message.content ?? "";
  }

  private pairToolMessages(messages: SessionMessage[]): Map<string, number> {
    const pairings = new Map<string, number>();
    const usedToolMessageIndexes = new Set<number>();

    for (let assistantIndex = 0; assistantIndex < messages.length; assistantIndex += 1) {
      const toolCalls = this.getAssistantToolCalls(messages[assistantIndex]);
      for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex += 1) {
        const toolCallId = this.getToolCallId(toolCalls[toolCallIndex]);
        if (!toolCallId) {
          continue;
        }

        const toolIndex = this.findPairableToolMessageIndex(
          messages,
          assistantIndex,
          toolCallId,
          usedToolMessageIndexes
        );
        if (toolIndex == null) {
          continue;
        }

        usedToolMessageIndexes.add(toolIndex);
        pairings.set(this.buildToolPairingKey(assistantIndex, toolCallIndex), toolIndex);
      }
    }

    return pairings;
  }

  private findPairableToolMessageIndex(
    messages: SessionMessage[],
    assistantIndex: number,
    toolCallId: string,
    usedToolMessageIndexes: Set<number>
  ): number | null {
    let firstMatchingIndex: number | null = null;
    for (let index = assistantIndex + 1; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role !== "tool" || usedToolMessageIndexes.has(index)) {
        continue;
      }

      const candidateToolCallId = this.getToolMessageCallId(message);
      if (candidateToolCallId !== toolCallId) {
        continue;
      }

      if (firstMatchingIndex == null) {
        firstMatchingIndex = index;
      }
      if (!this.isInterruptedToolMessage(message)) {
        return index;
      }
    }
    return firstMatchingIndex;
  }

  private getAssistantToolCalls(message: SessionMessage): unknown[] {
    if (message.role !== "assistant") {
      return [];
    }
    const messageParams = message.messageParams as { tool_calls?: unknown[] } | null;
    return Array.isArray(messageParams?.tool_calls) ? messageParams.tool_calls : [];
  }

  private getToolCallId(toolCall: unknown): string | null {
    if (!toolCall || typeof toolCall !== "object") {
      return null;
    }
    const id = (toolCall as { id?: unknown }).id;
    return typeof id === "string" && id ? id : null;
  }

  private getToolMessageCallId(message: SessionMessage): string | null {
    const messageParams = message.messageParams as { tool_call_id?: unknown } | null;
    const toolCallId = messageParams?.tool_call_id;
    return typeof toolCallId === "string" && toolCallId ? toolCallId : null;
  }

  private buildToolPairingKey(assistantIndex: number, toolCallIndex: number): string {
    return `${assistantIndex}:${toolCallIndex}`;
  }

  private isInterruptedToolMessage(message: SessionMessage): boolean {
    if (typeof message.content !== "string" || !message.content.trim()) {
      return false;
    }
    try {
      const parsed = JSON.parse(message.content) as { metadata?: { interrupted?: unknown } };
      return parsed.metadata?.interrupted === true;
    } catch {
      return false;
    }
  }

  private buildInterruptedOpenAIToolMessage(toolCalls: unknown[], toolCallId: string): ChatCompletionMessageParam {
    const toolFunction = this.findToolFunction(toolCalls, toolCallId);
    return {
      role: "tool",
      content: this.buildInterruptedToolResult(toolFunction, "Previous tool call did not complete."),
      tool_call_id: toolCallId,
    } as ChatCompletionMessageParam;
  }

  /** Exposed for use by appendToolMessages in SessionManager. */
  findToolFunction(toolCalls: unknown[], toolCallId: string): unknown | null {
    for (const toolCall of toolCalls) {
      if (!toolCall || typeof toolCall !== "object") {
        continue;
      }
      const record = toolCall as { id?: unknown; function?: unknown };
      if (record.id === toolCallId) {
        return record.function ?? null;
      }
    }
    return null;
  }

  private buildInterruptedToolResult(toolFunction: unknown | null, reason: string): string {
    const toolName =
      toolFunction && typeof toolFunction === "object" && typeof (toolFunction as { name?: unknown }).name === "string"
        ? (toolFunction as { name: string }).name
        : "tool";
    return JSON.stringify(
      {
        ok: false,
        name: toolName,
        error: reason,
        metadata: {
          interrupted: true,
        },
      },
      null,
      2
    );
  }
}
