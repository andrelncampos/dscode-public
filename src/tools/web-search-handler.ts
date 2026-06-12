import type { ToolExecutionContext, ToolExecutionResult } from "./executor";
import { recordBudgetCost } from "../common/budget-tracker";
import type { ModelUsage } from "../session";
import { getAuxiliaryModel } from "../common/model-catalog";

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

  const auxiliaryModel = getAuxiliaryModel(llmContext.model) ?? llmContext.model;
  return executeNativeWebSearch(query, auxiliaryModel, llmContext.client, context.projectRoot);
}

async function executeNativeWebSearch(
  query: string,
  model: string,
  client: NonNullable<ReturnType<NonNullable<ToolExecutionContext["createOpenAIClient"]>>["client"]>,
  projectRoot: string
): Promise<ToolExecutionResult> {
  const commonParams = {
    model,
    thinking: { type: "disabled" as const },
    temperature: 0.1,
    max_tokens: 4096,
  };

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the web for real-time information",
        parameters: {
          type: "object" as const,
          properties: {
            query: {
              type: "string" as const,
              description: "The search query",
            },
          },
          required: ["query"],
        },
      },
    },
  ];

  try {
    // Round 1: send the search request, get back a tool call
    const r1 = await client.chat.completions.create(
      {
        ...commonParams,
        messages: [{ role: "user" as const, content: `Search the web for: ${query}` }],
        tools,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        signal: AbortSignal.timeout(15000),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any
    );

    if (r1.usage) {
      recordBudgetCost(projectRoot, model, r1.usage as ModelUsage);
    }

    const r1Msg = r1.choices[0]?.message;

    // Round 2: if the model returned a tool call, submit the tool result
    // to the API so DeepSeek executes the native web search and returns results.
    if (r1Msg?.tool_calls?.length) {
      const toolCall = r1Msg.tool_calls[0];

      const r2 = await client.chat.completions.create(
        {
          ...commonParams,
          messages: [
            { role: "user" as const, content: `Search the web for: ${query}` },
            r1Msg,
            {
              role: "tool" as const,
              tool_call_id: toolCall.id,
              content: "executed",
            },
          ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {
          signal: AbortSignal.timeout(15000),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any
      );

      if (r2.usage) {
        recordBudgetCost(projectRoot, model, r2.usage as ModelUsage);
      }

      const content = r2.choices[0]?.message?.content ?? "";
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
    }

    // Fallback: if no tool call was made, try direct content
    const content = r1Msg?.content ?? "";
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
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "WebSearch",
      error: `Web search failed: ${msg}`,
    };
  }
}
