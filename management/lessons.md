# DsCode Lessons Learned

## L1: Layer Multi-Provider Work — Never a Single "Multi-Model" PR

**Date:** 2026-06-09  
**Source:** Spec 30 planning session

**Lesson:** A PR that adds "OpenAI + Anthropic + model selection + cost tracking +
UI changes + tool calling adapters" in one shot is unreviewable and guaranteed to
introduce regressions. Instead, layer the work:

```
PR1: feat: introduce provider-agnostic LLM layer     ← architecture, zero new provider
PR2: feat: add OpenAI provider adapter               ← one new provider
PR3: feat: add Anthropic provider adapter            ← one new provider
PR4: feat: add model selection and configuration      ← UX/config
```

Each PR is small, reviewable, and testable independently.

---

## L2: Colons in Branch Names Break Git Refspecs

**Date:** 2026-06-09  
**Source:** Branch creation for spec 30

**Lesson:** Git branch names with `:` (colon) cause problems with refspecs
(`git push origin feat:name` is ambiguous — is `feat:name` the branch or is
`feat` the local branch and `name` the remote?). Always use `/` instead:

- ❌ `feat: introduce provider-agnostic LLM layer`
- ✅ `feat/provider-agnostic-llm-layer`

---

## L3: Colocate PR Scope with Git History

**Date:** 2026-06-08 (spec 10)  
**Source:** PR stabilization cycle

**Lesson:** When the user asks for "commit only the stabilization fixes" or
"only the CI changes", create a focused commit with only those files. Never
bundle unrelated changes. This keeps `git log` meaningful and `git bisect`
usable.

---

## L4: Don't Revert Intentional Version Bumps

**Date:** 2026-06-09  
**Source:** CI fix for Node 22 → 24

**Lesson:** If `package.json` was intentionally changed to `"engines": { "node": ">=24" }`
and `--target=node24`, don't revert it just because CI has a Node 22 matrix.
Update the CI matrix to match the project's actual requirement. The CI should
reflect reality, not dictate it.

---

## L5: Runner Labels Age Out

**Date:** 2026-06-09  
**Source:** "Release Dry Run" job stuck waiting for `macos-13`

**Lesson:** GitHub deprecates older runner images. When a job shows "Waiting
for a runner to pick up this job..." indefinitely, check whether the requested
runner label (`macos-13`, `ubuntu-20.04`, etc.) has been deprecated. Replace
with `-latest` unless a specific OS version is required for binary compatibility.

---

## L6: Dependency Review Can Fail Without Dependency Changes

**Date:** 2026-06-09  
**Source:** PR #21 Dependency Review check failure

**Lesson:** The GitHub "Dependency Review" action can fail transiently even when
`package.json` and `package-lock.json` have zero dependency changes. Before
changing any code, verify:

```bash
git diff origin/main...HEAD -- package.json package-lock.json
```

If the diff is empty, the failure is not caused by the PR. Re-run the check.
If it persists, consult the GitHub Actions log for the specific vulnerability
or policy violation flagged.

---
