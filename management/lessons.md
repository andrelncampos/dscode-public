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

## L7: Terminal UI Features Are Untestable — The `isTTY` Curse

**Date:** 2026-06-10
**Source:** Implementing "DsCode - {{cwd}}" window title via ANSI OSC sequences

**Lesson:** Terminal UI features that rely on ANSI OSC escape sequences
(`\x1b]0;...\x07`) — window titles, progress bars, cursor control — are
fundamentally **untestable in automated test suites**. The root cause:
`process.stdout.isTTY` returns `false` whenever stdout is piped or redirected
(exactly what `npm test` does). End result: "works on my machine" is the only
possible verdict. Thousands of test iterations may pass or fail with zero
visible change because the escape sequences are silently swallowed.

Palliative strategies:

1. **Separate logic from side-effect.** Template rendering (`{{cwd}}`, `{{model}}`,
   `{{session}}`) is unit-testable; the OSC emission is not. Test the former,
   manually smoke-test the latter.
2. **Smoke-test across target terminals manually.** Windows Terminal, Git
   Bash/mintty, CMD (Win10 1511+), xterm — ANSI/VT support varies wildly.
3. **Accept silent failures in exotic terminals.** The cost of discovering
   that a specific terminal emulator ignores OSC 0 is acceptable compared to
   the benefit the feature provides to the 95% of users on mainstream terminals.
4. **Never gate critical functionality on terminal features.** The app must
   work perfectly with a plain file descriptor. Titles, colors, and progress
   bars are decoration — never load-bearing.

---

## L8: Terminal Title Verification Requires a Brand-New Terminal Window

**Date:** 2026-06-11
**Source:** Fixing "DsCode - {{cwd}}" to show the full path instead of just the basename

**Lesson:** Three interconnected discoveries:

### 8a. `path.basename()` silently destroys information

The template `{{cwd}}` was resolved via `path.basename(process.cwd())` in three
places (`session.ts` lines ~380, ~454, ~850). This turned `C:\git\dscode` into
just `dscode`. The title showed `"DsCode - dscode"` and appeared to work, but
the full path was never visible. **Lesson:** `path.basename()` on a template
variable is almost never what you want — prefer the raw path unless you have
a specific reason to shorten it.

### 8b. Three call sites, one concept

The same `path.basename(process.cwd())` appeared in three locations:
1. Constructor: initial title setup
2. `updateTerminalTitle()`: dynamic update on session change
3. `createSession`/`replySession`: after session creation

All three must be kept in sync. A single missed call site produces inconsistent
behavior where the title shows different values at different times.

### 8c. You MUST open a new terminal to verify the fix

With Windows CMD specifically (and likely others), changes to the terminal
title via OSC 0 escape sequences **only take effect when a new terminal window
is opened**. An already-running terminal retains its original title regardless
of what `\x1b]0;...\x07` you emit. This means:

- ✅ You implemented the fix → rebuild → restart → **title unchanged** 😰
- ✅ Open a **brand-new** CMD window → launch → **title correct** 🎉

**Checklist for terminal-title changes:**
1. Make the code change
2. `npm run build`
3. **Open a fresh terminal** (do not reuse an existing one)
4. Launch DsCode
5. Verify the title

This is another facet of L7 (untestable terminal features) — the terminal
emulator itself can cache the title and ignore updates, making manual
verification error-prone if you don't know this trick.

---

## L9: Ink Layout Cycles — The `───` Multiplication Bug Has No Perfect Fix

**Date:** 2026-06-11
**Source:** Fixing separator lines (`───`) that multiplied into dozens of copies when the terminal window was shrunk

**Lesson:** Nested `width={screenWidth}` Boxes + `flexGrow` conflicts in Ink/Yoga
can cause elements to duplicate on terminal resize. However, this class of bug
may have **no perfect fix** — three escalating attempts went from "broken" to
"acceptable" but never reached "flawless." Sometimes the layout engine itself
is the limiting factor, and "good enough" is the right place to stop.

### 9a. The three ingredients of the multiplication bug

The bug manifested as 25+ copies of `───` stacking up above the prompt input.
Three factors combined to cause it:

1. **Nested identical widths**: `App.tsx` had `<Box width={screenWidth}>` and
   `PromptInput.tsx` nested another `<Box width={screenWidth}>` inside it.
2. **`flexGrow={1}` + explicit `width` on the same element**: The inner text Box
   had both `flexGrow={1}` and `width={screenWidth - 2}` — told to both respect
   a fixed width AND expand to fill remaining space.
3. **Missing `wrap` on Text elements**: `<Text dimColor>───</Text>` without
   `wrap="truncate-end"` allows Ink to attempt wrapping when layout calculations
   go wrong (even on 3-character strings).

### 9b. Three escalating attempts, none perfect

| # | Approach | Result |
|---|----------|--------|
| 1 | Remove outer width + `flexGrow` → `flexShrink` only + add `wrap="truncate-end"` | Improved but still reproduced |
| 2 | Replace full-width separator lines with short `───` (3 chars) | Still reproduced — short lines also multiplied |
| 3 | **Remove ALL `width` constraints** from inside PromptInput (outer Box, inner Box, Text) + remove `wrap` from `───` | **Much better, but not fully resolved** |

**Attempt 3 (the best result):**
```diff
- <Box width={screenWidth}>           → <Box flexDirection="row" flexShrink={1}>
- <Box width={screenWidth - 2}>        → <Box flexShrink={1}>
- <Text dimColor wrap="truncate-end">  → <Text dimColor>
```

The hypothesis for why even this didn't fully fix it: `App.tsx` still has a
`minWidth={80}` on the parent Box, which means when the terminal shrinks below
80 columns, Ink's Yoga layout enters a constraint conflict that no amount of
child-level simplification can fully unwind.

### 9c. General rules for Ink layout

- **Never** set `width={screenWidth}` on a Box that's already inside another
  `width={screenWidth}` container. Let it inherit.
- **Never** combine `flexGrow` with an explicit `width` on the same element.
- **Always** add `wrap="truncate-end"` to Text elements that should never wrap.
- When a component renders multiple times on resize, suspect nested-width first.
- **`minWidth` on a parent is just as dangerous as `width`** — it creates a hard
  floor that conflicts with `flexShrink` on children.

### 9d. When to stop

- If two attempts at simplifying the layout don't resolve a Yoga/Ink rendering
  bug, the root cause is likely in the layout engine itself, not your code.
- Ask: "Is this acceptable?" If the bug only manifests at extreme, unrealistic
  terminal widths, the answer is probably yes.
- Document the attempts and move on. Not all rendering quirks are worth the
  infinite rabbit hole.

---
