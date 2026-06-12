# Spec 110: Skills Inclusion Modes — Requirements

## Value Delivery

This spec delivers **V16: Skills Inclusion Modes** from the vision document:

> Fine-grained control over when skills are loaded into the AI context:
>
> - **`inclusion: auto`** (default, current behavior) — skill is loaded automatically via keyword matching against the user's prompt, and is also available via slash command and dropdown.
> - **`inclusion: manual`** — skill is NEVER loaded by keyword matching. It is only activated explicitly by the user through:
>   - `#skill-name` prefix in the prompt input (new syntax, distinct from `/` for commands).
>   - The `/skills` dropdown menu.
>   - Typing `#skill-name` and pressing Enter.
>
> The `inclusion` field is optional YAML frontmatter in `SKILL.md`. When absent, defaults to `auto` (backward compatible — all existing skills continue working unchanged).
>
> **Design decisions:**
> - `#` prefix for manual skills is semantically distinct from `/` (slash commands = system actions, `#` = load knowledge/instructions). Precedent: Kiro uses `#steering-file-name` for manual inclusion.
> - `fileMatch` (glob-based conditional loading) is intentionally deferred — requires additional design around "current file" tracking.
> - `always` mode for skills is intentionally omitted — use `AGENTS.md` steering for always-loaded content.
> - No new commands for skill lifecycle management — the AI's existing file tools (Write, Bash) already handle create/edit/delete of `SKILL.md` files.

---

## Functional Requirements

### FR-001: `inclusion` Field in `SkillInfo` Type

**What:** The `SkillInfo` TypeScript type gains an optional `inclusion` field with values `"auto"` or `"manual"`. When absent (undefined), the skill behaves as `"auto"` (backward compatible).

**Why:** This field is the single source of truth for whether a skill participates in keyword-based auto-matching. Without it, there is no way for a skill author to declare "do not auto-load me."

**Acceptance Criteria:**
- [ ] `SkillInfo` type in `src/session.ts` has a new optional field: `inclusion?: "auto" | "manual"`.
- [ ] The field is typed as a string literal union, not `string`.
- [ ] TypeScript compilation passes without errors in all files that construct or reference `SkillInfo`.

### FR-002: `inclusion` Parsed from SKILL.md Frontmatter

**What:** `readSkillInfo()` in `src/session.ts` reads and validates the `inclusion` field from the YAML frontmatter of `SKILL.md` files.

**Why:** Skill authors declare the inclusion mode in the `SKILL.md` file itself. The system must read this declaration and propagate it to the `SkillInfo` object.

**Acceptance Criteria:**
- [ ] `readSkillInfo()` extracts `inclusion` from the YAML frontmatter parsed by `matter()`.
- [ ] Valid values: `"auto"` and `"manual"` (case-sensitive). Any other value is treated as `undefined` (fallback to `auto`).
- [ ] If `inclusion` is absent from the frontmatter, the field is `undefined` on the returned `SkillInfo` object.
- [ ] If `inclusion` is present but invalid (e.g., `"always"`, `"unknown"`, `true`, `42`), the parsed value is discarded and the field is `undefined`.
- [ ] Whitespace around the value is trimmed before validation.
- [ ] The `matter()` import is already available in `session.ts` — no new dependency required.

### FR-003: `matchSkillsByKeywords()` Skips Manual Skills

**What:** `matchSkillsByKeywords()` in `src/session.ts` excludes skills with `inclusion === "manual"` from automatic keyword matching. Manual skills are never loaded via keyword matching, regardless of prompt content.

**Why:** The core value of `inclusion: manual` is preventing unintended loading. A manual skill should never appear in the AI context unless the user explicitly requests it.

**Acceptance Criteria:**
- [ ] In the loop over `skills` in `matchSkillsByKeywords()`, a new guard `if (skill.inclusion === "manual") continue;` is added alongside the existing `if (skill.isLoaded) continue;` guard.
- [ ] Skills with `inclusion` undefined or `"auto"` continue to be matched by keywords as before.
- [ ] Manual skills are NOT excluded from the `/skills` dropdown menu (the dropdown lists ALL skills regardless of inclusion mode).
- [ ] Manual skills are NOT excluded from `listSkills()` (listing must show all skills so the user can discover them).

### FR-004: `#skill-name` Prefix Detection in PromptInput

**What:** When the user types `#skill-name` as the first token in the prompt followed by optional text, PromptInput detects this pattern, strips the prefix, resolves the skill name, and adds the skill to `selectedSkills` if it has `inclusion: manual` (or any inclusion mode — the `#` prefix is always an explicit activation request).

**Why:** The `#` prefix is the primary mechanism for activating manual skills. Without detection in the prompt input, the user would have no way to invoke a manual skill inline.

**Acceptance Criteria:**
- [ ] `submitCurrentBuffer()` in `src/ui/views/PromptInput.tsx`, before the `/` slash command check, detects if the trimmed buffer starts with `#` followed by a skill name token.
- [ ] Regex: `/^#([a-z][a-z0-9-]*)\b/i` — captures the skill name after `#`, requiring at least one letter, followed by optional letters/digits/hyphens.
- [ ] If a match is found:
  1. The captured name is looked up in the `skills` array passed as a prop.
  2. If a skill with that name exists, it is added to `selectedSkills` via `addUniqueSkill()`.
  3. The `#skill-name` prefix and any trailing whitespace are stripped from the prompt text.
  4. The skill is submitted with the (possibly empty) remaining text. If the remaining text is empty and there are no image URLs, the prompt is submitted with empty text and the skill attached — the SessionManager loads the skill into context without requiring an AI prompt.
  5. If there IS remaining text, the stripped text is submitted as the prompt with the skill attached.
- [ ] If no skill with that name exists, the `#skill-name` prefix is treated as regular text and submitted unchanged (no error — the `#` might be a heading marker).
- [ ] The `skills` prop passed from `useSessionManager` / `AppState` is already available — `submitCurrentBuffer()` already receives it via the component's closure.
- [ ] The `#skill-name` detection happens BEFORE the `/` slash command check, so `#deploy` is not confused with `/deploy`.

### FR-005: `#skill-name` Works with `inclusion: auto` Skills Too

**What:** The `#skill-name` prefix works for ANY skill, not just `inclusion: manual`. If the user types `#css-patterns` and that skill has `inclusion: auto`, the skill is still added to `selectedSkills`.

**Why:** The `#` prefix is an explicit activation request. Even if a skill would normally auto-match, the user should be able to force-load it. This also provides a discoverable way to activate skills without waiting for keyword matching.

**Acceptance Criteria:**
- [ ] The `#skill-name` detection in PromptInput does NOT check the `inclusion` field — it matches any skill by name.
- [ ] An auto-matched skill that was already loaded via keywords AND is then also `#`-activated should be deduplicated (the existing `addUniqueSkill` and `normalizeSkills` functions already handle dedup).

### FR-006: `matchSkillsByKeywords()` Called with Manual Skills Excluded

**What:** The auto-matching flow in `createSession()` and `replySession()` uses `matchSkillsByKeywords()` which now excludes manual skills. No other changes to the session management flow are needed.

**Why:** The exclusion is handled inside `matchSkillsByKeywords()` — the calling code doesn't need to know about inclusion modes.

**Acceptance Criteria:**
- [ ] `createSession()` (line 931-932) continues to call `matchSkillsByKeywords(skills, userPrompt.text ?? "")` without changes.
- [ ] `replySession()` (line 1006-1007) continues to call `matchSkillsByKeywords(skills, userPrompt.text ?? "")` without changes.
- [ ] The exclusion of manual skills is transparent to the calling code.

---

## Non-Functional Requirements

### NFR-001: Zero New Dependencies

**What:** This spec adds no npm packages, no new libraries, no new external dependencies.

**Acceptance Criteria:**
- [ ] `package.json` and `package-lock.json` show zero changes in `dependencies` or `devDependencies`.
- [ ] The implementation uses only: Node.js built-ins, the existing `gray-matter` YAML frontmatter parser (already imported as `matter` in `session.ts`), and existing project modules.

### NFR-002: Backward Compatibility

**What:** All existing skills continue to work identically. No behavior changes for skills that do not declare `inclusion` or declare `inclusion: auto`.

**Acceptance Criteria:**
- [ ] `npm test` passes with zero regressions.
- [ ] All 3 built-in skills (`agent-drift-guard`, `karpathy-guidelines`, `plan-and-execute`) load and function identically — they never enter the `matchSkillsByKeywords` path (they are built-in), so they are unaffected.
- [ ] Existing project and user skills without `inclusion` in their frontmatter behave exactly as they did before (auto-match).
- [ ] The `/skills` dropdown behavior is unchanged — all skills are listed regardless of inclusion mode.

### NFR-003: Surgical Change Principle (P4)

**What:** Changes touch only the files required for the new inclusion mode feature. Adjacent code, comments, and formatting are not modified.

**Acceptance Criteria:**
- [ ] `src/session.ts` — only: 1 new field on `SkillInfo` type; 1 new field parsing in `readSkillInfo()`; 1 new guard clause in `matchSkillsByKeywords()`.
- [ ] `src/ui/views/PromptInput.tsx` — only: 1 new detection block in `submitCurrentBuffer()` before the `/` check.
- [ ] No other files modified.

### NFR-004: Deterministic AI Behavior

**What:** The inclusion mode logic is purely deterministic — no AI involvement, no heuristic matching, no LLM calls.

**Acceptance Criteria:**
- [ ] `matchSkillsByKeywords()` is already synchronous and deterministic (ADR-006). The new guard clause is a simple string comparison — adds zero non-determinism.
- [ ] `readSkillInfo()` is synchronous and deterministic — parses YAML, validates enum, returns structured data.
- [ ] The `#skill-name` detection uses a simple regex — no ambiguity.

---

## Constraints

- **`gray-matter` already imported:** `session.ts` line 1 imports `matter` from `gray-matter`. No new import needed for YAML parsing.
- **No new CLI commands:** The spec adds no slash commands. The `#` prefix is inline syntax, not a slash command.
- **No changes to `SKILL.md` format:** The `inclusion` field is optional YAML frontmatter. Existing `SKILL.md` files without it are unaffected.
- **No changes to skill loading infrastructure:** `buildSkillPrompt()`, `buildSkillMessage()`, `loadSkillsForPrompt()`, and `normalizeSkills()` are unchanged.
- **Node.js 24 minimum:** All code targets Node.js 24 (es2024).

---

## Edge Cases & Error States

| Scenario | Expected Behavior |
|----------|------------------|
| SKILL.md has `inclusion: auto` | `SkillInfo.inclusion = "auto"`. Skill participates in keyword matching. |
| SKILL.md has `inclusion: manual` | `SkillInfo.inclusion = "manual"`. Skill is excluded from keyword matching. Can only be activated via `#` prefix or `/skills` dropdown. |
| SKILL.md has no `inclusion` field | `SkillInfo.inclusion = undefined`. Behaves as `auto` — backward compatible. |
| SKILL.md has `inclusion: always` (invalid value) | Value is discarded. `SkillInfo.inclusion = undefined`. Skill behaves as `auto`. |
| SKILL.md has `inclusion: Manual` (wrong case) | Case-sensitive validation rejects it. `SkillInfo.inclusion = undefined`. |
| SKILL.md has `inclusion: ""` (empty string) | Treated as undefined after trim. |
| SKILL.md has `inclusion: " manual"` (leading space) | Trimmed to `"manual"`, accepted. |
| User types `#deploy` but no skill named "deploy" exists | The `#deploy` prefix is NOT stripped. It is treated as regular text and submitted normally. The `#` could be a Markdown heading. |
| User types `#deploy Some prompt text` | If "deploy" skill exists → skill loaded, prompt text = "Some prompt text". If no skill exists → full text submitted as-is. |
| User types `#deploy` with no trailing text | Skill loaded (if exists), prompt submitted with empty text and skill attached. SessionManager processes the skill without an AI prompt (same as selecting from `/skills` dropdown). |
| User types `#` alone | Regex requires at least one letter after `#`. Treated as regular text. |
| User types `#123` (digits only) | Regex requires first character to be a letter. Treated as regular text. |
| User types `Some text #deploy` (not at start) | Regex only matches at start. Treated as regular text. |
| User types `#deploy` for a skill that is already loaded (`isLoaded = true`) | Skill is added to `selectedSkills`. Later, `normalizeSkills()` and the dedup logic skip already-loaded skills. No double-loading. |
| User types `#deploy` for an `inclusion: auto` skill | Skill is loaded regardless. The `#` prefix is an explicit activation — it overrides auto-matching (works in parallel). |
| User types `#deploy` and also has skills selected via dropdown | Both are passed in `selectedSkills`. `addUniqueSkill` prevents duplicates. |
| Prompt text contains `#` as a heading (e.g., `# My heading`) | Regex match at position 0: `# My` matches `#my` (case-insensitive regex). If no skill named "my" exists, treated as regular text. This is acceptable — the heuristic is simple and favors explicit skill names. |
| SKILL.md YAML is malformed | `matter()` returns empty data. `readSkillInfo` falls back to the fallback skill. `inclusion` is undefined → `auto`. |
| Built-in skills (from `templates/skills/`) | Built-in skills don't have SKILL.md files — they are hardcoded in `getDefaultSkillPrompt()`. They are always loaded. Unaffected by this spec. |

---

## Dependencies

- **None.** Spec 110 is standalone. It builds on existing infrastructure:
  - `SkillInfo` type (extended with `inclusion` field)
  - `readSkillInfo()` (extended to parse `inclusion` from YAML frontmatter)
  - `matchSkillsByKeywords()` (extended with guard clause for manual skills)
  - `submitCurrentBuffer()` in PromptInput (extended with `#` prefix detection)
  - `matter` from `gray-matter` (already imported)

---

## Out of Scope

- **`fileMatch` inclusion mode** — glob-based conditional loading. Intentionally deferred per V16 design decisions.
- **`always` inclusion mode for skills** — use `AGENTS.md` steering for always-loaded content.
- **New slash commands for skill management** — the AI's existing file tools handle create/edit/delete of `SKILL.md` files.
- **Batch `#` prefix activation** — only one `#skill-name` per prompt.
- **`#skill-name` autocomplete** — the `#` prefix does not trigger the slash command menu or any autocomplete.
- **Skill conflict detection** — not relevant; `inclusion: manual` just prevents auto-loading, doesn't check conflicts.
- **Changes to `/skills` dropdown UX** — existing behavior is sufficient.
- **UI indication that a skill is manual vs auto** — the skill list in the dropdown doesn't show inclusion mode.
- **Reverting `inclusion` via prompt** — the user cannot change a skill's inclusion mode via slash commands. They must edit the `SKILL.md` file.
