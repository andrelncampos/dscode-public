import type { ToolExecutionContext, ToolExecutionResult } from "./executor";

const MAX_OUTPUT_CHARS = 30000;

export async function handleWebSearchTool(
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return {
      ok: false,
      name: "WebSearch",
      error: 'Missing required "query" string.',
    };
  }

  const llmContext = context.createOpenAIClient?.();
  if (!llmContext?.client) {
    return {
      ok: false,
      name: "WebSearch",
      error: "LLM client is not available. Check your API key configuration.",
    };
  }

  return executeNativeWebSearch(query, llmContext.model, llmContext.client);
}

async function executeNativeWebSearch(
  query: string,
  model: string,
  client: NonNullable<ReturnType<NonNullable<ToolExecutionContext["createOpenAIClient"]>>["client"]>
): Promise<ToolExecutionResult> {
  try {
    const response = await client.chat.completions.create(
      {
        model,
        messages: [
          {
            role: "user",
            content: `Search the web for: ${query}`,
          },
        ],
        tools: [{ type: "web_search", web_search: {} }],
        temperature: 0.1,
        max_tokens: 4096,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        signal: AbortSignal.timeout(15000),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    const content = response.choices[0]?.message?.content ?? "";
    if (!content.trim()) {
      return {
        ok: false,
        name: "WebSearch",
        error: "Web search returned no results.",
      };
    }

    const truncated = content.length > MAX_OUTPUT_CHARS;
    return {
      ok: true,
      name: "WebSearch",
      output: truncated ? content.slice(0, MAX_OUTPUT_CHARS) : content,
      metadata: { truncated },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "WebSearch",
      error: `Web search failed: ${message}`,
    };
  }
}
