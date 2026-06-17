---
name: sdd-workflow
description: DsCode SDD workflow and spec status lifecycle. Use when working with specs, roadmap, or any SDD-related task.
---

# SDD Workflow (Spec-Driven Development)

## Complete Flow

The DsCode SDD workflow has 5 steps in strict order. Each command sets a specific status:

```
1. /spec-plan       → status = "planned"
2. /spec-new <n>    → status = "created"
3. /spec-verify <n> → status = "verified"
4. /spec-implement <n> → status = "implemented"
5. /spec-audit <n>  → status = "audited"
```

Both `/spec-verify` and `/spec-audit` are **idempotent**: run them as many times as needed until zero issues found.

## Status Meanings

| Status | Meaning | SDD Step |
|--------|---------|----------|
| `proposed` | Idea stage, no spec written yet | Before step 1 |
| `planned` | Roadmap entry created after /spec-plan | After step 1 |
| `created` | Spec documents created after /spec-new | After step 2 |
| `verified` | Spec documents verified and auto-corrected | After step 3 |
| `in-progress` | Code being written on a feature branch | During step 4 |
| `implemented` | Implementation complete, merged to main | After step 4 |
| `audited` | **Final stage.** Implementation audited, all fixes applied. Feature is live. | After step 5 |
| `discarded` | Intentionally abandoned | N/A |

## Critical Rule

**`audited` = the spec is DONE and the feature is LIVE.**

When you see a spec with status `audited` in the roadmap, it has completed the full SDD cycle:
1. Planned → 2. Created → 3. Verified → 4. Implemented → 5. Audited

Do NOT create child specs or plan additional work for features marked as `audited`.
If you think an audited spec needs changes, treat it as a NEW spec (new number),
not as incomplete work on the existing one.

## Roadmap Interpretation

When analyzing the roadmap (`management/roadmap.md`):
- `audited` = **done.** Feature is live.
- `implemented` = code complete, not yet audited
- `verified` = spec documents checked, ready for implementation
- `created` = spec documents exist, not yet verified
- `planned` = roadmap entry exists, spec documents not yet created
- `in-progress` = code being written
- `proposed` = idea only
- `discarded` = intentionally abandoned

## Spec Documents

Each spec lives in `management/specs/<N>-<name>/` and contains:
- `requirements.md` — what the spec delivers (the contract)
- `design.md` — architecture and implementation plan
- `task.md` — checklist of implementation steps

## Direction of development

This project will be developed, maintained, and evolved by autonomous AI. Therefore, every technical, architectural, documentary, operational, and organizational decision must be optimized for autonomous AI execution across the entire software lifecycle.

When working on this project, always prioritize clarity, traceability, predictability, automation, testability, objective documentation, and low coupling. The code, architecture, processes, scripts, tests, commit patterns, error messages, configuration files, and documentation must be written in a way that allows an AI agent to understand, modify, validate, maintain, debug, and evolve the system with the lowest possible ambiguity and the least possible dependency on external context.

This directive applies to all phases of the project, including conception, planning, implementation, refactoring, testing, review, build, packaging, distribution, publishing, support, corrective maintenance, evolutionary maintenance, technical auditing, and post-production operation.

Whenever there is a choice between a solution that is more “elegant” but implicit and a solution that is clearer, more explicit, and easier for an AI agent to operate safely, choose the clearer and more explicit solution. The goal is to maximize the autonomy, safety, reliability, and efficiency of AI as the primary development agent for this software.

