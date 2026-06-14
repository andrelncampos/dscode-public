# Spec 180: Cache Metrics Display — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

## Tasks

### Task 1: Create `cache-metrics.ts` pure utility module

**Objective:** Create the single new file containing all cache metric pure functions and types.

**Requirements Covered:** FR-001, FR-002, FR-003 (normalization logic), FR-004/005/006 (formatting)

**Design References:** Components 1, 2, 3, 4

**Actions:**
1. Create `src/common/cache-metrics.ts`.
2. Export type `NormalizedCacheTokens = { hit: number; miss: number }`.
3. Implement and export `normalizeCacheTokens(usage: ModelUsage): NormalizedCacheTokens | null` — extract cache tokens from `prompt_cache_hit_tokens`, `prompt_tokens_details.cached_tokens`, and `cache_read_input_tokens` patterns.
4. Implement and export `computeCacheHitRate(hit: number, miss: number): number | null`.
5. Implement and export `computeCacheSavings(cachedTokens: number, pricing: ModelPricing): number`.
6. Implement and export `formatCacheMetrics(hitRate: number | null, savings: number): string | null`.
7. Import `ModelUsage` type from `../session` and `ModelPricing` from `./model-capabilities`.
8. Add `export * from "./cache-metrics"` to `src/common/index.ts`.

**Validation:** Create `src/tests/cache-metrics.test.ts` with unit tests for all 4 functions (see design.md testing strategy). Run `npx tsx --test src/tests/cache-metrics.test.ts` → 18 pass, 0 fail.

**Status:** [ ] pending

---

### Task 2: Extend `ModelUsage` type with normalized cache fields

**Objective:** Add `normalizedCacheHitTokens` and `normalizedCacheMissTokens` to the `ModelUsage` type.

**Requirements Covered:** FR-003

**Design References:** Component 5

**Actions:**
1. Open `src/session.ts`.
2. In the `ModelUsage` type (line 206-215), add `normalizedCacheHitTokens?: number` after `prompt_cache_miss_tokens`.
3. Add `normalizedCacheMissTokens?: number` after `normalizedCacheHitTokens`.
4. Add JSDoc comments: `/** Normalized cached input tokens across providers. Set by SessionManager after each API call. */`

**Validation:** TypeScript compilation passes with `--strict`. No new TS errors from existing code.

**Status:** [ ] pending

---

### Task 3: Extend `accumulateUsage()` and `accumulateUsagePerModel()` for normalized fields

**Objective:** Accumulate normalized cache fields alongside existing usage fields.

**Requirements Covered:** FR-003, FR-005 (aggregation)

**Design References:** Components 6, 7

**Actions:**
1. In `src/session.ts`, in `accumulateUsage()` (line 166), add accumulation of `normalizedCacheHitTokens` and `normalizedCacheMissTokens` from `next` using the same `addUsageValue()` pattern used for `prompt_cache_hit_tokens`.
2. In `accumulateUsagePerModel()` (line 182), add equivalent accumulation logic for per-model normalized cache fields.

**Validation:** Extend existing `src/tests/session.test.ts` tests for `accumulateUsage` — add assertions that normalized fields add up correctly across multiple usage records.

**Status:** [ ] pending

---

### Task 4: Wire normalization into `replySession()` usage accumulation

**Objective:** Call `normalizeCacheTokens()` after each API call and store results in `ModelUsage`.

**Requirements Covered:** FR-003 (integration), FR-004 (data flow to TUI)

**Design References:** Component 8, Data Flow 1

**Actions:**
1. In `src/session.ts`, in `replySession()`, find the code near line 1530 where `responseUsage` is assembled from `streamUsage` and `finalUsage`.
2. Import `normalizeCacheTokens` from `../common/cache-metrics`.
3. After `responseUsage = ...`, add: `const cache = normalizeCacheTokens(responseUsage)`. If `cache !== null`, set `responseUsage.normalizedCacheHitTokens = cache.hit` and `responseUsage.normalizedCacheMissTokens = cache.miss`.
4. In `src/providers/anthropic-provider.ts`, in the `case "message_delta"` block (line 200-204), add `cache_read_input_tokens: typeof event.usage.cache_read_input_tokens === "number" ? event.usage.cache_read_input_tokens : undefined` to the `ModelUsage` object literal. This ensures Anthropic's cache read tokens reach the normalizer.

**Validation:** Add assertion to an existing session test that a complete `replySession()` flow populates `normalizedCacheHitTokens` when mock usage includes cache fields. TypeScript compile passes.

**Status:** [ ] pending

---

### Task 5: Display cache line in TUI status area

**Objective:** Show `Cache: X% hit | saved $Y` during active session.

**Requirements Covered:** FR-004

**Design References:** Component 9

**Actions:**
1. Find the component that renders the status line with `⚡ tokens 💰 cost` (likely in `src/ui/views/App.tsx` or a status bar component).
2. Import `computeCacheHitRate`, `computeCacheSavings`, `formatCacheMetrics` from `../../common/cache-metrics`.
3. Get pricing from `DEFAULT_MODEL_PRICING[currentModelId]` where `currentModelId` is the active session's model. Import `DEFAULT_MODEL_PRICING` from `../../common/model-capabilities`.
4. Read `usage` from the current session state (already available via context).
5. If `usage?.normalizedCacheHitTokens` is defined, compute and render `<Text dimColor>{formatCacheMetrics(...)}</Text>` below the cost line.
6. When `normalizedCacheHitTokens` is `undefined`, render nothing (no empty line).

**Validation:** Visual inspection: run DsCode, make a few API calls against DeepSeek, observe cache line appearing after the first response with cache data. Test: if possible, add a snapshot test of the status line component.

**Status:** [ ] pending

---

### Task 6: Add cache metrics to exit summary

**Objective:** Show aggregated cache efficiency when session exits.

**Requirements Covered:** FR-005

**Design References:** Component 10, Data Flow 2

**Actions:**
1. Open `src/ui/exit-summary.ts`.
2. In the function that aggregates usage for display (near line 45, `rollUpUsage` or equivalent), accumulate `normalizedCacheHitTokens` and `normalizedCacheMissTokens` from the per-turn processed records.
3. Import `computeCacheHitRate`, `computeCacheSavings`, `formatCacheMetrics` from `../../common/cache-metrics`.
4. Get pricing from `DEFAULT_MODEL_PRICING` or session's model pricing.
5. If accumulated `normalizedCacheHitTokens > 0`, render a line: `Cache (session): <formatted>` using `formatCacheMetrics`.
6. If no cache data for the entire session, omit the line entirely.

**Validation:** Extend existing exit summary tests in `src/tests/exit-summary.test.ts` — add a test with mock usage data containing `normalizedCacheHitTokens: 90, normalizedCacheMissTokens: 10` and assert the exit summary contains `Cache (session): 90.0% hit`.

**Status:** [ ] pending

---

### Task 7: Record cache metrics in `budget.md`

**Objective:** Include cache efficiency in per-session budget entries.

**Requirements Covered:** FR-006

**Design References:** Component 11, Data Flow 3

**Actions:**
1. Open `src/common/budget-tracker.ts`.
2. In the function that writes session budget entries, read `normalizedCacheHitTokens` and `normalizedCacheMissTokens` from the session's accumulated usage.
3. If `normalizedCacheHitTokens` is defined, compute hit rate and savings.
4. Append a row to the budget table: `| Cache | <rate>% hit | <saved> saved |`.
5. If no cache data: omit the row entirely.

**Validation:** Extend existing budget tracker tests — add a test with mock session usage containing normalized cache fields and assert the output includes a `Cache` row.

**Status:** [ ] pending

---

### Task 8: Add cache metrics to `/model-info` output

**Objective:** Show per-model accumulated cache metrics from `/model-info` command.

**Requirements Covered:** FR-007

**Design References:** Component 12

**Actions:**
1. Open `src/ui/core/model-command-handlers.ts`.
2. Find the handler for `/model-info <id>`.
3. Read `usagePerModel[modelId]` from current session state.
4. If `normalizedCacheHitTokens` exists, compute `computeCacheHitRate()` and `computeCacheSavings()`.
5. Append a line: `Cache hit (process): <rate>% | saved <amount>`.
6. If no cache data for the model: omit the line.

**Validation:** Test via slash command test — mock session with usage data and assert `/model-info` output includes the cache line.

**Status:** [ ] pending

---

### Task 9: Full test suite validation and regression check

**Objective:** Ensure zero regressions and 100% new feature test pass.

**Requirements Covered:** ALL

**Design References:** Testing Strategy

**Actions:**
1. Run `npm test` — confirm all existing tests pass (173 pass, 0 fail target).
2. Run `npx tsc --noEmit` — confirm 0 TypeScript errors.
3. Run new cache-metrics tests specifically: `npx tsx --test src/tests/cache-metrics.test.ts` — confirm all pass.
4. Run budget tracker tests, exit summary tests, session tests — confirm modified tests pass.
5. Spot-check with actual DeepSeek API call (manual): verify cache line appears in TUI with non-zero values.

**Validation:** 0 TypeScript errors, 0 test failures, cache line visible in manual smoke test.

**Status:** [ ] pending
