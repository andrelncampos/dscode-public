export type McpPolicyAction = "allow" | "ask" | "deny";

export interface McpPolicyRule {
  action: McpPolicyAction;
  pattern: string; // e.g. "mcp__postgres__*"
  source: "steering"; // always "steering" for now
}

export class McpPolicy {
  private rules: McpPolicyRule[] = [];
  private skillRules = new Map<string, McpPolicyRule[]>();

  /** Create policy engine with initial steering rules. Calls reload(). */
  constructor(steeringRules: string[] = []) {
    this.reload(steeringRules);
  }

  /** Parse steering rules and build ordered rule list. */
  reload(steeringRules: string[]): void {
    this.rules = [];
    for (const line of steeringRules) {
      const rule = this.parseRuleLine(line);
      if (rule) this.rules.push(rule);
    }
  }

  /** Add MCP policy rules scoped to a skill. */
  addSkillRules(skillName: string, rules: string[]): void {
    const parsed: McpPolicyRule[] = [];
    for (const line of rules) {
      const rule = this.parseRuleLine(line);
      if (rule) parsed.push(rule);
    }
    this.skillRules.set(skillName, parsed);
  }

  /** Remove rules from a skill. */
  removeSkillRules(skillName: string): void {
    this.skillRules.delete(skillName);
  }

  /** First-match-wins evaluation. Returns "ask" if no rule matches. */
  evaluate(toolName: string): McpPolicyAction {
    if (!toolName.startsWith("mcp__")) return "ask";

    for (const rule of this.rules) {
      if (matchPattern(toolName, rule.pattern)) {
        return rule.action;
      }
    }

    // Skill rules (lower priority than session steering)
    for (const [, skillRuleList] of this.skillRules) {
      for (const rule of skillRuleList) {
        if (matchPattern(toolName, rule.pattern)) {
          return rule.action;
        }
      }
    }

    return "ask";
  }

  /** Find the pattern text of the first matching deny rule, or null. */
  findDenyReason(toolName: string): string | null {
    for (const rule of this.rules) {
      if (rule.action === "deny" && matchPattern(toolName, rule.pattern)) {
        return rule.pattern;
      }
    }

    // Skill rules
    for (const [, skillRuleList] of this.skillRules) {
      for (const rule of skillRuleList) {
        if (rule.action === "deny" && matchPattern(toolName, rule.pattern)) {
          return rule.pattern;
        }
      }
    }

    return null;
  }

  /** Debug/TUI: current rules. */
  getRules(): McpPolicyRule[] {
    const all: McpPolicyRule[] = [...this.rules];
    for (const [, list] of this.skillRules) {
      all.push(...list);
    }
    return all;
  }

  /** Parse a single MCP steering rule line. Returns null if malformed. */
  private parseRuleLine(line: string): McpPolicyRule | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- MCP:")) return null;

    const body = trimmed.slice("- MCP:".length).trim();
    const spaceIdx = body.indexOf(" ");
    if (spaceIdx === -1) {
      console.warn(`McpPolicy: skipped malformed rule: "${trimmed}"`);
      return null;
    }

    const action = body.slice(0, spaceIdx).toLowerCase();
    const pattern = body.slice(spaceIdx + 1).trim();

    if (action !== "allow" && action !== "ask" && action !== "deny") {
      console.warn(`McpPolicy: skipped malformed rule (invalid action "${action}"): "${trimmed}"`);
      return null;
    }

    if (!pattern.startsWith("mcp__")) {
      console.warn(`McpPolicy: skipped malformed rule (pattern missing mcp__ prefix): "${trimmed}"`);
      return null;
    }

    return { action, pattern, source: "steering" };
  }
}

/** Wildcard pattern matching. Uses literal substring matching — NO regex. */
function matchPattern(toolName: string, pattern: string): boolean {
  // Exact match
  if (pattern === toolName) return true;

  // No wildcard → exact comparison
  if (!pattern.includes("*")) return pattern === toolName;

  // Split on "*" and match segments sequentially
  const segments = pattern.split("*");
  let pos = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "") {
      // Consecutive "**" or leading/trailing "*" — empty segment is always a match
      continue;
    }
    if (i === segments.length - 1) {
      // Last segment: must match at the end of remaining string
      return (
        toolName.indexOf(segment, pos) !== -1 && toolName.indexOf(segment, pos) + segment.length === toolName.length
      );
    }
    const foundAt = toolName.indexOf(segment, pos);
    if (foundAt === -1) return false;
    pos = foundAt + segment.length;
  }

  return true;
}
