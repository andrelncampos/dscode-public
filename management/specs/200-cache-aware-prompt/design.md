# Spec 200: Cache-Aware Prompt — Design

## Design Approach

This spec is a **configuration + ordering** change, not a new subsystem. The design follows three principles:

1. **Surgical edits only:** Modify exactly the functions that assemble system prompt content. No refactoring, no restructuring of message architecture.
2. **Backward compatible by default:** `cacheMode` defaults to `"off"` which is the current behavior. All existing code paths are unchanged.
3. **Provider-agnostic with provider-aware activation:** The `cacheMode` field lives at the top level of `DeepcodingSettings` (no `deepseek.` namespace). The multi-provider guard in SessionManager checks the resolved provider name before activating cache mode behavior.

The core change is: make the system prompt content deterministic → partition it into stable/dynamic regions → control behavior with a settings flag.

---

## Architecture Decisions

### ADR-200-001: cacheMode at Top Level of Settings (not deepseek.*)

**Context:** The vision.md V22 description mentions `deepseek.cacheMode` as a shorthand for explanation, but P7 (Provider-Agnostic Configuration) requires all settings to be provider-agnostic. The field semantics ("deterministic ordering") are not DeepSeek-specific — they benefit any provider with prefix caching.

**Decision:** `cacheMode` is a top-level field in `DeepcodingSettings`. The provider guard (ADR-200-003) prevents activation for non-DeepSeek providers. If other providers add prefix caching in the future, the same `cacheMode` field can be used without renaming.

**Alternatives considered:**
- `deepseek.cacheMode` inside a `deepseek` settings namespace: Rejected — violates P7, creates provider-specific settings leakage.

### ADR-200-002: Stable Prefix is a Logical Concept, Not a New Message Type

**Context:** The `SessionMessage` type is canonical per ADR-004. Adding a `messageType: "stable_prefix"` field would complicate compaction, serialization, and the Anthropic message converter.

**Decision:** The stable prefix / dynamic tail separation is a **computation-time concept** only. It influences which content goes into which system messages during `createSession()`, but the resulting `SessionMessage[]` array is indistinguishable from current behavior. The separation is only visible through the `getStablePrefixContent()` helper and the prefix hash.

**Alternatives considered:**
- New `SessionMessage.meta.stablePrefix: boolean`: Rejected — adds field to canonical type for a transient optimization concern.

### ADR-200-003: Provider Name Resolution for Guard

**Context:** FR-008 requires that cache mode only activates for DeepSeek. The `getResolvedSettings()` function must provide the resolved provider name.

**Decision:** The provider name is resolved from the active model via the existing `resolveModelToProvider()` function in `src/common/llm-provider-registry.ts`. The resolved name is stored in `ResolvedDeepcodingSettings.providerName`. The cache mode guard checks `if (settings.providerName !== "deepseek") return "off"`.

**Alternatives considered:**
- Check in `createSession()` without settings integration: Rejected — spreads guard logic across call sites.
- Use `providerNameFromBaseURL()`: Rejected — not all providers have distinctive base URLs (custom endpoints).

---

## Component / Module Breakdown

### Component 1: cacheMode Resolution (`src/settings.ts`)

**Purpose:** Parse, validate, and resolve the `cacheMode` setting from raw configuration to a resolved enum value.

**Interface:**
```typescript
// In DeepcodingSettings (line ~73):
cacheMode?: "off" | "aware" | "strict";

// In ResolvedDeepcodingSettings (line ~96):
cacheMode: "off" | "aware" | "strict";

// Resolution function:
function resolveCacheMode(raw: unknown): "off" | "aware" | "strict" {
  if (typeof raw !== "string") return "off";
  const valid = new Set(["off", "aware", "strict"]);
  if (!valid.has(raw)) {
    debugLog("[cache-aware] Invalid cacheMode %o — defaulting to 'off'", raw);
    return "off";
  }
  return raw as "off" | "aware" | "strict";
}
```

**Internal Logic:**
1. Read `raw.cacheMode` from user settings object.
2. If not a string → return `"off"`.
3. If not in valid set → debug log, return `"off"`.
4. Otherwise return the value.
5. Store resolved value in `ResolvedDeepcodingSettings.cacheMode`.

**Dependencies:** `src/settings.ts` existing resolution pipeline.

**Error Handling:** Invalid values silently default to `"off"` with a debug log. No settings validation error — this is a non-critical UX setting.

---

### Component 2: Deterministic Tool Document Ordering (`src/prompt.ts`)

**Purpose:** Guarantee that `readToolDocs()` returns tool documentation in alphabetical order, independent of filesystem read order.

**Interface:**
```typescript
// Existing function, no interface change:
function readToolDocs(extensionRoot: string, options: PromptToolOptions = {}): string

// The .sort() call at line ~259 is annotated:
// "// Sort for KV cache stability — must remain alphabetical"
const entries = fs.readdirSync(toolsDir);
const docs = entries
  .filter(...)
  .sort()  // ← annotate: KV cache stability
  .map(...)
  .filter(...);
```

**Internal Logic:** No logic change. The `.sort()` already exists. This component adds a comment and a test to prevent regression.

**Dependencies:** Node.js `fs` (existing).

**Error Handling:** No change — errors reading tool dir return `""` (existing behavior).

---

### Component 3: Deterministic Skill Document Ordering (`src/prompt.ts`)

**Purpose:** Sort `SkillPromptDocument[]` by name before rendering into the system prompt.

**Interface:**
```typescript
export function buildSkillDocumentsPrompt(skills: SkillPromptDocument[]): string {
  // Sort for KV cache stability
  const sorted = [...skills].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );
  const blocks = sorted.map((skill) => renderSkillDocumentBlock(skill));
  return `Use the skill documents below to assist the user:\n${blocks.join("\n\n")}`;
}
```

**Internal Logic:**
1. Shallow-copy the `skills` array (`[...skills]`) — do not mutate caller's array.
2. Sort by `name.toLowerCase()` using `localeCompare` (stable, locale-insensitive for ASCII names).
3. Render each skill via existing `renderSkillDocumentBlock()`.
4. Join with `"\n\n"` (existing format).

**Dependencies:** None (pure function).

**Error Handling:** Empty array produces empty prompt (existing behavior). `renderSkillDocumentBlock` handles empty content (existing).

---

### Component 4: Stable Prefix Builder (`src/prompt.ts`)

**Purpose:** Compute the stable prefix content for a given configuration. Returns the concatenation of non-volatile system prompt components.

**Interface:**
```typescript
export function getStablePrefixContent(args: {
  extensionRoot: string;
  promptToolOptions: PromptToolOptions;
  agentInstructions: string | null;
  skillPrompt: string;
  cacheMode: "off" | "aware" | "strict";
}): string {
  const systemBase = cacheMode === "strict"
    ? SYSTEM_PROMPT_BASE  // No model name line in strict mode
    : SYSTEM_PROMPT_BASE;

  const toolDocs = readToolDocs(args.extensionRoot, args.promptToolOptions);

  const parts: string[] = [systemBase];
  if (toolDocs) parts.push(toolDocs);
  if (args.skillPrompt) parts.push(args.skillPrompt);
  if (args.agentInstructions) parts.push(args.agentInstructions);

  return parts.join("\n\n");
}
```

**Internal Logic:**
1. Start with `SYSTEM_PROMPT_BASE`. In strict mode, skip the `getCurrentDateAndModelPrompt()` line.
2. Append tool docs (already sorted alphabetically by Component 2).
3. Append default skill prompt (already sorted by Component 3).
4. Append agent instructions (AGENTS.md content, user-controlled, not sorted).
5. Return concatenated string.

**What is NOT included:**
- Model name (in strict mode).
- Runtime context JSON (project root, homedir, system info).
- Memory context (recent turn transcripts).
- Theme messages (permission hints, skill activation hints).

**Dependencies:** `readToolDocs`, `SYSTEM_PROMPT_BASE`.

**Error Handling:** Pure string concatenation — no error paths.

---

### Component 5: Prefix Hash (`src/prompt.ts`)

**Purpose:** Compute a SHA-256 hash of the stable prefix content for debug logging and test verification.

**Interface:**
```typescript
import { createHash } from "node:crypto";

export function getStablePrefixHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
```

**Internal Logic:**
1. Create SHA-256 hash from `node:crypto`.
2. Feed content as UTF-8.
3. Return hex digest (64 lowercase hex characters).

**Dependencies:** `node:crypto` (Node.js built-in, zero npm packages).

**Error Handling:** `createHash("sha256")` always succeeds. No error paths.

---

### Component 6: Multi-Provider Guard (`src/settings.ts`)

**Purpose:** Resolve the effective cache mode considering the active provider. Non-DeepSeek providers always get `"off"`.

**Interface:**
```typescript
export function getEffectiveCacheMode(
  cacheMode: "off" | "aware" | "strict",
  providerName: string
): "off" | "aware" | "strict" {
  if (cacheMode === "off") return "off";
  if (providerName !== "deepseek") {
    debugLog("[cache-aware] cacheMode %o suppressed — provider %o is not DeepSeek", cacheMode, providerName);
    return "off";
  }
  return cacheMode;
}
```

**Internal Logic:**
1. If cacheMode is `"off"` → return `"off"` (noop).
2. If providerName is not `"deepseek"` → debug log, return `"off"`.
3. Otherwise return the configured cacheMode.

**Dependencies:** `resolveModelToProvider()` from `llm-provider-registry.ts`.

**Error Handling:** Unknown provider treated as non-DeepSeek → `"off"`.

---

### Component 7: Cache Mode in Session Creation (`src/session.ts`)

**Purpose:** Modify `createSession()` and `reloadAgentInstructions()` to assemble system messages according to `cacheMode`.

**Interface:**
```typescript
// In SessionManager.createSession():
private async createSession(sessionId: string, userPrompt: UserPrompt, signal: AbortSignal, ...): Promise<void> {
  // ... existing code ...

  const promptToolOptions = this.getPromptToolOptions();
  const settings = this.getResolvedSettings();
  const effectiveCacheMode = getEffectiveCacheMode(settings.cacheMode, settings.providerName);

  // Stable prefix assembly
  let systemPrompt = SessionManager.systemPromptCache.get(cacheKey);
  if (!systemPrompt) {
    systemPrompt = getSystemPrompt(this.projectRoot, promptToolOptions, effectiveCacheMode);
    SessionManager.systemPromptCache.set(cacheKey, systemPrompt);
  }

  // ... append system prompt message ...

  // Default skill prompt (already sorted by Component 3)
  const defaultSkillPrompt = getDefaultSkillPrompt();
  if (defaultSkillPrompt) { /* append */ }

  // Agent instructions (AGENTS.md)
  const agentInstructions = this.loadAgentInstructions();
  if (agentInstructions) { /* append */ }

  // Runtime context — always appended, but in strict mode model name is separate
  const runtimeContext = getRuntimeContext(
    this.projectRoot,
    effectiveCacheMode === "strict" ? undefined : promptToolOptions.model
  );
  /* append runtimeContext */

  // If cacheMode !== "off", compute and log prefix hash
  if (effectiveCacheMode !== "off") {
    const stablePrefix = getStablePrefixContent({
      extensionRoot: getExtensionRoot(),
      promptToolOptions,
      agentInstructions,
      skillPrompt: defaultSkillPrompt,
      cacheMode: effectiveCacheMode,
    });
    const hash = getStablePrefixHash(stablePrefix);
    debugLog("[cache-aware] Stable prefix hash: %s (mode: %s)", hash, effectiveCacheMode);
  }

  // ... memory context, user message, skills (unchanged) ...
}
```

**Internal Logic:**
1. Resolve `effectiveCacheMode` via Component 6.
2. Build system prompt with `getSystemPrompt()` — the model name line is excluded in strict mode.
3. Append messages in fixed order: system prompt → skill prompt → runtime context → agent instructions → memory context.
4. If cacheMode is not `"off"`, compute stable prefix hash and log it.
5. Rest of `createSession()` unchanged.

**Changes to `getPromptToolOptions()`:**
```typescript
private getPromptToolOptions(): { model: string; webSearchEnabled: boolean } {
  const settings = this.getResolvedSettings();
  return {
    model: settings.cacheMode === "strict" ? "" : settings.model,
    webSearchEnabled: true,
  };
}
```
When cacheMode is `"strict"`, `model` is empty string → `getCurrentDateAndModelPrompt("")` returns `""` → model name not in system prompt. The model name still appears in runtime context (which is in dynamic tail).

**Dependencies:** `getSystemPrompt`, `getDefaultSkillPrompt`, `getRuntimeContext`, `loadAgentInstructions`, `getStablePrefixContent`, `getStablePrefixHash`, `getEffectiveCacheMode`.

**Error Handling:** All sub-functions handle errors gracefully (return empty strings on failure). No new error paths.

---

### Component 8: Budget Cache Columns (`src/common/budget-tracker.ts`)

**Purpose:** Add `Cache Saved (USD)` and `Cache Hit %` columns to the `budget.md` markdown output and parse them on read.

**Interface changes to `buildBudgetMarkdown()`:**
```typescript
function buildBudgetMarkdown(costs: DailyCost[]): string {
  const sorted = [...costs].sort((a, b) => b.date.localeCompare(a.date));
  const totalCost = sorted.reduce((sum, e) => sum + e.cost, 0);
  const totalCacheSaved = sorted.reduce((sum, e) => sum + e.cacheSaved, 0);
  const totalCacheHit = sorted.reduce((sum, e) => sum + e.cacheHitTokens, 0);
  const totalCacheMiss = sorted.reduce((sum, e) => sum + e.cacheMissTokens, 0);
  const totalCacheTotal = totalCacheHit + totalCacheMiss;
  const totalHitRate = totalCacheTotal > 0 ? (totalCacheHit / totalCacheTotal) * 100 : 0;

  const lines: string[] = [
    "# Budget — Custo acumulado do projeto",
    "",
    "| Data | Custo (USD) | Cache Saved (USD) | Cache Hit % |",
    "|------|-------------|-------------------|-------------|",
  ];

  for (const entry of sorted) {
    const cacheTotal = entry.cacheHitTokens + entry.cacheMissTokens;
    const hitRate = cacheTotal > 0 ? (entry.cacheHitTokens / cacheTotal) * 100 : 0;
    lines.push(
      `| ${entry.date} | ${formatCost(entry.cost)} | ${formatCost(entry.cacheSaved)} | ${hitRate.toFixed(1)}% |`
    );
  }

  lines.push(
    `| **Total** | **${formatCost(totalCost)}** | **${formatCost(totalCacheSaved)}** | **${totalHitRate.toFixed(1)}%** |`
  );

  return lines.join("\n") + "\n";
}
```

**Interface changes to `parseBudgetFile()`:**
```typescript
function parseBudgetFile(content: string): DailyCost[] {
  const costs: DailyCost[] = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    // Match 3-column format: | 2026-06-08 | $0.42 | $0.10 | 91.2% |
    const match3 = line.match(
      /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)%\s*\|/
    );
    if (match3) {
      const date = match3[1];
      const cost = parseFloat(match3[2]);
      const cacheSaved = parseFloat(match3[3]);
      const hitRate = parseFloat(match3[4]);
      if (date && Number.isFinite(cost)) {
        // Reverse-engineer approximate tokens from hit rate (0 if no cache data)
        costs.push({
          date,
          cost,
          cacheSaved: Number.isFinite(cacheSaved) ? cacheSaved : 0,
          cacheHitTokens: 0,   // Not recoverable from hit rate alone
          cacheMissTokens: 0,  // Not recoverable from hit rate alone
        });
      }
      continue;
    }

    // Match 2-column legacy format: | 2026-06-08 | $0.42 |
    const match2 = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\$?(\d+(?:\.\d+)?)\s*\|/);
    if (match2) {
      const date = match2[1];
      const cost = parseFloat(match2[2]);
      if (date && Number.isFinite(cost)) {
        costs.push({ date, cost, cacheSaved: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
      }
    }
  }

  return costs;
}
```

**Internal Logic:**
1. Try 3-column match first (new format). If matched, parse all three numeric columns.
2. Fall back to 2-column match (legacy format). Default cache fields to 0.
3. Token counts from `cacheHitTokens`/`cacheMissTokens` cannot be reconstructed from hit rate alone → set to 0 on read. This is acceptable because `recordBudgetCost()` re-accumulates them from live `ModelUsage` data.
4. The `formatCost()` function formats cache savings identically to costs (dollar amount).

**Error Handling:**
- Missing cache columns → defaults to 0 (backward compatible).
- Malformed cache values (e.g., `N/A`) → `parseFloat` returns `NaN` → `Number.isFinite` check → defaults to 0.

---

## Data Flow

### Flow 1: Session Creation with cacheMode "off" (current behavior)

```
createSession()
  → getPromptToolOptions() → { model: "deepseek-v4-pro", webSearchEnabled: true }
  → getEffectiveCacheMode("off", "deepseek") → "off"
  → getSystemPrompt(projectRoot, {model: "deepseek-v4-pro", ...})
    → readToolDocs() → ["AskUserQuestion.md", "bash.md", ... ] → join("\n\n")
    → return SYSTEM_PROMPT_BASE + modelNameLine + toolDocs
  → buildSystemMessage(systemPrompt) → append
  → getDefaultSkillPrompt() → buildSkillDocumentsPrompt(skills) → append
  → getRuntimeContext(projectRoot, "deepseek-v4-pro") → append
  → loadAgentInstructions() → AGENTS.md content → append
  → buildMemoryContextMessage() → recent turn transcripts → append
  → [NO prefix hash logged]
```

### Flow 2: Session Creation with cacheMode "aware" (deterministic ordering)

```
createSession()
  → getEffectiveCacheMode("aware", "deepseek") → "aware"
  → Same as Flow 1, BUT:
    - buildSkillDocumentsPrompt() sorts skills alphabetically
    - readToolDocs() already sorted (unchanged)
  → After appending all messages:
    → getStablePrefixContent({..., cacheMode: "aware"})
      → SYSTEM_PROMPT_BASE + modelNameLine + toolDocs + skillPrompt + agentInstructions
    → getStablePrefixHash(content) → "a1b2c3..."
    → debugLog("[cache-aware] Stable prefix hash: a1b2c3... (mode: aware)")
```

### Flow 3: Session Creation with cacheMode "strict" (stable prefix)

```
createSession()
  → getEffectiveCacheMode("strict", "deepseek") → "strict"
  → getPromptToolOptions() → { model: "", webSearchEnabled: true }  ← empty model
  → getSystemPrompt(projectRoot, {model: "", ...})
    → getCurrentDateAndModelPrompt("") → ""  ← no model line
    → return SYSTEM_PROMPT_BASE + toolDocs  ← shorter prefix
  → buildSystemMessage(systemPrompt) → append
  → getDefaultSkillPrompt() → sorted skills → append
  → loadAgentInstructions() → AGENTS.md → append
  → getRuntimeContext(projectRoot, undefined) → does NOT skip — appended with model name
    → runtime context message includes model name in dynamic tail
  → buildMemoryContextMessage() → append (already in tail)
  → getStablePrefixContent({..., cacheMode: "strict"})
    → SYSTEM_PROMPT_BASE + toolDocs + skillPrompt + agentInstructions  ← no model, no project root
  → getStablePrefixHash(content) → "d4e5f6..."
  → debugLog("[cache-aware] Stable prefix hash: d4e5f6... (mode: strict)")
```

### Flow 4: Budget Write (3-column format)

```
recordBudgetCost(projectRoot, model, usage, pricing, limits)
  → readBudget() → parseBudgetFile() → DailyCost[] (with cache fields from previous write)
  → accumulate: existing.cacheSaved += computeCacheSavings(...)
  → writeBudget() → buildBudgetMarkdown(costs) → 3-column markdown
  → File: .dscode/budget.md
    | Data | Custo (USD) | Cache Saved (USD) | Cache Hit % |
    | 2026-06-14 | $1.23 | $0.45 | 87.3% |
    | **Total** | **$3.33** | **$1.37** | **89.4%** |
```

---

## Data Structures

### `ResolvedDeepcodingSettings` addition (`src/settings.ts` line ~96)

```typescript
export type ResolvedDeepcodingSettings = {
  // ... existing fields ...
  cacheMode: "off" | "aware" | "strict";  // NEW
};
```

### `DeepcodingSettings` addition (`src/settings.ts` line ~73)

```typescript
export type DeepcodingSettings = {
  // ... existing fields ...
  cacheMode?: "off" | "aware" | "strict";  // NEW, optional, defaults to "off"
};
```

### `PromptToolOptions` (`src/prompt.ts` line ~100) — NO CHANGE

The `model` field already exists. In strict mode, it is set to `""` by the caller in `getPromptToolOptions()`.

### `DailyCost` (`src/common/budget-tracker.ts` line ~11) — NO CHANGE

Already has `cacheSaved: number`, `cacheHitTokens: number`, `cacheMissTokens: number`.

### `StablePrefixArgs` — NEW internal type (`src/prompt.ts`)

```typescript
type StablePrefixArgs = {
  extensionRoot: string;
  promptToolOptions: PromptToolOptions;
  agentInstructions: string | null;
  skillPrompt: string;
  cacheMode: "off" | "aware" | "strict";
};
```

---

## File / Module Layout

| File | Action | Purpose |
|------|--------|---------|
| `src/settings.ts` | **Modify** | Add `cacheMode` to `DeepcodingSettings` and `ResolvedDeepcodingSettings`. Add `resolveCacheMode()` and `getEffectiveCacheMode()`. |
| `src/prompt.ts` | **Modify** | Annotate `.sort()` in `readToolDocs()`. Add sort to `buildSkillDocumentsPrompt()`. Add `getStablePrefixContent()` and `getStablePrefixHash()`. Modify `getSystemPrompt()` to accept cacheMode for strict mode model-line suppression. |
| `src/session.ts` | **Modify** | Modify `createSession()` to call `getEffectiveCacheMode()`, assemble system messages per cache mode, log prefix hash. Modify `reloadAgentInstructions()` to also log hash when cacheMode active. Modify `getPromptToolOptions()` to suppress model name in strict mode. |
| `src/common/budget-tracker.ts` | **Modify** | Extend `buildBudgetMarkdown()` to 3 columns. Extend `parseBudgetFile()` to parse cache columns. |
| `src/tests/cache-aware-prompt.test.ts` | **Create** | Unit tests for all components (see Testing Strategy). |
| `src/tests/budget-tracker.test.ts` | **Modify** | Add tests for cache column persistence and backward compatibility. |

---

## Testing Strategy

### Unit Tests — `src/tests/cache-aware-prompt.test.ts`

| Test | Covers | What it verifies |
|------|--------|-----------------|
| `resolveCacheMode — valid values` | FR-005 | `"off"`→`"off"`, `"aware"`→`"aware"`, `"strict"`→`"strict"` |
| `resolveCacheMode — invalid values` | FR-005 edge case 1 | `"enabled"`→`"off"`, `true`→`"off"`, `null`→`"off"`, `1`→`"off"` |
| `resolveCacheMode — absent value` | FR-005 | `undefined`→`"off"` |
| `getEffectiveCacheMode — off` | FR-008 | Returns `"off"` regardless of provider |
| `getEffectiveCacheMode — aware + deepseek` | FR-008 | Returns `"aware"` |
| `getEffectiveCacheMode — aware + openai` | FR-008 edge case 3 | Returns `"off"` |
| `getEffectiveCacheMode — strict + deepseek` | FR-008 | Returns `"strict"` |
| `getEffectiveCacheMode — strict + anthropic` | FR-007 edge case 2 | Returns `"off"` |
| `buildSkillDocumentsPrompt — alphabetical sort` | FR-003 | `[{name:"B"},{name:"A"}]` → A before B in output |
| `buildSkillDocumentsPrompt — case-insensitive sort` | FR-003 | `[{name:"b"},{name:"A"}]` → A before b |
| `buildSkillDocumentsPrompt — idempotent` | FR-001 | Same input twice → identical output |
| `readToolDocs — idempotent` | FR-002 | Same options twice → identical string |
| `getStablePrefixContent — aware mode` | FR-004 | Includes model name, tool docs, skills, agent instructions |
| `getStablePrefixContent — strict mode` | FR-007 | Excludes model name. Excludes project root. |
| `getStablePrefixContent — idempotent strict` | FR-007 AC 6 | Two calls with different project roots → identical content |
| `getStablePrefixHash — same content` | FR-009 | `"abc"` → same hash twice |
| `getStablePrefixHash — different content` | FR-009 | `"abc"` vs `"abd"` → different hashes |
| `getStablePrefixHash — 64 hex chars` | FR-009 | Output is 64 lowercase hex characters |
| `getSystemPrompt — strict mode no model line` | FR-007 | Does not contain "The current LLM model is" |
| `getSystemPrompt — aware mode has model line` | FR-006 | Contains "The current LLM model is" |

### Budget Tracker Tests — `src/tests/budget-tracker.test.ts` (additions)

| Test | Covers | What it verifies |
|------|--------|-----------------|
| `buildBudgetMarkdown with cache data` | FR-010 | 3-column output with cache saved and hit rate |
| `parseBudgetFile legacy format` | FR-010 edge case 8 | 2-column input → cache fields default to 0 |
| `parseBudgetFile new format` | FR-010 | 3-column input → cache fields parsed correctly |
| `parseBudgetFile mixed format` | FR-010 | Some rows 2-col, some 3-col → handled per-row |
| `budget round-trip with cache` | FR-010 | Write → read → cacheSaved values preserved |

### Integration Tests — `src/tests/session.test.ts` (additions)

| Test | Covers | What it verifies |
|------|--------|-----------------|
| `createSession — cacheMode=off` | FR-005, NFR-003 | Existing behavior unchanged |
| `createSession — cacheMode=aware` | FR-006 | System messages assembled with deterministic order |
| `createSession — cacheMode=strict` | FR-007 | Runtime context appended, model name in dynamic tail |
| `createSession — cacheMode=aware non-deepseek` | FR-008 | Degrades to off behavior |

---

## Migration / Rollback

### Migration

- **Settings:** The `cacheMode` field is optional and defaults to `"off"`. Existing `settings.json` files work without modification.
- **Budget file:** `buildBudgetMarkdown()` writes 3-column format going forward. Legacy 2-column files are read correctly by `parseBudgetFile()`.
- **No data migration needed.**

### Rollback

- Remove `cacheMode` from `DeepcodingSettings` and `ResolvedDeepcodingSettings`.
- Remove `resolveCacheMode()`, `getEffectiveCacheMode()`, `getStablePrefixContent()`, `getStablePrefixHash()`.
- Revert `createSession()` to pre-200 code.
- Revert `buildBudgetMarkdown()` and `parseBudgetFile()` to 2-column format.
- Budget file written in 3-column format continues to be readable (legacy parser handles it via 2-column match ignoring extra columns).
- **Zero data loss on rollback.**
