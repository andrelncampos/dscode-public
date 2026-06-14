# Spec 180: Cache Metrics Display — Requirements

## Value Delivery

From `vision.md` V21: Cache Metrics Visibility:

> Real-time visibility into LLM prompt cache efficiency — showing users exactly how much they save through cache hits, not just total token consumption.
>
> - **Cache hit rate:** Percentage of input tokens served from cache (`hit / (hit + miss) * 100`). Displayed per-turn in the TUI and aggregated per-session in the exit summary.
> - **Cache read cost:** Monetary savings from cached tokens, calculated using each provider's `cacheReadPrice`. Shown alongside total cost (e.g., `Cache: 91% hit | saved $0.42`).
> - **Provider normalization:** Each provider reports cache differently (DeepSeek: `prompt_cache_hit_tokens`, OpenAI: `prompt_tokens_details.cached_tokens`, Anthropic: `cache_read_input_tokens`). All are normalized into a common `ModelUsage` field.
> - **Per-session tracking:** Cache metrics recorded in `budget.md` for auditability.
> - **Provider-aware display:** Metrics adapt to provider — show cache data when available, hide gracefully when the provider doesn't support prompt caching.

Also enhances `vision.md` V11: Cost-Optimized AI Operations — cache read cost contributes to systematic token cost minimization visibility.

---

## Functional Requirements

### FR-001: Compute Cache Hit Rate

**What:** For each API call that returns usage data, compute `cacheHitRate = hit / (hit + miss) * 100` where `hit` is the number of cached input tokens and `miss` is the number of non-cached input tokens.

**Why:** Cache hit rate is the primary metric for understanding DeepSeek KV cache efficiency. V21 requires showing this to the user.

**Acceptance Criteria:**
- [ ] `cacheHitRate` is computed as a float (0.0–100.0) with 1 decimal precision.
- [ ] When `hit + miss === 0` (no cache data), `cacheHitRate` is `null`, not `NaN` or `0`.
- [ ] When `hit > 0 && miss === 0`, `cacheHitRate` is `100.0` (not division by zero).
- [ ] When `hit === 0 && miss > 0`, `cacheHitRate` is `0.0`.
- [ ] The rate is computed from normalized cache tokens (FR-003), not raw provider fields.

### FR-002: Compute Cache Read Savings

**What:** For each API call, compute `cacheSavings = cachedTokens / 1_000_000 * pricing.cacheReadPrice` — the estimated USD saved by reading tokens from cache instead of paying full input price.

**Why:** Monetary savings make cache efficiency tangible to users. V21 requires showing "saved $X.XX".

**Acceptance Criteria:**
- [ ] `cacheSavings` computed in USD as a float with ≥2 decimal precision.
- [ ] Uses the same `cachedTokens` value from normalized cache tokens (FR-003).
- [ ] Uses `ModelPricing.cacheReadPrice` from the model's pricing configuration.
- [ ] When provider has no `cacheReadPrice` configured, `cacheSavings` is `0.00`.
- [ ] When `cachedTokens === 0`, `cacheSavings` is `0.00`.

### FR-003: Normalize Cache Tokens Across Providers

**What:** Convert each provider's cache token fields into a single normalized `ModelUsage` representation. The `ModelUsage` type gains two new fields: `normalizedCacheHitTokens` (the resolved hit count) and `normalizedCacheMissTokens` (the resolved miss count).

**Why:** DeepSeek uses `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`. OpenAI uses `prompt_tokens_details.cached_tokens`. Anthropic uses `cache_read_input_tokens` at the usage level. Without normalization, display code must branch per provider — violating V12 (Provider-Agnostic LLM Architecture).

**Acceptance Criteria:**
- [ ] `ModelUsage` type gains `normalizedCacheHitTokens?: number` and `normalizedCacheMissTokens?: number`.
- [ ] Normalization logic extracts from `prompt_cache_hit_tokens` + `prompt_cache_miss_tokens` (DeepSeek pattern), `prompt_tokens_details.cached_tokens` + derived miss (OpenAI pattern), or `usage.cache_read_input_tokens` (Anthropic pattern).
- [ ] Normalization runs in `SessionManager` after receiving `ModelUsage` from the provider, NOT in the provider itself (provider-agnostic).
- [ ] When no cache data exists, both fields are `undefined` (not `0`).
- [ ] Cache miss tokens are computed as `prompt_tokens - cachedTokens` when the provider reports only `cachedTokens` without explicit `miss` field.
- [ ] `normalizedCacheMissTokens` is never negative — `Math.max(0, prompt_tokens - hit)`.
- [ ] Existing code that reads `prompt_cache_hit_tokens` or `prompt_tokens_details.cached_tokens` continues to work unchanged — normalization is additive, not a replacement.

### FR-004: Display Cache Metrics in TUI (Per-Turn)

**What:** During an active session, after each LLM response, show a compact cache efficiency line in the TUI status area. Format: `Cache: <rate>% hit | saved $<amount>`.

**Why:** V21 requires real-time visibility during the session, not just at exit.

**Acceptance Criteria:**
- [ ] Cache line appears after `usage` event is received and processed.
- [ ] Line is hidden (not rendered) when no cache data exists (`normalizedCacheHitTokens` is `undefined`).
- [ ] Line uses dim formatting to avoid distracting from conversation content.
- [ ] Format: `Cache: 91.2% hit | saved $0.42` with 1 decimal rate precision and 2 decimal dollar precision.
- [ ] When `cacheHitRate` is 100.0: `Cache: 100% hit | saved $0.42` (no decimal for clean 100%).
- [ ] When `cacheSavings` is $0.00: `Cache: 91.2% hit | saved <$0.01` (avoid showing $0.00 as saved; it looks broken).
- [ ] Line width must not cause Ink layout issues (max ~40 chars).
- [ ] Line is the last visible status element, below cost display (`⚡ tokens 💰 cost`).

### FR-005: Display Cache Metrics in Exit Summary

**What:** When the user exits a session (Ctrl+C, `/exit`, or natural completion), the exit summary must include an aggregated cache efficiency line.

**Why:** V21 requires session-level aggregation. The exit summary is where users review total cost and stats.

**Acceptance Criteria:**
- [ ] Exit summary includes `Cache (session): <rate>% hit | saved $<amount>`.
- [ ] Rate is computed from accumulated `normalizedCacheHitTokens` and `normalizedCacheMissTokens` across all turns in the session.
- [ ] Savings is the sum of `cacheSavings` across all turns.
- [ ] When no cache data exists for the entire session, the line is omitted entirely (not shown as "0%" or "$0.00").
- [ ] The line is formatted consistently with FR-004 (same precision, same dim style).

### FR-006: Record Cache Metrics in `budget.md`

**What:** For each session, append cache efficiency data to the session's budget entry in `budget.md`.

**Why:** V21 requires per-session tracking for auditability. `budget.md` is the existing mechanism for cost audit trails.

**Acceptance Criteria:**
- [ ] Each session entry in `budget.md` gains a `Cache` row.
- [ ] Format: `| Cache | <rate>% hit | <saved> saved |` aligned with existing budget table columns.
- [ ] Row is omitted when no cache data exists for the session.
- [ ] Existing budget rows (pre-spec-180) are unchanged.

### FR-007: Display Cache Metrics in `/model-info`

**What:** The `/model-info <id>` slash command output includes accumulated cache metrics for that model across all sessions in the current process.

**Why:** Users need to see which model delivers the best cache efficiency. V13 (Model Selection) is enhanced by this visibility.

**Acceptance Criteria:**
- [ ] `/model-info` output includes `Cache hit (process)` line showing accumulated rate and savings for that model.
- [ ] Data is scoped to the current DsCode process (not persisted across restarts — that requires storage migration, out of scope).
- [ ] When no cache data exists for the model, the line is omitted.

### FR-008: Provider-Aware Display

**What:** Cache metrics adapt to what the current provider supports. DeepSeek and OpenAI show cache data. Anthropic shows cache data when available. Gemini hides cache data (no prompt caching API).

**Why:** V21 requires showing data "when available" and hiding "when the provider doesn't support prompt caching." Avoid showing misleading "0% hit" for providers that simply don't report cache.

**Acceptance Criteria:**
- [ ] `BaseOpenAICompatibleProvider` (DeepSeek, OpenAI) always attempts to extract cache tokens.
- [ ] `AnthropicProvider` extracts `cache_read_input_tokens` from usage response when present.
- [ ] `GeminiProvider` returns `undefined` for cache fields (no prompt caching support).
- [ ] TUI, exit summary, and budget.md all honor the `undefined` state — no "Cache: 0% hit" displayed.
- [ ] Provider capability for cache is NOT inferred from model name — it is determined by the presence/absence of cache data in the API response.

---

## Non-Functional Requirements

### NFR-001: Performance

**What:** Cache metric computation must not add measurable latency to LLM response display.

**Acceptance Criteria:**
- [ ] NormalizeCacheTokens() executes in O(1) — simple arithmetic and field access.
- [ ] No network calls, no file I/O for cache metrics computation.
- [ ] Render path: cache metrics line is a simple text element, no additional Ink re-renders.

### NFR-002: Maintainability

**What:** Cache normalization logic must be a single pure function, testable in isolation.

**Acceptance Criteria:**
- [ ] `normalizeCacheTokens(usage: ModelUsage): NormalizedCacheTokens` is exported and unit-testable.
- [ ] TypeScript compilation enforces the new `ModelUsage` fields (no `any` cast).
- [ ] Existing tests pass unchanged — no regression in budget tracking, exit summary, or model info.

### NFR-003: Backward Compatibility

**What:** Sessions saved before spec 180 (without normalized cache fields) load and display correctly.

**Acceptance Criteria:**
- [ ] `ModelUsage` fields `normalizedCacheHitTokens` and `normalizedCacheMissTokens` are `?: number` (optional).
- [ ] Loading a pre-180 session from disk: cache line omitted in exit summary, no error.
- [ ] Budget entries written before 180 have no `Cache` row — display code handles missing row gracefully.

---

## Constraints

- **C1:** Must use existing `ModelUsage` type — no new top-level cache type. Fields added to `ModelUsage` as optional numbers.
- **C2:** Must reuse existing `computeUsageCost()` logic from `src/common/model-capabilities.ts:52-66`. Do not duplicate cost computation.
- **C3:** Must follow ADR-005: cache savings computation uses `cacheReadPrice` from `DEFAULT_MODEL_PRICING` or user-configured pricing, not hardcoded strings.
- **C4:** Must follow V12 (Provider-Agnostic LLM Architecture): normalization is in `SessionManager`, not inside providers.
- **C5:** Ink layout rules from L9 — cache line must be simple text (`<Text dimColor>Cache: ...</Text>`) with no nested `width` or `flexGrow`.

---

## Edge Cases & Error States

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 1 | Provider returns `prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0` | `cacheHitRate = null` (not 0% — distinguishes "no cache data" from "0% cache efficiency") |
| 2 | Provider returns `prompt_cache_hit_tokens: undefined` | `normalizedCacheHitTokens = undefined`, cache line hidden |
| 3 | Provider returns `prompt_tokens_details: { cached_tokens: 500 }` but `prompt_tokens: 500` | `hit = 500`, `miss = prompt_tokens - hit = 0`, `cacheHitRate = 100.0` |
| 4 | Provider returns `prompt_tokens_details.cached_tokens` > `prompt_tokens` (API quirk) | `miss = Math.max(0, prompt_tokens - cached)` — clamps to 0 |
| 5 | Provider returns `prompt_cache_miss_tokens` but `prompt_cache_hit_tokens` is undefined | `hit = 0, miss = reported miss, rate = 0.0` |
| 6 | User switches model mid-session | Cache metrics accumulate per-provider/per-model in `UsagePerModel`. Correct model's cache data is shown. |
| 7 | Session has 500 turns, cache data on only 3 | Aggregated rate uses only the 3 turns with cache data. Total savings = sum of only those 3. |
| 8 | `cacheReadPrice` is `0` (non-DeepSeek model without configured pricing) | `cacheSavings = 0.00`. Line shows `Cache: 91.2% hit | saved <$0.01` |
| 9 | `budget.md` file does not exist yet | Cache data is omitted (budget.md created only when first budget entry is written). |
| 10 | Anthropic `cache_read_input_tokens` is a nested field not at top level | Normalizer checks both `usage.cache_read_input_tokens` and `usage.usage?.cache_read_input_tokens` |
| 11 | Cache hit rate is exactly integer (e.g., 100.0, 0.0) | Display as `100%` and `0%` without `.0` decimal |
| 12 | Multiple API calls per turn (retry, subagent) | Cache metrics accumulate per-call, not per-turn. Exit summary shows accumulated total. |
| 13 | Provider has `prompt_tokens_details.rejected_tokens` (Anthropic) or `reasoning_tokens` | These are ignored — only cache-related fields are normalized. |

---

## Dependencies

- **None.** No other specs required. This spec works with the existing `ModelUsage` type, `computeUsageCost()`, and TUI display infrastructure.
- Uses `src/session.ts` — `ModelUsage`, `SessionEntry`, `accumulateUsage`, `accumulateUsagePerModel`
- Uses `src/common/model-capabilities.ts` — `DEFAULT_MODEL_PRICING`, `computeUsageCost`
- Uses `src/ui/exit-summary.ts` — existing exit summary rendering
- Uses `src/common/budget-tracker.ts` — existing budget.md writing

---

## Out of Scope

- Cache hit rate persistence across DsCode process restarts (requires storage migration).
- Cache optimization (changing prompt structure to improve cache hit — that's spec 200).
- Cache-aware compaction (that's spec 210).
- Cache visualization per-skill or per-spec (out of scope — FR-004 covers per-turn only).
- Cache metrics in the MCP TUI panel (out of scope — `/mcp` already has execution history).
- Cache data for Gemini (Gemini has no prompt caching API; expected to return undefined).
- Real-time cache graph or chart (terminal UI constraint).
- Cache warm-up status ("cache building..." / "cache ready") — out of scope, requires API support.
