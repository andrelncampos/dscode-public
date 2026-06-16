---
name: sdd-workflow
description: DsCode SDD workflow and spec status lifecycle. Use when working with specs, roadmap, or any SDD-related task.
---

# SDD Workflow (Spec-Driven Development)

## Complete Flow

The DsCode SDD workflow has 5 steps in strict order:

```
1. /spec-plan      → plans specs from brainstorming, updates roadmap; status = "planned"
2. /spec-new <n>   → creates requirements.md, design.md, task.md
3. /spec-verify <n> → verifies + auto-corrects spec documents; status = "created"
4. /spec-implement <n> → writes code sequentially, task by task; status = "done"
5. /spec-audit <n>  → audits + auto-corrects implementation; status = "audited"
```

Both `/spec-verify` and `/spec-audit` are **idempotent**: run them as many times as needed until zero issues found.

## Status Meanings

| Status | Meaning | SDD Step |
|--------|---------|----------|
| `proposed` | Idea stage, no spec written yet | Before step 1 |
| `planned` | Roadmap entry created after /spec-plan | After step 1 |
| `created` | Spec documents verified and auto-corrected | After step 3 |
| `in-progress` | Code being written on a feature branch | During step 4 |
| `done` | Implementation complete, merged to main | After step 4 |
| `audited` | **Final stage.** Implementation audited, all fixes applied. Feature is live. | After step 5 |
| `discarded` | Intentionally abandoned | N/A |

## Critical Rule

**`audited` = the spec is DONE and the feature is LIVE.**

When you see a spec with status `audited` in the roadmap, it means:
- Spec was planned and documents were created
- Spec documents were verified and auto-corrected (status: created)
- Code was implemented (status: done)
- Implementation was audited and auto-corrected (status: audited)

Do NOT create child specs or plan additional work for features marked as `audited`.
If you think an audited spec needs changes, treat it as a NEW spec (new number),
not as incomplete work on the existing one.

## Roadmap Interpretation

When analyzing the roadmap (`management/roadmap.md`):
- `audited` = **done.** Implementation audited, all fixes applied, feature is live.
- `done` = implementation complete (not yet audited)
- `created` = spec documents verified and auto-corrected, ready for implementation
- `in-progress` = code being written
- `planned` = roadmap entry exists, spec documents not yet verified
- `proposed` = idea only, no spec documents
- `discarded` = intentionally abandoned

## Spec Documents

Each spec lives in `management/specs/<N>-<name>/` and contains:
- `requirements.md` — what the spec delivers (the contract)
- `design.md` — architecture and implementation plan
- `task.md` — checklist of implementation steps
