import * as fs from "node:fs";
import * as path from "node:path";
import matter from "gray-matter";
import * as os from "node:os";
import { getExtensionRoot } from "../prompt";
import { buildSkillDocumentsPrompt } from "../prompt";
import type { SkillInfo, SessionMessage } from "../session";
import type { McpManager } from "../mcp/mcp-manager";
import type { McpServerConfig } from "../settings";
import { getErrorMessage } from "../common/error-utils.js";

export interface SessionSkillsDeps {
  projectRoot: string;
  getResolvedSettings: () => Record<string, unknown>;
  loadSessionsIndex: () => unknown;
  getSession: (id: string) => unknown;
  listSessionMessages: (sessionId: string) => SessionMessage[];
  mcpManager: McpManager;
}

export class SessionSkills {
  skillsCache: SkillInfo[] = [];
  readonly skillMcpMap = new Map<string, Record<string, McpServerConfig>>();

  constructor(private deps: SessionSkillsDeps) {}

  matchSkillsByKeywords(skills: SkillInfo[], userPrompt: string): string[] {
    if (!userPrompt || skills.length === 0) return [];
    const lowerPrompt = userPrompt.toLowerCase();
    const matched: string[] = [];

    for (const skill of skills) {
      if (skill.isLoaded) continue;
      if (skill.inclusion === "manual") continue;
      if (skill.mode === "agent") continue; // agent skills are tools, not prompts

      // Rule 1: skill name matches (hyphens/spaces equivalent)
      const normalizedName = skill.name.toLowerCase().replace(/-/g, " ");
      const nameWithHyphens = skill.name.toLowerCase().replace(/ /g, "-");
      if (lowerPrompt.includes(normalizedName) || lowerPrompt.includes(nameWithHyphens)) {
        matched.push(skill.name);
        continue;
      }

      // Rule 2: at least one significant word from description matches
      if (skill.description) {
        const descWords = skill.description
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "") // strip punctuation except hyphens
          .split(/\s+/)
          .filter((w) => w.length >= 5); // only significant words
        if (descWords.some((word) => lowerPrompt.includes(word))) {
          matched.push(skill.name);
        }
      }
    }
    return matched;
  }

  getSkillScanRoots(): Array<{ root: string; displayRoot: string }> {
    const homeDir = os.homedir();
    return [
      { root: path.join(this.deps.projectRoot, ".dscode", "skills"), displayRoot: "./.dscode/skills" },
      { root: path.join(this.deps.projectRoot, ".deepcode", "skills"), displayRoot: "./.deepcode/skills" },
      { root: path.join(this.deps.projectRoot, ".agents", "skills"), displayRoot: "./.agents/skills" },
      { root: path.join(homeDir, ".dscode", "skills"), displayRoot: "~/.dscode/skills" },
      { root: path.join(homeDir, ".deepcode", "skills"), displayRoot: "~/.deepcode/skills" },
      { root: path.join(homeDir, ".agents", "skills"), displayRoot: "~/.agents/skills" },
    ];
  }

  async listSkills(sessionId?: string): Promise<SkillInfo[]> {
    const skillRoots = this.getSkillScanRoots();
    const skillsByName = new Map<string, SkillInfo>();

    const collectSkills = (root: string, displayRoot: string): SkillInfo[] => {
      if (!fs.existsSync(root)) {
        return [];
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        // intentional: best-effort — error is non-critical
        return [];
      }

      const results: SkillInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) {
          continue;
        }
        const skillName = entry.name;
        const skillPath = path.join(root, skillName, "SKILL.md");
        try {
          if (!fs.existsSync(skillPath)) {
            continue;
          }
          const stat = fs.statSync(skillPath);
          if (!stat.isFile()) {
            continue;
          }
        } catch {
          continue;
        }
        results.push(this.readSkillInfo(skillPath, `${displayRoot}/${skillName}/SKILL.md`, skillName));
      }
      return results;
    };

    for (const { root, displayRoot } of skillRoots) {
      for (const skill of collectSkills(root, displayRoot)) {
        if (!skillsByName.has(skill.name)) {
          skillsByName.set(skill.name, skill);
        }
      }
    }

    // Collect built-in template skills (lower priority than user/project skills)
    const templateSkillNames = new Set<string>();
    const templatesDir = path.join(getExtensionRoot(), "templates", "skills");
    if (fs.existsSync(templatesDir)) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(templatesDir, { withFileTypes: true });
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const skillPath = path.join(templatesDir, entry.name);
        const skillName = entry.name.replace(/\.md$/, "");
        templateSkillNames.add(skillName);
        if (!skillsByName.has(skillName)) {
          skillsByName.set(skillName, this.readSkillInfo(skillPath, skillPath, skillName));
        }
      }
    }

    if (sessionId) {
      const loadedSkillKeys = this.getLoadedSkillKeys(sessionId);
      for (const skill of skillsByName.values()) {
        if (loadedSkillKeys.has(this.getSkillKey(skill)) || loadedSkillKeys.has(this.getSkillKeyByName(skill.name))) {
          skill.isLoaded = true;
        }
      }
    }

    // Template skills are always loaded (auto-injected via getDefaultSkillPrompt)
    for (const name of templateSkillNames) {
      const skill = skillsByName.get(name);
      if (skill) skill.isLoaded = true;
    }

    return Array.from(skillsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  resolveSkillPath(skillPath: string): string {
    if (skillPath.startsWith("~/")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("~\\")) {
      return path.join(os.homedir(), skillPath.slice(2));
    }
    if (skillPath.startsWith("./")) {
      return path.join(this.deps.projectRoot, skillPath.slice(2));
    }
    if (skillPath.startsWith(".\\")) {
      return path.join(this.deps.projectRoot, skillPath.slice(2));
    }
    if (path.isAbsolute(skillPath)) {
      return skillPath;
    }
    return path.join(os.homedir(), skillPath);
  }

  buildSkillPrompt(skill: SkillInfo): string {
    const skillPath = this.resolveSkillPath(skill.path);
    return buildSkillDocumentsPrompt([
      {
        name: skill.name,
        content: fs.readFileSync(skillPath, "utf8"),
        path: skillPath,
        skillFilePath: skillPath,
      },
    ]);
  }

  readSkillInfo(skillPath: string, displayPath: string, fallbackName: string): SkillInfo {
    const fallbackSkill: SkillInfo = {
      name: fallbackName.replace(/_/g, "-"),
      path: displayPath,
      description: "",
    };

    try {
      const skillMd = fs.readFileSync(skillPath, "utf8");
      const parsed = matter(skillMd);
      const rawInclusion = typeof parsed.data.inclusion === "string" ? parsed.data.inclusion.trim() : "";
      const inclusion: "auto" | "manual" | undefined =
        rawInclusion === "auto" || rawInclusion === "manual" ? (rawInclusion as "auto" | "manual") : undefined;

      // Parse steering from frontmatter
      let steering: string[] | undefined;
      const rawSteering = parsed.data.steering;
      if (Array.isArray(rawSteering) && rawSteering.every((s: unknown) => typeof s === "string")) {
        steering = rawSteering as string[];
      } else if (rawSteering !== undefined && rawSteering !== null) {
        console.warn(`readSkillInfo: 'steering' must be an array of strings in ${skillPath}`);
      }

      // Parse mode
      const rawMode = typeof parsed.data.mode === "string" ? parsed.data.mode.trim() : "";
      let mode: "prompt" | "agent" | undefined;
      if (rawMode === "prompt" || rawMode === "agent") {
        mode = rawMode;
      }

      // Parse agent fields (only if mode === "agent")
      let agentModel: string | undefined;
      let agentThinking: "enabled" | "disabled" | undefined;
      let agentTools: string[] | undefined;
      let agentMaxTurns: number | undefined;
      let agentTimeoutMs: number | undefined;

      if (mode === "agent") {
        // tools: required — if missing/invalid, fall back to prompt mode
        const rawTools = parsed.data.tools;
        if (Array.isArray(rawTools) && rawTools.length > 0 && rawTools.every((t: unknown) => typeof t === "string")) {
          agentTools = rawTools as string[];
        } else {
          mode = undefined; // fallback to prompt mode
        }

        if (mode === "agent") {
          // model: optional string
          if (typeof parsed.data.model === "string" && parsed.data.model.trim()) {
            agentModel = parsed.data.model.trim();
          }
          // thinking: optional "enabled" | "disabled"
          const rawThinking = typeof parsed.data.thinking === "string" ? parsed.data.thinking.trim() : "";
          if (rawThinking === "enabled" || rawThinking === "disabled") {
            agentThinking = rawThinking;
          }
          // maxTurns: optional positive integer
          const rawMaxTurns = Number(parsed.data.maxTurns);
          if (Number.isFinite(rawMaxTurns) && rawMaxTurns > 0 && Number.isInteger(rawMaxTurns)) {
            agentMaxTurns = rawMaxTurns;
          }
          // timeout: optional positive integer (milliseconds)
          const rawTimeout = Number(parsed.data.timeout);
          if (Number.isFinite(rawTimeout) && rawTimeout > 0 && Number.isInteger(rawTimeout)) {
            agentTimeoutMs = rawTimeout;
          }
        }
      }

      // Parse mcp.json for skill-scoped MCP servers
      let mcpServers: Record<string, McpServerConfig> | undefined;
      try {
        const mcpJsonPath = path.join(path.dirname(skillPath), "mcp.json");
        const mcpRaw = fs.readFileSync(mcpJsonPath, "utf8");
        const mcpParsed = JSON.parse(mcpRaw);
        if (
          mcpParsed &&
          typeof mcpParsed === "object" &&
          !Array.isArray(mcpParsed) &&
          mcpParsed.servers &&
          typeof mcpParsed.servers === "object"
        ) {
          mcpServers = mcpParsed.servers as Record<string, McpServerConfig>;
        } else {
          console.warn(`readSkillInfo: mcp.json missing 'servers' key in ${mcpJsonPath}`);
        }
      } catch (err: unknown) {
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
          // No mcp.json — not an error
        } else {
          console.warn(
            `readSkillInfo: invalid JSON in ${path.join(path.dirname(skillPath), "mcp.json")}: ${getErrorMessage(err)}`
          );
        }
      }

      return {
        name:
          typeof parsed.data.name === "string" && parsed.data.name.trim()
            ? parsed.data.name.trim()
            : fallbackSkill.name,
        path: displayPath,
        description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : "",
        inclusion,
        mode,
        agentModel,
        agentThinking,
        agentTools,
        agentMaxTurns,
        agentTimeoutMs,
        mcpServers,
        steering,
      };
    } catch {
      return fallbackSkill;
    }
  }

  getSkillKey(skill: Pick<SkillInfo, "path">): string {
    return `path:${skill.path}`;
  }

  getSkillKeyByName(name: string): string {
    return `name:${name}`;
  }

  getLoadedSkillKeys(sessionId: string): Set<string> {
    const loadedSkillKeys = new Set<string>();
    for (const message of this.deps.listSessionMessages(sessionId)) {
      if (message.role !== "system" || !message.meta?.skill) {
        continue;
      }
      loadedSkillKeys.add(this.getSkillKey(message.meta.skill));
      loadedSkillKeys.add(this.getSkillKeyByName(message.meta.skill.name));
    }
    return loadedSkillKeys;
  }

  dedupeSkills(skills?: SkillInfo[]): SkillInfo[] | undefined {
    if (!skills || skills.length === 0) {
      return undefined;
    }

    const dedupedSkills = new Map<string, SkillInfo>();
    for (const skill of skills) {
      if (!skill?.name || !skill?.path) {
        continue;
      }
      const key = this.getSkillKey(skill);
      const existingSkill = dedupedSkills.get(key);
      dedupedSkills.set(key, {
        ...existingSkill,
        ...skill,
        description: skill.description ?? existingSkill?.description ?? "",
        isLoaded: Boolean(existingSkill?.isLoaded || skill.isLoaded),
      });
    }

    return Array.from(dedupedSkills.values());
  }

  async normalizeSkills(skills?: SkillInfo[], sessionId?: string): Promise<SkillInfo[] | undefined> {
    const dedupedSkills = this.dedupeSkills(skills);
    if (!dedupedSkills || dedupedSkills.length === 0) {
      return undefined;
    }

    const availableSkills = await this.listSkills(sessionId);
    const availableSkillsByKey = new Map<string, SkillInfo>();
    for (const skill of availableSkills) {
      availableSkillsByKey.set(this.getSkillKey(skill), skill);
      availableSkillsByKey.set(this.getSkillKeyByName(skill.name), skill);
    }

    return dedupedSkills.map((skill) => {
      const matchedSkill =
        availableSkillsByKey.get(this.getSkillKey(skill)) ??
        availableSkillsByKey.get(this.getSkillKeyByName(skill.name));
      if (!matchedSkill) {
        return skill;
      }
      return {
        ...matchedSkill,
        ...skill,
        description: matchedSkill.description || skill.description,
        isLoaded: Boolean(matchedSkill.isLoaded || skill.isLoaded),
      };
    });
  }
}
