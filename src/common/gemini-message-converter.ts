import type { SessionMessage } from "../session";
import type { ToolDefinition } from "../prompt";
import { isMultimodalModel } from "./model-capabilities";

// ── Gemini API types — defined inline since no SDK is used ──────────────

export type GeminiContent = {
  role: "user" | "model" | "tool";
  parts: GeminiPart[];
};

export type GeminiPart =
  | { text: string }
  | { thought: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }
  | { inlineData: { mimeType: string; data: string } };

export type GeminiSystemInstruction = {
  parts: Array<{ text: string }>;
};

export type GeminiTool = {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
};

// ── Standalone: convert OpenAI-style ToolDefinition[] → Gemini tool format ──

export function convertToolsToGemini(tools: ToolDefinition[]): GeminiTool[] {
  if (tools.length === 0) return [];
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters as Record<string, unknown>,
      })),
    },
  ];
}

// ── GeminiMessageConverter ──────────────────────────────────────────────

export class GeminiMessageConverter {
  /** Cached system instruction parts extracted from system messages. */
  private systemInstructionParts: Array<{ text: string }> = [];

  constructor() {}

  /**
   * Build Gemini Content array from session messages.
   * System messages are extracted to systemInstructionParts — not included in the array.
   */
  buildMessages(messages: SessionMessage[], thinkingEnabled: boolean, model: string): GeminiContent[] {
    // Reset accumulator — this method can be called multiple times per session.
    this.systemInstructionParts = [];

    const activeMessages = messages.filter((message) => !message.compacted);
    const toolPairings = this.pairToolMessages(activeMessages);
    const result: GeminiContent[] = [];

    for (let index = 0; index < activeMessages.length; index += 1) {
      const message = activeMessages[index];
      if (message.role === "tool") {
        continue; // handled during assistant pairing
      }

      const converted = this.convertMessage(message, thinkingEnabled, model);
      if (converted === null) {
        // system role — accumulated to systemInstructionParts
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
          const toolCallName = this.getToolCallFunctionName(toolCalls[toolCallIndex]) ?? "tool";
          result.push(this.convertToolMessage(activeMessages[pairedToolIndex], toolCallName));
          continue;
        }

        // Unpaired tool call → inject interrupted fallback
        result.push(this.buildInterruptedGeminiFunctionResponse(toolCalls, toolCallId));
      }
    }

    return result;
  }

  /** Returns the accumulated system instruction, or null if no system messages exist. */
  getSystemInstruction(): GeminiSystemInstruction | null {
    if (this.systemInstructionParts.length === 0) return null;
    return { parts: this.systemInstructionParts };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private convertMessage(message: SessionMessage, thinkingEnabled: boolean, model: string): GeminiContent | null {
    if (message.role === "system") {
      // Accumulate to systemInstructionParts — NOT emitted as Content
      if (message.content) {
        this.systemInstructionParts.push({ text: message.content });
      }
      return null;
    }

    if (message.role === "user") {
      const parts: GeminiPart[] = [];

      // Text content
      if (message.content) {
        parts.push({ text: message.content });
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
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
      }

      // Fallback: ensure at least one part
      if (parts.length === 0) {
        parts.push({ text: message.content ?? "" });
      }

      return { role: "user", parts };
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      const messageParams = message.messageParams as
        | {
            tool_calls?: unknown[];
            reasoning_content?: string;
          }
        | null
        | undefined;

      // Thought part (must come first — Gemini puts thinking before text)
      if (thinkingEnabled && typeof messageParams?.reasoning_content === "string") {
        parts.push({ thought: messageParams.reasoning_content });
      }

      // Text content
      if (message.content) {
        parts.push({ text: message.content });
      }

      // Function calls (tool calls)
      if (Array.isArray(messageParams?.tool_calls)) {
        for (const rawToolCall of messageParams.tool_calls) {
          const tc = rawToolCall as {
            id?: string;
            function?: { name?: string; arguments?: string };
          };
          if (tc.function?.name) {
            let args: Record<string, unknown> = {};
            if (typeof tc.function.arguments === "string") {
              try {
                args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch {
                // Fallback: store raw string
                args = { _raw: tc.function.arguments };
              }
            }
            parts.push({
              functionCall: {
                name: tc.function.name,
                args,
              },
            });
          }
        }
      }

      return { role: "model", parts };
    }

    // Fallback: unknown role — treat as user
    return { role: "user", parts: [{ text: message.content ?? "" }] };
  }

  private convertToolMessage(message: SessionMessage, toolName: string): GeminiContent {
    return {
      role: "tool",
      parts: [
        {
          functionResponse: {
            name: toolName,
            response: { content: message.content ?? "" },
          },
        },
      ],
    };
  }

  // ── Tool pairing (copied from AnthropicMessageConverter / OpenAIMessageConverter) ──

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

  private getToolCallFunctionName(toolCall: unknown): string | null {
    if (!toolCall || typeof toolCall !== "object") {
      return null;
    }
    const fn = (toolCall as { function?: { name?: unknown } }).function;
    return typeof fn?.name === "string" && fn.name ? fn.name : null;
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
      const parsed = JSON.parse(message.content) as {
        metadata?: { interrupted?: unknown };
      };
      return parsed.metadata?.interrupted === true;
    } catch {
      return false;
    }
  }

  private buildInterruptedGeminiFunctionResponse(toolCalls: unknown[], toolCallId: string): GeminiContent {
    const toolFunction = this.findToolFunction(toolCalls, toolCallId);
    const toolName =
      toolFunction && typeof toolFunction === "object" && typeof (toolFunction as { name?: unknown }).name === "string"
        ? (toolFunction as { name: string }).name
        : "tool";

    return {
      role: "tool",
      parts: [
        {
          functionResponse: {
            name: toolName,
            response: {
              content: JSON.stringify({
                ok: false,
                name: toolName,
                error: "Previous tool call did not complete.",
                metadata: { interrupted: true },
              }),
            },
          },
        },
      ],
    };
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
