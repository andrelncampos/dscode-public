import { GeminiMessageConverter, convertToolsToGemini } from "../common/gemini-message-converter";
import { DEFAULT_API_TIMEOUT_MS, PRO_API_TIMEOUT_MS } from "../common/api-timeout";
import type { ILlmProvider, LlmStreamEvent, LlmChatOptions } from "../common/llm-provider";
import type { ModelUsage } from "../session";
import { withRetry } from "../common/api-retry";
import { createGeminiClient } from "../common/gemini-client";

const GEMINI_MODEL_PREFIX = "gemini-";
const GEMINI_PRO_MODEL_PATTERN = /^gemini-2\.5-pro/;

export class GeminiProvider implements ILlmProvider {
  readonly providerName = "gemini";

  constructor() {}

  supportsModel(model: string): boolean {
    return model.toLowerCase().startsWith(GEMINI_MODEL_PREFIX);
  }

  getTimeoutMs(model: string): number {
    if (GEMINI_PRO_MODEL_PATTERN.test(model.toLowerCase())) {
      return PRO_API_TIMEOUT_MS; // 300_000 for Pro models
    }
    return DEFAULT_API_TIMEOUT_MS; // 180_000
  }

  isMultimodal(_model: string): boolean {
    return true; // All Gemini text models support image inputs
  }

  getCheapModel(model: string): string | null {
    switch (model) {
      case "gemini-3.5-flash":
        return "gemini-3.1-flash-lite";
      case "gemini-3-flash":
        return "gemini-3.1-flash-lite";
      case "gemini-2.5-pro":
        return "gemini-2.5-flash";
      case "gemini-2.5-flash":
        return "gemini-3.1-flash-lite";
      case "gemini-3.1-flash-lite":
        return null;
      default: {
        if (model.toLowerCase().startsWith("gemini-")) return "gemini-3.1-flash-lite";
        return null;
      }
    }
  }

  async *chat(options: LlmChatOptions): AsyncIterable<LlmStreamEvent> {
    const config = createGeminiClient(process.cwd(), "gemini");

    if (!config.apiKey) {
      throw new Error("Gemini API key not configured");
    }

    const providerOpts = options.providerOptions as { thinkingEnabled?: boolean } | undefined;
    const thinkingEnabled = providerOpts?.thinkingEnabled ?? false;

    // Build Gemini messages — fresh converter per call avoids state leakage
    const converter = new GeminiMessageConverter();
    const geminiContents = converter.buildMessages(options.messages, thinkingEnabled, options.model);
    const systemInstruction = converter.getSystemInstruction();

    // Convert tools to Gemini format
    const geminiTools = options.tools && options.tools.length > 0 ? convertToolsToGemini(options.tools) : undefined;

    // Build request body
    const generationConfig: Record<string, unknown> = {};

    if (thinkingEnabled) {
      generationConfig.thinkingConfig = {
        thinkingBudget: 8192,
        includeThoughts: true,
      };
    }
    if (options.temperature !== undefined && !thinkingEnabled) {
      generationConfig.temperature = options.temperature;
    }
    if ((options.maxTokens ?? 0) > 0) {
      generationConfig.maxOutputTokens = options.maxTokens;
    }

    const requestBody: Record<string, unknown> = {
      contents: geminiContents,
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }
    if (geminiTools) {
      requestBody.tools = geminiTools;
    }
    if (Object.keys(generationConfig).length > 0) {
      requestBody.generationConfig = generationConfig;
    }

    // Build streaming URL
    const url = `${config.baseURL}/models/${options.model}:streamGenerateContent?alt=sse`;

    // Use withRetry for transient failures
    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutMs = this.getTimeoutMs(options.model);
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        // Combine user signal with timeout
        if (options.signal) {
          options.signal.addEventListener("abort", () => controller.abort(), { once: true });
        }

        try {
          const resp = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": config.apiKey!,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const errorText = await resp.text().catch(() => "");
            throw new Error(`Gemini API error ${resp.status}: ${errorText}`);
          }

          if (!resp.body) {
            throw new Error("Gemini API returned empty response body");
          }

          return resp.body;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      { userSignal: options.signal }
    );

    // Convert ReadableStream to SSE events
    yield* this.streamToEvents(response, options.signal);
  }

  private async *streamToEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<LlmStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";
    let accumulatedThought = "";
    let currentToolCallId = "";
    let currentToolCallName = "";
    let accumulatedToolArgs = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        // Check abort signal
        if (signal?.aborted) {
          yield { type: "error", error: new DOMException("Aborted", "AbortError") };
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          // Strip \r (handle \r\n line endings) and skip non-data lines
          const trimmed = line.replace(/\r$/, "");
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6).trim();
          if (data === "" || data === "[DONE]") continue;

          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(data);
          } catch {
            console.warn("Gemini SSE: failed to parse JSON chunk:", data.slice(0, 200));
            continue;
          }

          // Check for safety filter block
          const promptFeedback = chunk.promptFeedback as Record<string, unknown> | undefined;
          if (promptFeedback?.blockReason) {
            yield {
              type: "error",
              error: new Error(`Content blocked: ${promptFeedback.blockReason}`),
            };
            return;
          }

          // Check finish reason for safety
          const candidates = chunk.candidates as Array<Record<string, unknown>> | undefined;
          if (candidates?.[0]?.finishReason === "SAFETY") {
            yield {
              type: "error",
              error: new Error(`Response blocked by safety filter`),
            };
            return;
          }

          // Process parts from candidates[0].content.parts[]
          const parts = (candidates?.[0]?.content as Record<string, unknown>)?.parts as
            | Array<Record<string, unknown>>
            | undefined;
          if (!parts) continue;

          for (const part of parts) {
            if (typeof part.text === "string" && part.text.length > 0) {
              const textDelta = part.text.slice(accumulatedText.length);
              if (textDelta.length > 0) {
                accumulatedText += textDelta;
                yield { type: "text_delta", text: textDelta };
              }
            }

            if (typeof part.thought === "string" && part.thought.length > 0) {
              const thoughtDelta = part.thought.slice(accumulatedThought.length);
              if (thoughtDelta.length > 0) {
                accumulatedThought += thoughtDelta;
                yield { type: "reasoning_delta", text: thoughtDelta };
              }
            }

            if (part.functionCall && typeof part.functionCall === "object") {
              const fc = part.functionCall as Record<string, unknown>;
              if (typeof fc.name === "string" && fc.name !== currentToolCallName) {
                // New tool call — generate ID
                currentToolCallId = `gemini-tc-${crypto.randomUUID()}`;
                currentToolCallName = fc.name as string;
                accumulatedToolArgs = "";
                yield {
                  type: "tool_call_start",
                  id: currentToolCallId,
                  name: currentToolCallName,
                };
              }

              if (fc.args && typeof fc.args === "object") {
                const newArgs = JSON.stringify(fc.args);
                if (newArgs !== accumulatedToolArgs) {
                  const argsDelta = newArgs.slice(accumulatedToolArgs.length);
                  accumulatedToolArgs = newArgs;
                  if (argsDelta.length > 0) {
                    yield {
                      type: "tool_call_delta",
                      id: currentToolCallId,
                      arguments: argsDelta,
                    };
                  }
                }
              }
            }
          }

          // Extract usage metadata
          const usageMetadata = chunk.usageMetadata as Record<string, number> | undefined;
          if (usageMetadata) {
            inputTokens = usageMetadata.promptTokenCount ?? inputTokens;
            outputTokens = usageMetadata.candidatesTokenCount ?? outputTokens;
            const usage: ModelUsage = {
              prompt_tokens: inputTokens,
              completion_tokens: outputTokens,
              total_tokens: inputTokens + outputTokens,
            };
            yield { type: "usage", usage };
          }
        }
      }

      // Flush remaining buffer
      if (buffer.startsWith("data: ")) {
        const data = buffer.slice(6).trim();
        if (data !== "" && data !== "[DONE]") {
          try {
            const chunk = JSON.parse(data);
            const usageMetadata = chunk.usageMetadata as Record<string, number> | undefined;
            if (usageMetadata) {
              const usage: ModelUsage = {
                prompt_tokens: usageMetadata.promptTokenCount ?? inputTokens,
                completion_tokens: usageMetadata.candidatesTokenCount ?? outputTokens,
                total_tokens:
                  (usageMetadata.promptTokenCount ?? inputTokens) +
                  (usageMetadata.candidatesTokenCount ?? outputTokens),
              };
              yield { type: "usage", usage };
            }
          } catch {
            // Ignore malformed final line
          }
        }
      }
    } catch (error) {
      yield { type: "error", error };
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}
