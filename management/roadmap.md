# DsCode Roadmap

## Spec Statuses

| Status | Meaning |
|---|---|
| `proposed` | Idea stage, no spec written yet |
| `planned` | Roadmap entry created via /spec-plan |
| `created` | Spec documents created via /spec-new |
| `verified` | Spec documents verified via /spec-verify |
| `implemented` | Code implemented via /spec-implement |
| `in-progress` | Under active development on a feature branch |
| `audited` | Final stage — implementation audited via /spec-audit. Feature is live. |
| `discarded` | Intentionally abandoned |

---

## Specs

| # | Name | Status | References |
|---|---|---|---|
| 10 | more-effectiveness-and-economy | audited | V6, V8, V11, ADR-005, ADR-006 |
| 20 | tui-scalability | audited | V1, L3 |
| 30 | provider-agnostic-llm-layer | audited | V12, V6, ADR-001, ADR-002, ADR-003, ADR-004, P1, P2, P3, L1, L2 |
| 40 | openai-provider-adapter | audited | V6, V12, ADR-001, ADR-002, ADR-004, ADR-005, P1, P2, P3, P7 |
| 50 | anthropic-provider-adapter | audited | V6, V12, ADR-001, ADR-002, ADR-004, ADR-005, P1, P2, P3, P6, P7 |
| 60 | model-selection-configuration | audited | V13, V6, ADR-002, P7 |
| 70 | google-gemini-provider | audited | V6, V12, ADR-001, ADR-002, ADR-004, ADR-005, P1, P2, P3, P7 |
| 80 | model-engine-configuration-ux | audited | V13, V6, ADR-002, ADR-005, P7, L1 |
| 90 | product-i18n | audited | V14, P6 |
| 100 | steering-management | audited | V15, ADR-006 |
| 110 | skills-inclusion-modes | audited | V16, ADR-006 |
| 120 | explore-subagent | audited | V17, V8, V11, ADR-005, L1 |
| 130 | skills-as-subagents | audited | V17, V16, V8, V11, ADR-005, ADR-006, L1 |
| 140 | mcp-hardening | audited | V18, ADR-006, L1 |
| 150 | skills-mcp | audited | V19, V16, V17, V18, ADR-006, ADR-007, ADR-008 |
| 160 | sdd-mcp | audited | V20, V18, ADR-009, ADR-010 |
| 170 | mcp-tui | audited | V18, V1, L7, ADR-011, ADR-012, ADR-013 |
| 180 | cache-metrics-display | audited | V21, V11, ADR-005 |
| 190 | tool-call-repair | audited | V23, ADR-002 |
| 200 | cache-aware-prompt | audited | V22, V6, ADR-001, ADR-002, ADR-200-001, ADR-200-002, ADR-200-003 |
| 210 | cache-aware-compaction | audited | V22, V8, ADR-005 |
| 220 | pro-first-modes | discarded | V25, V13 — descartada: não agregava valor (atalhos para settings já expostas) |
| 230 | deepseek-native-parser | discarded | V24, V6, V12, ADR-001, ADR-002 — descartada: ganho marginal, tudo relevante já funciona |
| 240 | auditabilidade | discarded | V26 — descartada: zero impacto no uso diário (SHA256, SBOM, build provenance, privacy policy, threat model são documentação/infra de confiança, não features de produto) |
| 250 | billing-completeness | audited | V27, V11, V21, ADR-005 |
| 260 | developer-notes | audited | V28 |
| 260A | notes-mvp | audited | V28 (child of 260) |
| 260B | notes-refinement | audited | V28 (child of 260) |
| 270 | code-quality-cleanup | audited | V30 |
| 280 | error-handling-hardening | audited | V29, L7 |
| 290 | test-infra-error-visibility | audited | V29, L7 |
| 300 | dynamic-help-modal | audited | V30, V1 |
| 320 | session-module-split | audited | V31, L1 |
| 330 | compaction-pure-extract | audited | V31 (child of 320) |
| 340 | mcp-lifecycle-extract | audited | V31 (child of 320) |
| 350 | session-cleanup | audited | V31 (child of 320) |
| 360 | context-status-and-clear | audited | V32 |

---

## Dependency Graph

```
Spec 30 (provider-agnostic LLM layer)
  ├── Spec 40 (OpenAI adapter)
  ├── Spec 50 (Anthropic adapter)
  ├── Spec 60 (model selection & config)
  │     └── Spec 80 (engine config UX)
  └── Spec 70 (Google Gemini adapter)

Spec 90 (product i18n)
  (standalone — no dependencies on other specs)

Spec 100 (steering management)
  (standalone — builds on existing AGENTS.md infrastructure)

Spec 110 (skills inclusion modes)
  (standalone — builds on existing SKILL.md infrastructure)

Spec 120 (explore subagent)
  (standalone — builds on existing tool infrastructure, web-search-handler pattern)

Spec 130 (skills as subagents)
  └── depends on Spec 120 (subagent runner infrastructure from explore-subagent)

Spec 140 (mcp-hardening)
     (standalone — builds on existing McpManager, McpClient, steering)

Spec 150 (skills-mcp)
  ├── depends on Spec 110 (skills inclusion modes)
  ├── depends on Spec 130 (subagent infrastructure)
  └── depends on Spec 140 (MCP policy runtime)

Spec 160 (sdd-mcp)
  └── depends on Spec 140 (MCP policy runtime)
  └── depends on Spec 150 (skill MCP infrastructure for server lifecycle)

Spec 170 (mcp-tui)
  └── depends on Spec 140 (MCP policy runtime for data)
  └── (can start in parallel with 150, 160)
```

Spec 30 is the **required precursor** to 40, 50, 60, and 70. The provider interface
(`ILlmProvider`) defined in spec 30 is what 40, 50, and 70 implement, and what spec 60
exposes to the user through configuration and the `/model` command.

Specs 40, 50, and 70 are independent of each other but all depend on 30. Spec 60 can
start as soon as 30 lands, but full end-to-end testing requires at least one
additional provider (40, 50, or 70).

Spec 80 depends on Spec 60 for `MODEL_CATALOG`, `getModelCapabilities`, and the
`engines` settings namespace. It extends the `/model` command with subcommands
for provider management, generation parameters, and thinking budget tuning.

```
Spec 180 (cache metrics display)
  (standalone — enhances existing ModelUsage types and TUI display)

Spec 190 (tool-call repair)
  (standalone — new repair pipeline in tool executor, no external dependencies)

Spec 200 (cache-aware prompt)
  (standalone — modifies system prompt construction in prompt.ts/session.ts)

Spec 210 (cache-aware compaction)
  └── depends on Spec 200 (needs stable prefix concept from cache-aware prompt)

Spec 220 (pro-first modes)
  └── depends on Spec 200 (needs cacheMode setting from cache-aware prompt)

Spec 230 (deepseek native parser)
  (standalone — new response parser, can start in parallel with 180-220)

Spec 240 (auditabilidade)
  (standalone — CI/build configuration only, no code dependencies)

Spec 250 (billing-completeness)
  (standalone — fixes existing bug: normalizeCacheTokens before recordBudgetCost in 6 missing call sites)

Spec 260A (notes-mvp)
  (standalone — new notes.ts module, notes.json storage, 3 slash commands)

Spec 260B (notes-refinement)
  └── depends on Spec 260A (needs notes.ts core from notes-mvp)

Spec 270 (code-quality-cleanup)
  (standalone — small DRY fixes in slash-commands.ts, notes.ts, command-handlers.ts, prompt-buffer.ts, session.ts)

Spec 280 (error-handling-hardening)
  (standalone — replaces bare catch {} with stderr logging; enhances error-classification.ts)

Spec 290 (test-infra-error-visibility)
  (standalone — captures worker stderr in run-tests.mjs to expose real import errors)

Spec 300 (dynamic-help-modal)
  (standalone — generates HelpModal shortcut list from BUILTIN_SLASH_COMMANDS at runtime)

Spec 320 (session-module-split)
  (standalone — mechanical extraction of session.ts into focused modules; zero behavior change)
  ├── Spec 330 (compaction-pure-extract)
  │     (child of 320 — pure compaction functions ~140 lines, zero coupling to SessionManager)
  ├── Spec 340 (mcp-lifecycle-extract)
  │     (child of 320 — MCP lifecycle extraction, depends on 330 for analysis pattern)
  └── Spec 350 (session-cleanup)
        (child of 320 — depends on 330 and 340 being complete)

Spec 360 (context-status-and-clear)
  (standalone — new /context and /clear local commands, zero LLM calls)
```

---
