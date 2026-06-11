import type AnthropicSdk from "@anthropic-ai/sdk";
import type { SessionMessage } from "../session";
import type { ToolDefinition } from "../prompt";
import { isMultimodalModel } from "./model-capabilities";

type MessageParam = AnthropicSdk.MessageParam;

// ── Standalone: convert OpenAI-style ToolDefinition[] → Anthropic tool format ──

export function convertToolsToAnthropic(
  tools: ToolDefinition[]
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: {
      type: "object" as const,
      properties: (tool.function.parameters.properties ?? {}) as Record<string, unknown>,
      ...(tool.function.parameters.required && tool.function.parameters.required.length > 0
        ? { required: tool.function.parameters.required }
        : {}),
    },
  }));
}

// ── AnthropicMessageConverter ────────────────────────────────────────────

export class AnthropicMessageConverter {
  /** Cached system prompt extracted from system messages. */
  private systemPrompt: string = "";

  constructor() {}

  /**
   * Build Anthropic MessageParam array from session messages.
   * System messages are extracted to this.systemPrompt — not included in the array.
   */
  buildMessages(messages: SessionMessage[], thinkingEnabled: boolean, model: string): MessageParam[] {
    // Reset accumulator — this method can be called multiple times per session.
    this.systemPrompt = "";

    const activeMessages = messages.filter((message) => !message.compacted);
    const toolPairings = this.pairToolMessages(activeMessages);
    const result: MessageParam[] = [];

    for (let index = 0; index < activeMessages.length; index += 1) {
      const message = activeMessages[index];
      if (message.role === "tool") {
        continue; // handled during assistant pairing
      }

      const converted = this.convertMessage(message, thinkingEnabled, model);
      if (converted === null) {
        // system role — accumulated to systemPrompt
        continue;
      }

      result.push(converted);

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
          result.push(this.convertToolMessage(activeMessages[pairedToolIndex]));
          continue;
        }

        // Unpaired tool call → inject interrupted fallback
        result.push(this.buildInterruptedAnthropicToolResult(toolCalls, toolCallId));
      }
    }

    return result;
  }

  /** Returns the accumulated system prompt from system-role messages. */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private convertMessage(message: SessionMessage, thinkingEnabled: boolean, model: string): MessageParam | null {
    if (message.role === "system") {
      // Accumulate to systemPrompt — NOT emitted as MessageParam
      if (message.content) {
        this.systemPrompt = this.systemPrompt ? `${this.systemPrompt}\n\n${message.content}` : message.content;
      }
      return null;
    }

    if (message.role === "user") {
      const contentBlocks: Record<string, unknown>[] = [];

      // Text content
      if (message.content) {
        contentBlocks.push({ type: "text", text: message.content });
      }

      // Image content from contentParams
      if (message.contentParams && isMultimodalModel(model)) {
        const params = Array.isArray(message.contentParams) ? message.contentParams : [message.contentParams];
        for (const param of params) {
          const part = param as { type?: string; image_url?: { url?: string } };
          if (part?.type === "image_url" && part.image_url?.url) {
            const dataUrl = part.image_url.url;
            // data URL format: data:image/png;base64,<data>
            const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
              contentBlocks.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
      }

      // Fallback: ensure at least one content block
      if (contentBlocks.length === 0) {
        contentBlocks.push({ type: "text", text: message.content ?? "" });
      }

      return { role: "user", content: contentBlocks } as unknown as MessageParam;
    }

    if (message.role === "assistant") {
      const contentBlocks: Record<string, unknown>[] = [];
      const messageParams = message.messageParams as
        | {
            tool_calls?: unknown[];
            reasoning_content?: string;
            signature?: string;
          }
        | null
        | undefined;

      // Thinking block (must come first per Anthropic API)
      if (thinkingEnabled && typeof messageParams?.reasoning_content === "string") {
        contentBlocks.push({
          type: "thinking",
          thinking: messageParams.reasoning_content,
          signature: messageParams.signature ?? "",
        });
      }

      // Text content
      if (message.content) {
        contentBlocks.push({ type: "text", text: message.content });
      }

      // Tool calls
      if (Array.isArray(messageParams?.tool_calls)) {
        for (const rawToolCall of messageParams.tool_calls) {
          const tc = rawToolCall as { id?: string; function?: { name?: string; arguments?: string } };
          if (tc.function?.name) {
            let input: Record<string, unknown> = {};
            if (typeof tc.function.arguments === "string") {
              try {
                input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch {
                // Fallback: store raw string
                input = { _raw: tc.function.arguments };
              }
            }
            contentBlocks.push({
              type: "tool_use",
              id: tc.id ?? "",
              name: tc.function.name,
              input,
            });
          }
        }
      }

      return { role: "assistant", content: contentBlocks } as unknown as MessageParam;
    }

    // Fallback: unknown role — treat as user
    return { role: "user", content: [{ type: "text", text: message.content ?? "" }] } as unknown as MessageParam;
  }

  private convertToolMessage(message: SessionMessage): MessageParam {
    const messageParams = message.messageParams as
      | {
          tool_call_id?: string;
        }
      | null
      | undefined;

    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: messageParams?.tool_call_id ?? "",
          content: message.content ?? "",
        },
      ],
    } as unknown as MessageParam;
  }

  // ── Tool pairing (copied from OpenAIMessageConverter) ───────────────

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

  private buildInterruptedAnthropicToolResult(toolCalls: unknown[], toolCallId: string): MessageParam {
    const toolFunction = this.findToolFunction(toolCalls, toolCallId);
    const toolName =
      toolFunction && typeof toolFunction === "object" && typeof (toolFunction as { name?: unknown }).name === "string"
        ? (toolFunction as { name: string }).name
        : "tool";

    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolCallId,
          content: JSON.stringify({
            ok: false,
            name: toolName,
            error: "Previous tool call did not complete.",
            metadata: { interrupted: true },
          }),
        },
      ],
    } as unknown as MessageParam;
  }

  private findToolFunction(toolCalls: unknown[], toolCallId: string): unknown | null {
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
}
