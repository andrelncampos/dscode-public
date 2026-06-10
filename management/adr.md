# DsCode Architecture Decision Records

## ADR-001: OpenAI SDK as Baseline Provider Library

**Date:** 2026-06 (project inception)

**Context:** The first LLM provider integrated was DeepSeek V4, which exposes an
OpenAI-compatible API. The `openai` npm package can target any base URL, making it
usable for DeepSeek without additional dependencies.

**Decision:** Use the `openai` npm package as the HTTP/client layer for all
OpenAI-compatible providers (DeepSeek, OpenAI, and any custom compatible endpoint).
Anthropic requires its own SDK (`@anthropic-ai/sdk`) due to incompatible API shape.

**Consequences:**
- `openai-client.ts` serves both DeepSeekProvider and OpenAIProvider.
- `openai-message-converter.ts` is shared by both — they emit the same wire format.
- AnthropicProvider must implement its own message conversion and streaming.

---

## ADR-002: Provider Interface Pattern

**Date:** 2026-06-09

**Context:** The codebase is tightly coupled to the OpenAI SDK. Adding OpenAI and
Anthropic support without an abstraction would create branching in `session.ts` and
duplicate streaming logic. The decision is whether to create a provider interface now
(spec 30) or defer it until multiple providers exist.

**Decision:** Create `ILlmProvider` now as a prerequisite for any additional provider.
The first implementation (DeepSeekProvider) is a mechanical extraction — zero behavior
change. This validates the interface design before introducing the complexity of a new
provider.

**Alternatives considered:**
- **Defer abstraction:** Add OpenAI inline, abstract later. Rejected — would create
  technical debt and make the eventual abstraction harder to design (needs to
  accommodate two unknown implementations instead of one known).
- **Adapter pattern per-method:** One interface per operation (chat, models, etc.).
  Rejected — overcomplicates the boundary. A single `chat()` method with a unified
  stream event type is sufficient.

**Consequences:**
- `ILlmProvider` lives at `src/common/llm-provider.ts`.
- `SessionManager` loses its direct dependency on the `openai` SDK.
- Every future provider must implement the interface — enforced by TypeScript.

---

## ADR-003: Streaming-First Design

**Date:** 2026-06 (project inception)

**Context:** CLI users expect real-time feedback. Non-streaming responses would show
a loading indicator for the full API round-trip before displaying any content.

**Decision:** All LLM communication is streaming. The non-streaming path does not
exist in the codebase. The stream is consumed as an `AsyncIterable<LlmStreamEvent>`,
which allows the UI to render partial content and tool calls as they arrive.

**Consequences:**
- Provider implementations must yield stream events, not return whole responses.
- `SessionManager.createChatCompletionStream()` handles stream consumption and
  aggregation.
- Timeouts and aborts are handled at the stream level (per-chunk, not per-request).

---

## ADR-004: SessionMessage as Canonical Message Format

**Date:** 2026-06 (project inception)

**Context:** Each LLM provider has a different wire format for messages (OpenAI
Chat Completions API, Anthropic Messages API, etc.). Converting between them at
every call site would be error-prone and verbose.

**Decision:** `SessionMessage` is the single canonical format. All internal state
(session storage, context compaction, tool pairing) operates on `SessionMessage[]`.
Conversion to provider-specific formats happens at the boundary, inside each
provider's message converter.

**Consequences:**
- `OpenAIMessageConverter` is shared by DeepSeek and OpenAI providers.
- AnthropicProvider will need its own `AnthropicMessageConverter`.
- `SessionMessage` must remain stable — adding fields requires updating all
  converters.

---

## ADR-005: Hardcoded Flash Model for Compaction

**Date:** 2026-06-08 (spec 10)

**Context:** Context compaction is an internal optimization, not a user-facing feature.
Making the compaction model configurable would add settings surface area, validation,
and documentation burden.

**Decision:** The compaction model is hardcoded as `"deepseek-v4-flash"` in
`compactSession()`. It is not read from settings.

**Consequences:**
- When provider-agnostic architecture lands (spec 30), this must be generalized:
  each provider must be able to resolve a "cheapest thinking-disabled model" for
  compaction. The hardcoded string will move into `DeepSeekProvider.getCompactionModel()`.

---

## ADR-006: Synchronous Keyword Matching for Skills

**Date:** 2026-06-08 (spec 10)

**Context:** The previous implementation made an LLM API call per user message to
match skills to prompts, effectively doubling cost per interaction.

**Decision:** Replace with synchronous, deterministic `matchSkillsByKeywords()`
using case-insensitive substring matching. No embeddings, vector search, or ML.

**Consequences:**
- Zero API cost for skill matching.
- Simplifies `SessionManager` by removing async `identifyMatchingSkillNames()`.
- May need revisiting if the number of skills grows beyond ~20 and keyword
  collisions become common.

---
