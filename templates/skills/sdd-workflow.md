---
name: sdd-workflow
description: DsCode SDD workflow and spec status lifecycle. Use when working with specs, roadmap, or any SDD-related task.
---

# SDD Workflow (Spec-Driven Development)

## Spec Lifecycle

The DsCode SDD workflow has exactly 4 steps in strict order:

```
1. /spec-new       → creates requirements.md, design.md, task.md; status = "planned"
2. /spec-verify    → verifies spec documents are correct; status = "verified"
3. /spec-implement → writes the actual code; status = "done"
4. /spec-audit     → audits implementation correctness against spec; status = "audited"
```

## Status Meanings

| Status | Meaning | SDD Step |
|--------|---------|----------|
| `proposed` | Idea stage, no spec written yet | Before step 1 |
| `planned` | Spec documents created, not implemented | After step 1 |
| `verified` | Spec documents verified as correct | After step 2 |
| `in-progress` | Code being written on a feature branch | During step 3 |
| `done` | Implementation complete, merged to main | After step 3 |
| `audited` | **Final stage.** Implementation audited — matches spec. Feature is live. | After step 4 |
| `discarded` | Intentionally abandoned | N/A |

## Critical Rule

**`audited` = the spec is DONE and the feature is LIVE.**

When you see a spec with status `audited` in the roadmap, it means:
- Spec documents were created and verified
- Code was implemented
- Implementation was audited for correctness against the spec

Do NOT create child specs or plan additional work for features marked as `audited`.
If you think an audited spec needs changes, treat it as a NEW spec (new number),
not as incomplete work on the existing one.

## Roadmap Interpretation

When analyzing the roadmap (`management/roadmap.md`):
- `audited` = **done.** Implementation audited, matches spec, feature is live.
- `done` = implementation complete (not yet audited)
- `verified` = spec documents checked, ready for implementation
- `in-progress` = code being written
- `planned` = spec documents exist, not yet implemented
- `proposed` = idea only, no spec documents
- `discarded` = intentionally abandoned

## Spec Documents

Each spec lives in `management/specs/<N>-<name>/` and contains:
- `requirements.md` — what the spec delivers (the contract)
- `design.md` — architecture and implementation plan
- `task.md` — checklist of implementation steps
