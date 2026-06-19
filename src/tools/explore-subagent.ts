import type OpenAI from "openai";
import type { ToolCall, ToolExecutionResult, CreateOpenAIClient, ToolHandler } from "./executor";
import type { ToolDefinition } from "../prompt";
import { recordBudgetCostWithCache } from "../common/budget-tracker";
import type { ModelUsage } from "../session";
import type { SkillInfo } from "../session";
import { getAuxiliaryModel } from "../common/model-catalog";
import { handleReadTool } from "./read-handler";
import { handleGrepTool } from "./grep-handler";
import { handleGlobTool } from "./glob-handler";
import { handleWriteTool } from "./write-handler";
import { handleEditTool } from "./edit-handler";
import { handleBashTool } from "./bash-handler";
import { handleWebSearchTool } from "./web-search-handler";
import { handleWebFetchTool } from "./web-fetch-handler";
import * as crypto from "node:crypto";
import { getBuiltInToolDefinitions } from "../prompt";
import { getErrorMessage } from "../common/error-utils.js";

export type ExploreSubagentOptions = {
  query: string;
  thoroughness: "quick" | "medium" | "thorough";
  projectRoot: string;
  client: OpenAI;
  model: string;
  sessionId: string;
};

export type SubagentOptions = {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  toolHandlers: Record<string, ToolHandler>;
  projectRoot: string;
  client: OpenAI;
  model: string;
  sessionId: string;
  thinking: { type: "enabled" | "disabled" };
  temperature: number;
  maxTurns: number;
  maxTokens: number;
  overallTimeoutMs: number;
};

type ThoroughnessConfig = {
  maxTurns: number;
  maxTokens: number;
  overallTimeoutMs: number;
  systemPromptSuffix: string;
};

const THOROUGHNESS_CONFIGS: Record<string, ThoroughnessConfig> = {
  quick: {
    maxTurns: 5,
    maxTokens: 2048,
    overallTimeoutMs: 30000,
    systemPromptSuffix:
      "\n\n## Mode: Quick\nBe fast. Find the answer in 1-3 tool calls. Return a 1-3 sentence summary.",
  },
  medium: {
    maxTurns: 10,
    maxTokens: 4096,
    overallTimeoutMs: 60000,
    systemPromptSuffix: "\n\n## Mode: Medium\nBe thorough but efficient. Explore the most relevant files.",
  },
  thorough: {
    maxTurns: 25,
    maxTokens: 8192,
    overallTimeoutMs: 120000,
    systemPromptSuffix:
      "\n\n## Mode: Thorough\nBe very thorough. Explore all relevant files, dependencies, and edge cases. Map out the full picture.",
  },
};

const EXPLORE_SYSTEM_PROMPT = `You are a read-only codebase explorer. Your job is to search, read, and analyze code to answer exploration questions.

## Tools
- **Read**: Read file contents. Use this to inspect files you find.
- **Grep**: Search file contents by regex pattern. Use this to find where functions, classes, or patterns are defined.
- **Glob**: Find files by glob pattern. Use this to discover file structure.

## Rules
1. You CANNOT write, edit, or execute code. You are read-only.
2. Prefer Grep and Glob to discover files, then Read to inspect them.
3. Do NOT read files you don't need — be targeted.
4. Return a CONCISE summary (under 500 words) of what you found.
5. Structure your summary clearly: list files, key findings, and relationships.
6. If you cannot find something, say so explicitly rather than guessing.
7. Do NOT include the exploration process in your final response — only the findings.`;

const READONLY_TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "read",
      description: "Read files from the filesystem (text, images, PDFs, notebooks).",
      parameters: {
        type: "object" as const,
        properties: {
          file_path: { type: "string" as const, description: "UNIX-style path to file" },
          offset: { type: "number" as const, description: "Line number to start reading from" },
          limit: { type: "number" as const, description: "Number of lines to read" },
          pages: {
            type: "string" as const,
            description: 'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files.',
          },
        },
        required: ["file_path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grep",
      description:
        "Search file contents within the project workspace using a regex pattern. Respects .gitignore and auto-excludes node_modules, .git, dist, etc. Returns matching file paths, line numbers, and line content as a JSON array. Prefer this over bash grep/rg for searching file contents.",
      parameters: {
        type: "object" as const,
        properties: {
          pattern: {
            type: "string" as const,
            description: "Regex pattern to search for in file contents (e.g., 'TODO', 'import.*from').",
          },
          path: {
            type: "string" as const,
            description:
              "Optional file or directory path relative to project root to search within (default: entire project).",
          },
          glob: {
            type: "string" as const,
            description: "Optional glob pattern to filter which files to search (e.g., '*.ts', 'src/**/*.tsx').",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "glob",
      description:
        "Search for files matching a glob pattern (e.g., 'src/**/*.ts', '*.test.ts'). Respects .gitignore and auto-excludes node_modules, .git, dist, etc. Returns matching relative file paths as a JSON array. Prefer this over bash ls/find.",
      parameters: {
        type: "object" as const,
        properties: {
          pattern: {
            type: "string" as const,
            description:
              "Glob pattern to match (e.g., '**/*.ts', 'src/**/*.tsx'). If the pattern has no directory component it matches in any directory.",
          },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
  },
];

const READONLY_TOOL_HANDLERS: Record<string, ToolHandler> = {
  read: handleReadTool,
  grep: handleGrepTool,
  glob: handleGlobTool,
};

const SKILL_TOOL_HANDLER_MAP: Record<string, ToolHandler> = {
  read: handleReadTool,
  grep: handleGrepTool,
  glob: handleGlobTool,
  write: handleWriteTool,
  edit: handleEditTool,
  bash: handleBashTool,
  web_search: handleWebSearchTool,
  web_fetch: handleWebFetchTool,
};

async function executeSubagentTool(
  toolCall: ToolCall,
  sessionId: string,
  projectRoot: string,
  handlers: Record<string, ToolHandler> = READONLY_TOOL_HANDLERS
): Promise<ToolExecutionResult> {
  const handler = handlers[toolCall.function.name];
  if (!handler) {
    return { ok: false, name: toolCall.function.name, error: `Unknown tool: ${toolCall.function.name}` };
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { ok: false, name: toolCall.function.name, error: "Failed to parse tool arguments." };
  }
  return handler(args, {
    sessionId,
    projectRoot,
    toolCall,
  });
}

export async function runSubagent(opts: SubagentOptions): Promise<string> {
  try {
    const messages: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: string }> = [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userPrompt },
    ];

    const toolCountMap = new Map<string, number>();
    const overallStart = Date.now();

    for (let turn = 0; turn < opts.maxTurns; turn++) {
      const remainingTimeoutMs = opts.overallTimeoutMs - (Date.now() - overallStart);
      if (remainingTimeoutMs <= 0) {
        return `Explore error: Exploration timed out after ${Math.round(opts.overallTimeoutMs / 1000)} seconds.`;
      }

      const perCallSignal = AbortSignal.timeout(Math.min(15000, remainingTimeoutMs));

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const response = await opts.client.chat.completions.create(
        {
          model: opts.model,
          messages: messages as any,
          tools: opts.tools as any,
          thinking: opts.thinking,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
        } as any,
        {
          signal: perCallSignal,
        } as any
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */

      if (response.usage) {
        recordBudgetCostWithCache(opts.projectRoot, opts.model, response.usage as ModelUsage);
      }

      const choice = response.choices?.[0];
      const message = choice?.message;
      if (!message) {
        return "Explore error: Subagent returned no response.";
      }

      const hasToolCalls = message.tool_calls && message.tool_calls.length > 0;
      const hasContent = typeof message.content === "string" && message.content.trim().length > 0;

      if (hasToolCalls) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages.push(message as any);
        for (const tc of message.tool_calls!) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tcAny = tc as any;
          const tcFunc = tcAny.function ?? {};
          const result = await executeSubagentTool(
            {
              id: tcAny.id,
              type: "function",
              function: { name: tcFunc.name ?? "", arguments: tcFunc.arguments ?? "{}" },
            },
            opts.sessionId,
            opts.projectRoot,
            opts.toolHandlers
          );
          const toolName: string = tcFunc.name ?? "";
          toolCountMap.set(toolName, (toolCountMap.get(toolName) ?? 0) + 1);
          messages.push({
            role: "tool",
            tool_call_id: tcAny.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      if (hasContent && choice.finish_reason !== "tool_calls") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages.push(message as any);
        return message.content as string;
      }

      if (choice.finish_reason === "length") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages.push(message as any);
        if (hasContent) {
          return message.content as string;
        }
        continue;
      }

      // Neither content nor tool_calls — append and continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages.push(message as any);
    }

    // Max turns reached
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 0);
    if (lastAssistant) {
      return lastAssistant.content as string;
    }

    const toolsWithCounts = Array.from(toolCountMap.entries()).filter(([, count]) => count > 0);
    if (toolsWithCounts.length > 0) {
      return (
        "Exploration complete. Tools called: " +
        JSON.stringify(toolsWithCounts.map(([tool, count]) => ({ tool, count })))
      );
    }

    return "Explore error: No results produced.";
  } catch (error) {
    const msg = getErrorMessage(error);
    return `Explore error: ${msg}`;
  }
}

export async function runExploreSubagent(opts: ExploreSubagentOptions): Promise<string> {
  if (!opts.query.trim()) {
    return "Explore error: Missing required 'query' string.";
  }
  const thoroughness = THOROUGHNESS_CONFIGS[opts.thoroughness] ? opts.thoroughness : "medium";
  const config = THOROUGHNESS_CONFIGS[thoroughness];

  return runSubagent({
    systemPrompt: EXPLORE_SYSTEM_PROMPT + config.systemPromptSuffix,
    userPrompt: `Explore the codebase: ${opts.query}`,
    tools: READONLY_TOOL_DEFINITIONS,
    toolHandlers: READONLY_TOOL_HANDLERS,
    projectRoot: opts.projectRoot,
    client: opts.client,
    model: opts.model,
    sessionId: opts.sessionId,
    thinking: { type: "disabled" },
    temperature: 0,
    maxTurns: config.maxTurns,
    maxTokens: config.maxTokens,
    overallTimeoutMs: config.overallTimeoutMs,
  });
}

export async function handleExploreToolCall(
  toolCall: ToolCall,
  createOpenAIClient: CreateOpenAIClient,
  projectRoot: string
): Promise<ToolExecutionResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { ok: false, name: "Explore", error: "Failed to parse Explore arguments." };
  }

  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return { ok: false, name: "Explore", error: "Missing required 'query' string." };
  }

  let thoroughness: "quick" | "medium" | "thorough" = "medium";
  if (typeof args.thoroughness === "string" && ["quick", "medium", "thorough"].includes(args.thoroughness)) {
    thoroughness = args.thoroughness as "quick" | "medium" | "thorough";
  }

  const llmContext = createOpenAIClient();
  if (!llmContext?.client) {
    return { ok: false, name: "Explore", error: "LLM client is not available. Check your API key configuration." };
  }

  const auxiliaryModel = getAuxiliaryModel(llmContext.model) ?? llmContext.model;
  const subagentSessionId = `explore-${crypto.randomUUID()}`;

  const summary = await runExploreSubagent({
    query,
    thoroughness,
    projectRoot,
    client: llmContext.client,
    model: auxiliaryModel,
    sessionId: subagentSessionId,
  });

  if (summary.startsWith("Explore error:")) {
    return { ok: false, name: "Explore", error: summary };
  }

  return { ok: true, name: "Explore", output: summary };
}

export type SkillSubagentOptions = {
  skill: SkillInfo;
  prompt: string;
  projectRoot: string;
  createOpenAIClient: CreateOpenAIClient;
  mcpToolDefinitions?: ToolDefinition[];
  mcpToolHandler?: ToolHandler;
};

function buildSkillSystemPrompt(skill: SkillInfo): string {
  const toolNames = skill.agentTools?.length
    ? skill.agentTools.join(", ")
    : "read, grep, glob, write, edit, bash, web_search, web_fetch";

  let prompt = `You are an agent skill named "${skill.name}". You run in an isolated sub-conversation. Only your final result is returned to the main conversation.

## Your Purpose
${skill.description}

## Tools Available
You have access to the following tools: ${toolNames}.`;

  if (skill.mcpServers && Object.keys(skill.mcpServers).length > 0) {
    const mcpNames = Object.keys(skill.mcpServers);
    prompt += `\nMCP tools (from this skill's servers: ${mcpNames.join(", ")}).\nUse them by name with full mcp__ prefix.`;
  }

  prompt += `

## Rules
1. Complete the task assigned to you.
2. Work step by step and keep track of your progress.
3. Return a clear, concise result.
4. If you encounter an error, explain what went wrong and what you tried.`;

  if (skill.agentThinking === "disabled") {
    prompt += "\n\n## Thinking\nThinking is disabled. Work directly and efficiently.";
  } else {
    prompt += "\n\n## Thinking\nThinking is enabled. Think carefully before each action.";
  }

  return prompt;
}

export async function runSkillSubagent(opts: SkillSubagentOptions): Promise<string> {
  const skill = opts.skill;
  const systemPrompt = buildSkillSystemPrompt(skill);

  // Determine model: agentModel from SKILL.md or auxiliary model
  const llmContext = opts.createOpenAIClient();
  if (!llmContext?.client) {
    return `Skill error: LLM client is not available. Check your API key configuration.`;
  }

  let model: string;
  if (skill.agentModel && skill.agentModel.trim()) {
    model = skill.agentModel.trim();
  } else {
    model = getAuxiliaryModel(llmContext.model) ?? llmContext.model;
  }

  // Determine thinking
  const thinking = skill.agentThinking === "enabled" ? ({ type: "enabled" } as const) : ({ type: "disabled" } as const);

  // Determine tools
  const allBuiltInTools = getBuiltInToolDefinitions();

  let whitelist: Set<string> | undefined;
  if (skill.agentTools && skill.agentTools.length > 0) {
    // Validate requested tools exist in handler map + built-in definitions
    const invalid = skill.agentTools.filter((t) => !SKILL_TOOL_HANDLER_MAP[t]);
    if (invalid.length > 0) {
      console.error(
        `[WARN] Agent skill "${skill.name}" has invalid tools: ${invalid.join(", ")} — not available. Skill degraded to all 8 handler tools.`
      );
      // Graceful degradation: use all handler tools
    } else {
      whitelist = new Set(skill.agentTools);
    }
  }

  let toolDefs: ToolDefinition[];
  let toolHandlers: Record<string, ToolHandler>;

  if (!whitelist) {
    // No whitelist: use all built-in tools except Explore
    toolDefs = allBuiltInTools.filter((t) => {
      const name = typeof t.function === "object" && "name" in t.function ? t.function.name : "";
      return name !== "Explore";
    });
    toolHandlers = { ...SKILL_TOOL_HANDLER_MAP };
  } else {
    // Whitelisted: only those tools
    toolDefs = allBuiltInTools.filter((t) => {
      const name = typeof t.function === "object" && "name" in t.function ? t.function.name : "";
      return whitelist!.has(name);
    });
    toolHandlers = {};
    for (const name of whitelist) {
      if (SKILL_TOOL_HANDLER_MAP[name]) {
        toolHandlers[name] = SKILL_TOOL_HANDLER_MAP[name];
      }
    }
  }

  // Inject MCP tool definitions if the skill has them
  if (opts.mcpToolDefinitions && opts.mcpToolDefinitions.length > 0) {
    toolDefs.push(...opts.mcpToolDefinitions);
    if (opts.mcpToolHandler) {
      for (const def of opts.mcpToolDefinitions) {
        const defName = typeof def.function === "object" && "name" in def.function ? def.function.name : "";
        if (defName) toolHandlers[defName] = opts.mcpToolHandler;
      }
    }
  }

  const maxTurns = skill.agentMaxTurns ?? 50;
  const timeoutMs = skill.agentTimeoutMs ?? 300000;

  // Ensure sessionId is generated
  const subagentSessionId = `skill-${crypto.randomUUID()}`;

  // Use the actual client from the LLM context, not createOpenAIClient
  const runOpts: SubagentOptions = {
    systemPrompt,
    userPrompt: opts.prompt || skill.description,
    tools: toolDefs,
    toolHandlers,
    projectRoot: opts.projectRoot,
    client: llmContext.client,
    model,
    sessionId: subagentSessionId,
    thinking,
    temperature: 0,
    maxTurns,
    maxTokens: 4096,
    overallTimeoutMs: timeoutMs,
  };

  return runSubagent(runOpts);
}

export async function handleSkillToolCall(
  toolCall: ToolCall,
  createOpenAIClient: CreateOpenAIClient,
  skill: SkillInfo,
  projectRoot: string,
  mcpToolDefinitions?: ToolDefinition[],
  mcpToolHandler?: ToolHandler
): Promise<ToolExecutionResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    return { ok: false, name: skill.name, error: "Failed to parse skill agent arguments." };
  }

  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  if (!prompt.trim()) {
    return { ok: false, name: skill.name, error: "Missing required 'prompt' string." };
  }

  const summary = await runSkillSubagent({
    skill,
    prompt,
    projectRoot,
    createOpenAIClient,
    mcpToolDefinitions,
    mcpToolHandler,
  });

  if (summary.startsWith("Explore error:")) {
    return { ok: false, name: skill.name, error: summary };
  }
  if (summary.startsWith("Skill error:")) {
    return { ok: false, name: skill.name, error: summary };
  }

  return { ok: true, name: skill.name, output: summary };
}
