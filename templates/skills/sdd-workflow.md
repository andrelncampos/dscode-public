---
name: sdd-workflow
description: DsCode SDD workflow and spec status lifecycle. Use when working with specs, roadmap, or any SDD-related task.
---

# SDD Workflow (Spec-Driven Development)

## Spec Lifecycle

The DsCode SDD workflow has exactly 4 steps in strict order:

```
1. /spec-new     → creates requirements.md, design.md, task.md; status = "planned"
2. /spec-verify  → validates implementation against requirements; status = "in-progress"
3. /spec-implement → writes the actual code; status = "done"
4. /spec-audit   → final review; status = "audited"
```

## Status Meanings

| Status | Meaning | SDD Step |
|--------|---------|----------|
| `proposed` | Idea stage, no spec written yet | Before step 1 |
| `planned` | Spec documents created, not implemented | After step 1 |
| `in-progress` | Under active development | During steps 2-3 |
| `done` | Implementation complete | After step 3 |
| `audited` | **Final stage.** Spec was implemented AND audited. Feature is live. | After step 4 |

## Critical Rule

**`audited` = the spec is DONE and the feature is LIVE.**

When you see a spec with status `audited` in the roadmap, the feature has already been:
- Implemented
- Verified
- Audited

Do NOT create child specs or plan additional work for features marked as `audited`.
If you think an audited spec needs changes, treat it as a NEW spec (new number),
not as incomplete work on the existing one.

## Roadmap Interpretation

When analyzing the roadmap (`management/roadmap.md`):
- `done` + `audited` = feature is complete and live
- `planned` = spec exists but not yet implemented
- `in-progress` = currently being worked on
- `proposed` = idea only, no spec documents
- `discarded` = intentionally abandoned

## Spec Documents

Each spec lives in `management/specs/<N>-<name>/` and contains:
- `requirements.md` — what the spec delivers (the contract)
- `design.md` — architecture and implementation plan
- `task.md` — checklist of implementation steps
