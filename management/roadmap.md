# DsCode Roadmap

## Spec Statuses

| Status | Meaning |
|---|---|
| `done` | Implemented, merged to main |
| `in-progress` | Under active development on a feature branch |
| `planned` | Spec written, not yet started |
| `proposed` | Idea stage, no spec written yet |

---

## Specs

| # | Name | Status | References |
|---|---|---|---|
| 10 | more-effectiveness-and-economy | done | V6, V8, V11, ADR-005, ADR-006 |
| 20 | tui-scalability | done | V1, L3 |
| 30 | provider-agnostic-llm-layer | audited | V12, V6, ADR-001, ADR-002, ADR-003, ADR-004, P1, P2, P3, L1, L2 |
| 40 | openai-provider-adapter | audited | V6, V12, ADR-001, ADR-002, ADR-004, ADR-005, P1, P2, P3, P7 |
| 50 | anthropic-provider-adapter | audited | V6, V12, ADR-001, ADR-002, ADR-004, ADR-005, P1, P2, P3, P6, P7 |
| 60 | model-selection-configuration | audited | V13, V6, ADR-002, P7 |

---

## Dependency Graph

```
Spec 30 (provider-agnostic LLM layer)
  ├── Spec 40 (OpenAI adapter)
  ├── Spec 50 (Anthropic adapter)
  └── Spec 60 (model selection & config)
```

Spec 30 is the **required precursor** to 40, 50, and 60. The provider interface
(`ILlmProvider`) defined in spec 30 is what 40 and 50 implement, and what spec 60
exposes to the user through configuration and the `/model` command.

Specs 40 and 50 are independent of each other but both depend on 30. Spec 60 can
start as soon as 30 lands, but full end-to-end testing requires at least one
additional provider (40 or 50).

---
