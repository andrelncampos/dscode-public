# Spec 180: Cache Metrics Display — Design

## Design Approach

This spec is **purely additive** — it adds visibility to data that DsCode already captures but does not display. The design follows three principles:

1. **Normalize at the boundary:** Convert provider-specific cache fields into a single normalized representation immediately after `ModelUsage` enters `SessionManager`. No branching in display code.
2. **Display at the surface:** Add cache metrics to existing TUI elements (status line, exit summary, budget.md, `/model-info`) using the normalized fields. No new UI components.
3. **Zero regression:** Existing types, functions, and tests are preserved. New fields are additive and optional.

The implementation modifies exactly **6 files** and creates **1 new pure function module**. No changes to providers, tools, MCP, SDD, or steering.

---

## Architecture Decisions

### AD-180-01: Normalization in SessionManager, Not Providers

**Decision:** Cache normalization logic lives in `SessionManager`, not inside each provider. A single pure function `normalizeCacheTokens(usage: ModelUsage): NormalizedCacheTokens` is called immediately after `usage` events arrive.

**Rationale:**
- V12 (Provider-Agnostic LLM Architecture) requires providers to emit generic `ModelUsage` — provider-specific logic belongs in the orchestration layer.
- A pure function is testable without mocking providers.
- Adding normalization to each provider would duplicate code across `BaseOpenAICompatibleProvider`, `AnthropicProvider`, and `GeminiProvider`.

**Consequences:**
- Providers continue to emit raw `ModelUsage` with provider-specific fields intact.
- `SessionManager.appendToolMessages()` calls `normalizeCacheTokens()` after accumulating usage.
- Existing `computeUsageCost()` is NOT modified — it already handles both `prompt_tokens_details.cached_tokens` and `prompt_cache_hit_tokens`.

### AD-180-02: Add Fields to ModelUsage, Not a Wrapper Type

**Decision:** Add `normalizedCacheHitTokens?: number` and `normalizedCacheMissTokens?: number` directly to the existing `ModelUsage` type.

**Rationale:**
- Creating a `EnrichedModelUsage extends ModelUsage` wrapper would require cascading type changes through `SessionEntry`, `accumulateUsage`, `accumulateUsagePerModel`, and all consumers.
- Optional fields on the existing type are backward-compatible — existing code ignores them.
- Shortest path to implementation. Minimum risk.

**Consequences:**
- `ModelUsage` grows by 2 optional fields.
- All code that constructs `ModelUsage` objects (tests, session loader, provider mocks) does NOT need to change — optional fields default to `undefined`.

---

## Component / Module Breakdown

### Component 1: `normalizeCacheTokens()` — Pure Function

**Purpose:** Extract normalized cache hit/miss tokens from raw `ModelUsage` provider-specific fields.

**Interface:**
```typescript
export type NormalizedCacheTokens = {
  /** Number of input tokens served from KV/prompt cache. */
  hit: number;
  /** Number of input tokens NOT served from cache. */
  miss: number;
};

export function normalizeCacheTokens(usage: ModelUsage): NormalizedCacheTokens | null;
```

**Location:** `src/common/cache-metrics.ts` (new file)

**Internal Logic:**
1. Check `prompt_cache_hit_tokens` (DeepSeek pattern): if defined, `hit = prompt_cache_hit_tokens`, `miss = prompt_cache_miss_tokens ?? Math.max(0, usage.prompt_tokens - prompt_cache_hit_tokens)`.
2. Check `prompt_tokens_details.cached_tokens` (OpenAI pattern): if `hit` is still 0, extract from `prompt_tokens_details as { cached_tokens?: number }`. Miss derived as `prompt_tokens - hit`.
3. Check `usage.cache_read_input_tokens` (Anthropic pattern): if present, `hit = cache_read_input_tokens`, `miss = prompt_tokens - hit`.
4. If no cache data found: return `null`.
5. Clamp: `hit = Math.max(0, hit)`, `miss = Math.max(0, miss)`.
6. Edge case: if `hit > prompt_tokens`, set `hit = prompt_tokens`, `miss = 0`.

**Dependencies:** None (pure function, only imports `ModelUsage` type from `../session`).

**Error Handling:** Returns `null` for any malformed or missing cache data. Does not throw.

### Component 2: `computeCacheHitRate()` — Pure Function

**Purpose:** Compute cache hit rate percentage from normalized token counts.

**Interface:**
```typescript
export function computeCacheHitRate(hit: number, miss: number): number | null;
```

**Location:** `src/common/cache-metrics.ts` (same file as Component 1)

**Internal Logic:**
1. If `hit + miss === 0`: return `null`.
2. Return `(hit / (hit + miss)) * 100` as a float.

**Error Handling:** Returns `null` when total is 0. Does not throw.

### Component 3: `computeCacheSavings()` — Pure Function

**Purpose:** Compute estimated USD saved by cache reads.

**Interface:**
```typescript
export function computeCacheSavings(cachedTokens: number, pricing: ModelPricing): number;
```

**Location:** `src/common/cache-metrics.ts` (same file as Component 1)

**Internal Logic:**
1. `return (cachedTokens / 1_000_000) * pricing.cacheReadPrice`
2. If `pricing.cacheReadPrice` is `undefined` or `0`, returns `0`.

**Error Handling:** Returns `0` when pricing is unavailable. Does not throw.

### Component 4: `formatCacheMetrics()` — Pure Function

**Purpose:** Format cache metrics into a compact display string.

**Interface:**
```typescript
export function formatCacheMetrics(hitRate: number | null, savings: number): string | null;
```

**Location:** `src/common/cache-metrics.ts` (same file as Component 1)

**Internal Logic:**
1. If `hitRate === null`: return `null` (no cache data to display).
2. `rateStr = hitRate === 100 || hitRate === 0 ? Math.round(hitRate).toString() : hitRate.toFixed(1)`
3. `savingsStr = savings < 0.01 && savings > 0 ? "<$0.01" : "$" + savings.toFixed(2)`
4. Return `Cache: ${rateStr}% hit | saved ${savingsStr}`

**Error Handling:** Returns `null` when no data. Does not throw.

### Component 5: `ModelUsage` Type Extension

**Purpose:** Add normalized cache fields to the existing `ModelUsage` type.

**Interface:**
```typescript
// In src/session.ts, add to existing ModelUsage type (lines 206-215):
export type ModelUsage = {
  // ... existing fields unchanged ...
  prompt_cache_hit_tokens?: number;       // existing
  prompt_cache_miss_tokens?: number;      // existing
  normalizedCacheHitTokens?: number;      // NEW
  normalizedCacheMissTokens?: number;     // NEW
  total_reqs?: number;
};
```

**Location:** `src/session.ts` line 206–215 (modify existing type)

**Internal Logic:** No logic — type extension only.

### Component 6: `accumulateUsage()` Enhancement

**Purpose:** Extend existing `accumulateUsage()` to accumulate normalized cache fields.

**Interface:**
```typescript
// In src/session.ts, modify existing accumulateUsage() (line 166):
function accumulateUsage(current: ModelUsage | null, next: unknown | null | undefined): ModelUsage | null;
```

**Location:** `src/session.ts` line 166–171 (modify existing function)

**Internal Logic:**
- Existing logic accumulates `prompt_tokens`, `completion_tokens`, `total_tokens`, `total_reqs`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`.
- Add accumulation of `normalizedCacheHitTokens` and `normalizedCacheMissTokens` from `next` if present.
- Use the same `addUsageValue()` helper already used for other fields.

### Component 7: `accumulateUsagePerModel()` Enhancement

**Purpose:** Same as Component 6, but for per-model usage tracking.

**Interface:**
```typescript
// In src/session.ts, modify existing accumulateUsagePerModel() (line 182):
```

**Location:** `src/session.ts` line 182–185 (modify existing function)

**Internal Logic:** Same pattern — accumulate `normalizedCacheHitTokens` and `normalizedCacheMissTokens` per model key.

### Component 8: Cache Normalization in Chat Completion Stream

**Purpose:** Call `normalizeCacheTokens()` after each usage event in the chat completion stream, and store results in `ModelUsage`.

**Location:** `src/session.ts` — inside `replySession()` where `streamUsage` is accumulated (around line 1530). Also `src/providers/anthropic-provider.ts` — usage construction (line 200).

**Internal Logic:**
1. After `responseUsage = ...` is computed from `streamUsage` and `finalUsage`.
2. Call `const cache = normalizeCacheTokens(responseUsage)`.
3. If `cache !== null`, set `responseUsage.normalizedCacheHitTokens = cache.hit` and `responseUsage.normalizedCacheMissTokens = cache.miss`.
4. This enriched `responseUsage` flows downstream to `accumulateUsage`, `accumulateUsagePerModel`, and the UI.

**Anthropic provider modification:**
- In `src/providers/anthropic-provider.ts` line 200-204, the `ModelUsage` construction must include `cache_read_input_tokens` from the Anthropic API response (`event.usage.cache_read_input_tokens`).
- Add `cache_read_input_tokens: typeof event.usage.cache_read_input_tokens === "number" ? event.usage.cache_read_input_tokens : undefined` to the ModelUsage object.
- No other Anthropic provider changes needed.

**DeepSeek/OpenAI providers:** No changes needed. They already pass through `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, and `prompt_tokens_details.cached_tokens` via the generic OpenAI SDK response.

**Gemini provider:** No changes needed. Returns undefined for cache fields (no prompt caching API).

### Component 9: TUI Cache Line Display

**Purpose:** Render cache efficiency line in the status area during session.

**Location:** `src/ui/views/App.tsx` or the component that renders the status bar (the `⚡ tokens 💰 cost` line).

**Internal Logic:**
1. Read latest `usage` from session state (already available via `AppStateContext`).
2. If `usage.normalizedCacheHitTokens` is `undefined` or `0`: render nothing.
3. Else: get pricing from `DEFAULT_MODEL_PRICING[currentModelId]` where `currentModelId` is the current session's model.
4. Compute `hitRate = computeCacheHitRate(usage.normalizedCacheHitTokens, usage.normalizedCacheMissTokens ?? 0)`.
5. Compute `savings = computeCacheSavings(usage.normalizedCacheHitTokens, pricing)`.
6. Compute `text = formatCacheMetrics(hitRate, savings)`.
7. If `text !== null`: render `<Text dimColor>{text}</Text>` below the cost line.

**Dependencies:** `AppStateContext` (existing), `cache-metrics.ts` (new).

### Component 10: Exit Summary Cache Line

**Purpose:** Add cache metrics to the exit summary.

**Location:** `src/ui/exit-summary.ts` (modify existing)

**Internal Logic:**
1. In the existing `rollUpUsage()` function (or equivalent that aggregates usage for exit summary), accumulate `normalizedCacheHitTokens` and `normalizedCacheMissTokens` from all turns.
2. Compute aggregated `hitRate` and `savings`.
3. If `hitRate !== null`, append a line: `Cache (session): ${rateStr}% hit | saved ${savingsStr}`.
4. Use the same `formatCacheMetrics()` function for consistency.

### Component 11: Budget.md Cache Entry

**Purpose:** Record cache metrics in budget.md.

**Location:** `src/common/budget-tracker.ts` (modify existing)

**Internal Logic:**
1. In the function that writes session budget entries to `budget.md`, add a new row when `normalizedCacheHitTokens` is defined.
2. Format: `| Cache | <rate>% hit | <saved> saved |` aligned with existing table columns.
3. If no cache data: omit the row entirely.

### Component 12: `/model-info` Cache Line

**Purpose:** Show accumulated cache metrics per model in `/model-info` output.

**Location:** `src/ui/core/model-command-handlers.ts` (modify existing)

**Internal Logic:**
1. In the handler for `/model-info <id>`, read `usagePerModel[modelId]` from the current session.
2. If `normalizedCacheHitTokens` exists, compute `hitRate` and `savings`.
3. Append a line to the output: `Cache hit (process): <rate>% | saved <amount>`.
4. If no cache data: omit the line.

---

## Data Flow

### Flow 1: Per-Turn Cache Display

```
Provider (e.g., DeepSeekProvider)
  │  yield { type: "usage", usage: { prompt_cache_hit_tokens: 4500, ... } }
  ▼
BaseOpenAICompatibleProvider.chat()
  │  Stream iteration — usage event passes through unchanged
  ▼
SessionManager.replySession()
  │  streamUsage accumulates usage chunks
  │  responseUsage = addUsageValue(responseUsage, finalUsage)
  │  cache = normalizeCacheTokens(responseUsage)   ← NEW
  │  if (cache) enrich responseUsage
  ▼
SessionManager.recordUsageForSession()
  │  accumulateUsage() → accumulates normalized fields
  │  accumulateUsagePerModel() → accumulates per-model normalized fields
  ▼
AppStateContext (React state)
  │  usage data flows to TUI components
  ▼
Status bar component
  │  computeCacheHitRate() + computeCacheSavings() + formatCacheMetrics()
  │  render <Text dimColor>Cache: 91.2% hit | saved $0.42</Text>
```

### Flow 2: Exit Summary Aggregation

```
SessionManager.recordUsageForSession()
  │  accumulateUsage() over ALL turns in session
  │  stores cumulative normalizedCacheHitTokens and normalizedCacheMissTokens
  ▼
SessionManager.getSessionUsage(sessionId)
  │  Returns accumulated ModelUsage with normalized fields
  ▼
Exit summary renderer (exit-summary.ts)
  │  computeCacheHitRate(cumulativeHit, cumulativeMiss)
  │  computeCacheSavings(cumulativeHit, pricing)
  │  formatCacheMetrics(hitRate, savings)
  │  render line: "Cache (session): 87.3% hit | saved $1.28"
```

### Flow 3: Budget.md Recording

```
SessionManager (on session exit)
  │  sessionUsage = getSessionUsage(sessionId)
  │  if (sessionUsage.normalizedCacheHitTokens) → include in budget entry
  ▼
budget-tracker.ts → writeBudgetEntry()
  │  appends row: "| Cache | 87.3% hit | $1.28 saved |"
```

---

## Data Structures

### `NormalizedCacheTokens` (new)

```typescript
export type NormalizedCacheTokens = {
  hit: number;   // cached input tokens
  miss: number;  // non-cached input tokens
};
```

### `ModelUsage` (extended)

```typescript
export type ModelUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  completion_tokens_details?: Record<string, unknown>;
  prompt_tokens_details?: Record<string, unknown>;
  prompt_cache_hit_tokens?: number;        // existing
  prompt_cache_miss_tokens?: number;       // existing
  normalizedCacheHitTokens?: number;       // NEW
  normalizedCacheMissTokens?: number;      // NEW
  total_reqs?: number;
};
```

---

## File / Module Layout

| File | Action | Content |
|------|--------|---------|
| `src/common/cache-metrics.ts` | **CREATE** | `normalizeCacheTokens()`, `computeCacheHitRate()`, `computeCacheSavings()`, `formatCacheMetrics()`, `NormalizedCacheTokens` type |
| `src/session.ts` | **MODIFY** (lines 206-215) | Add `normalizedCacheHitTokens?` and `normalizedCacheMissTokens?` to `ModelUsage` type |
| `src/session.ts` | **MODIFY** (line 166) | Extend `accumulateUsage()` to accumulate normalized fields |
| `src/session.ts` | **MODIFY** (line 182) | Extend `accumulateUsagePerModel()` to accumulate normalized fields |
| `src/session.ts` | **MODIFY** (~line 1530) | Call `normalizeCacheTokens()` after usage accumulation in `replySession()` |
| `src/ui/exit-summary.ts` | **MODIFY** | Add cache line to exit summary using accumulated normalized data |
| `src/common/budget-tracker.ts` | **MODIFY** | Add cache row to budget.md entries when cache data exists |
| `src/ui/core/model-command-handlers.ts` | **MODIFY** | Add cache line to `/model-info` output |
| `src/ui/views/App.tsx` | **MODIFY** | Add cache status line below cost display |
| `src/common/index.ts` | **MODIFY** | Export new functions/types from `cache-metrics.ts` |
| `src/tests/cache-metrics.test.ts` | **CREATE** | Unit tests for all pure functions |
| `src/tests/session.test.ts` | **MODIFY** | Add assertions for normalized cache fields in existing usage tests |

---

## Testing Strategy

### Unit Tests (`src/tests/cache-metrics.test.ts`)

| Test | Covers |
|------|--------|
| `normalizeCacheTokens with prompt_cache_hit_tokens` | DeepSeek pattern — hit from `prompt_cache_hit_tokens`, miss from `prompt_cache_miss_tokens` |
| `normalizeCacheTokens with prompt_cache_hit_tokens, no miss field` | DeepSeek variant — miss derived from `prompt_tokens - hit` |
| `normalizeCacheTokens with prompt_tokens_details.cached_tokens` | OpenAI pattern |
| `normalizeCacheTokens with cache_read_input_tokens` | Anthropic pattern |
| `normalizeCacheTokens with no cache data` | All cache fields undefined → returns `null` |
| `normalizeCacheTokens with zero hit and zero miss` | Returns `null`, not `{hit: 0, miss: 0}` |
| `normalizeCacheTokens with hit > prompt_tokens` | Hit clamped to `prompt_tokens`, miss = 0 |
| `computeCacheHitRate(50, 50)` | Returns `50.0` |
| `computeCacheHitRate(100, 0)` | Returns `100.0` |
| `computeCacheHitRate(0, 100)` | Returns `0.0` |
| `computeCacheHitRate(0, 0)` | Returns `null` |
| `computeCacheSavings(1_000_000, { inputPrice: 1, outputPrice: 2, cacheReadPrice: 0.1 })` | Returns `0.10` |
| `computeCacheSavings(1_000_000, { inputPrice: 1, outputPrice: 2, cacheReadPrice: 0 })` | Returns `0` |
| `formatCacheMetrics(null, 0.42)` | Returns `null` |
| `formatCacheMetrics(91.24, 0.42)` | Returns `"Cache: 91.2% hit | saved $0.42"` |
| `formatCacheMetrics(100, 1.00)` | Returns `"Cache: 100% hit | saved $1.00"` |
| `formatCacheMetrics(0, 0.00)` | Returns `"Cache: 0% hit | saved <$0.01"` |
| `formatCacheMetrics(50.0, 0.004)` | Returns `"Cache: 50% hit | saved <$0.01"` |

### Integration Tests (in existing test files)

| Test | File | Covers |
|------|------|--------|
| `accumulateUsage accumulates normalized cache fields` | `session.test.ts` | Extend existing `accumulateUsage` tests |
| `accumulateUsagePerModel accumulates per-model normalized cache` | `session.test.ts` | Extend existing per-model usage tests |
| `exit summary shows cache line when data exists` | `exit-summary.test.ts` | FR-005 |
| `exit summary omits cache line when no data` | `exit-summary.test.ts` | FR-005 edge case |
| `budget.md includes cache row when data exists` | `budget-tracker.test.ts` | FR-006 |
| `/model-info shows cache line when data exists` | Test via `/model-info` command test | FR-007 |

### Contract Tests

- All 12 existing budget tracker tests pass unchanged.
- All existing exit summary tests pass unchanged.
- All existing session tests pass unchanged.
- TypeScript compilation with `--strict` passes (0 errors).

---

## Migration / Rollback

- **Migration:** None needed. New fields are optional. Existing sessions on disk load without them — `normalizedCacheHitTokens` will be `undefined`, cache display will be hidden. Zero data migration.
- **Rollback:** Remove the two new fields from `ModelUsage`, delete `cache-metrics.ts`, remove the cache line from App.tsx/exit-summary.ts/budget-tracker.ts/model-command-handlers.ts. All other code is unchanged.
