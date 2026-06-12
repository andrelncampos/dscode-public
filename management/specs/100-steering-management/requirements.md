# Spec 100: Steering Management — Requirements

## Value Delivery

This spec delivers **V15: Steering Management Commands** from the vision document:

> Full lifecycle management of steering rules within `AGENTS.md`:
>
> - `/steering-add` — add a new steering rule to the `## Steering` section. Detects conflicts with existing rules and asks the user before adding contradictory rules.
> - `/steering-list` — list all steering rules with positional numbering (1-based).
> - `/steering-remove <N>` — remove the Nth steering rule by position. The AI reads the file, locates the bullet, and removes it without touching other content.
> - `/steering-alter <N>` — replace the Nth steering rule with new text. Same position-based approach — reads, replaces, writes.
>
> Steering rules are always loaded into every session context (`inclusion: always`). They are short, concise, imperative guidelines (one to two sentences each) stored as bullet points under `## Steering` in `AGENTS.md`. The file is compatible with the open `AGENTS.md` standard used by Kiro and other AI coding tools.
>
> **Design decisions:**
> - Position-based referencing (1, 2, 3...) — no persistent IDs in the file. Keeps `AGENTS.md` clean and interoperable.
> - Steering is separate from skills: steering = "how to behave" (always loaded, small), skills = "what to do" (on-demand, can be large).
> - The AI performs the file edits using its existing file tools (Read, Write, Edit) — no new tool implementations needed.

**Note:** `/steering-add` and `/steering-list` are already implemented. This spec adds `/steering-remove <N>` and `/steering-alter <N>` to complete the full CRUD lifecycle.

---

## Functional Requirements

### FR-001: `/steering-remove <N>` Slash Command

**What:** A slash command that removes the Nth steering rule from the `## Steering` section of `AGENTS.md`. The user types `/steering-remove 3` and the AI removes the 3rd bullet under `## Steering` without modifying any other content in the file.

**Why:** Completes the CRUD lifecycle for steering rules. Without remove, users must manually edit `AGENTS.md` to delete rules, breaking the terminal-native experience (V1: Terminal-Native Conversational Interface).

**Acceptance Criteria:**
- [ ] `/steering-remove 2` appears in the slash command menu with label and translated description.
- [ ] When executed, the AI receives a rendered prompt instructing it to read the AGENTS.md file, locate the 2nd bullet under `## Steering`, remove it (including the `- ` prefix), and save the file.
- [ ] If N is less than 1 or not a valid positive integer, the command renders an error prompt that instructs the AI to tell the user "Invalid rule number: must be a positive integer."
- [ ] If N exceeds the number of existing rules, the command renders a prompt that instructs the AI to tell the user how many rules exist and that the requested number is out of range.
- [ ] If no AGENTS.md file exists, the command renders a prompt that instructs the AI to tell the user "No AGENTS.md file found. Create one with /steering-add first."
- [ ] If the AGENTS.md file exists but has no `## Steering` section (or the section is empty), the command renders a prompt that instructs the AI to tell the user "No steering rules to remove."
- [ ] The removal preserves all content outside the `## Steering` section — headings above, other sections, blank lines.
- [ ] After removal, if the `## Steering` section becomes empty (only the heading `## Steering` remains), the AI keeps the empty heading (does not remove the heading itself).
- [ ] The AI reports which rule was removed and shows its text.
- [ ] The command accepts positional numbers only (1-based indexing), not rule text or other identifiers.
- [ ] The command can be typed as a bare string `/steering-remove 3` in the prompt and is recognized without requiring the slash menu.

### FR-002: `/steering-alter <N>` Slash Command

**What:** A slash command that replaces the Nth steering rule with new text. The user types `/steering-alter 2` and then provides replacement text. The AI reads the existing rule at position N, replaces it, and saves.

**Why:** Completes the CRUD lifecycle. Without alter, users must manually edit `AGENTS.md` to change rules, or delete and re-add (two operations for one logical change).

**Acceptance Criteria:**
- [ ] `/steering-alter 2` appears in the slash command menu with label and translated description.
- [ ] When executed, the AI receives a rendered prompt instructing it to:
  1. Read the current AGENTS.md file and locate the Nth bullet.
  2. Show the user the current text of rule N.
  3. Use `AskUserQuestion` to ask "Enter the new text for this rule" (single text input).
  4. Replace the bullet text, keeping the `- ` prefix.
  5. Save the file.
- [ ] If N is less than 1 or not a valid positive integer, the command renders an error prompt that instructs the AI to tell the user "Invalid rule number: must be a positive integer."
- [ ] If N exceeds the number of existing rules, the command renders a prompt that instructs the AI to tell the user how many rules exist and that the requested number is out of range.
- [ ] If no AGENTS.md file exists, the command renders a prompt that instructs the AI to tell the user "No AGENTS.md file found. Create one with /steering-add first."
- [ ] If the AGENTS.md file exists but has no `## Steering` section (or the section is empty), the command renders a prompt that instructs the AI to tell the user "No steering rules to alter."
- [ ] The replacement preserves all content outside the `## Steering` section.
- [ ] The replacement preserves the bullet prefix (`- `).
- [ ] The AI reports the old and new text of the altered rule.
- [ ] The command follows the same "buffer text" pattern as `/steering-add` — the user types `/steering-alter 2` and the prompt text after the number becomes the replacement text. If no replacement text is provided (only `/steering-alter 2`), the AI uses `AskUserQuestion` to ask for it.
- [ ] The command can be typed as a bare string `/steering-alter 2 New rule text here` in the prompt and is recognized without requiring the slash menu.

### FR-003: Slash Command Registration

**What:** Both new commands must be registered in all command registration points following the exact same pattern as existing steering commands.

**Why:** Consistency with existing architecture (P1: Interface-First Design, P4: Surgical Changes).

**Acceptance Criteria:**
- [ ] `"steering-remove"` and `"steering-alter"` are added to `COMMAND_KINDS` array in `src/ui/types/commands.ts`.
- [ ] `"steering-remove"` and `"steering-alter"` are added to `PROMPT_COMMAND_KINDS` array in `src/ui/types/commands.ts`.
- [ ] Both commands are added to `BUFFER_TEXT_COMMANDS` set in `src/ui/core/command-handlers.ts` (they accept optional trailing text, like `/steering-add`).
- [ ] Both commands are added to the slash commands array in `src/ui/core/slash-commands.ts` with `kind`, `name`, `label`, and `description` fields.
- [ ] Both commands have entries in the `COMMAND_HANDLERS` record in `src/ui/core/command-handlers.ts` — these entries submit `text: "/steering-remove <N>"` or `text: "/steering-alter <N>"` with the `selectedSkills` context preserved.
- [ ] The slash command menu (`SlashCommandMenu.tsx`) lists both new commands in the "Skills e agentes" / "Skills and agents" section, grouped with `/steering-add` and `/steering-list`.
- [ ] The tests in `src/tests/slash-commands.test.ts` include both new commands in the expected command list.

### FR-004: Message Converter Integration

**What:** The `OpenAIMessageConverter` must detect the new commands and replace them with rendered prompt templates before transmission to the LLM.

**Why:** Follows the existing pattern for all slash commands that involve AI-executed file operations (`/init`, `/steering-add`, `/steering-list`, all `/spec-*`). The converter intercepts user messages matching these commands and substitutes the template content.

**Acceptance Criteria:**
- [ ] `OpenAIMessageConverterOptions` interface gains two new optional callbacks: `renderSteeringRemovePrompt?: (position: number, replacementText?: string) => string` and `renderSteeringAlterPrompt?: (position: number, replacementText?: string) => string`.
- [ ] `renderContent()` in `openai-message-converter.ts` detects `/^\/steering-remove\s+(\d+)(?:\s+(.+))?$/s` and calls `renderSteeringRemovePrompt`.
- [ ] `renderContent()` in `openai-message-converter.ts` detects `/^\/steering-alter\s+(\d+)(?:\s+(.+))?$/s` and calls `renderSteeringAlterPrompt`.
- [ ] If the callback is not provided (undefined), the raw user text is sent unchanged (graceful degradation).
- [ ] The converterOptions object in `SessionManager` constructor passes both new callbacks.

### FR-005: Prompt Templates (EJS)

**What:** Two new EJS templates in `templates/prompts/` provide the AI with step-by-step instructions for executing the commands.

**Why:** The existing steering commands (`steering_add.md.ejs`, `steering_list.md.ejs`) use EJS templates. Consistency requires the same approach.

**Acceptance Criteria:**
- [ ] `templates/prompts/steering_remove.md.ejs` exists with template variables: `position` (number), `replacementText` (string | null).
- [ ] The remove template instructs the AI to:
  1. Find the AGENTS.md file (check `.dscode/AGENTS.md`, `.deepcode/AGENTS.md`, `./AGENTS.md`).
  2. Read and parse the `## Steering` section.
  3. Extract bullet points.
  4. Validate N is in range (1 to bulletCount).
  5. Remove the Nth bullet line (including `- ` prefix).
  6. Write the modified file back.
  7. Report what was removed.
- [ ] The template handles the -N condition (invalid number): instructs AI to tell user "1 to bulletCount".
- [ ] The template handles the missing-file condition.
- [ ] The template handles the empty-section condition.
- [ ] `templates/prompts/steering_alter.md.ejs` exists with template variables: `position` (number), `replacementText` (string | null).
- [ ] The alter template instructs the AI to:
  1. Find the AGENTS.md file.
  2. Read and parse the `## Steering` section.
  3. Extract bullet points.
  4. Validate N is in range.
  5. Show the current rule text to the user.
  6. If `replacementText` is provided, use it. Otherwise, ask the user via `AskUserQuestion`.
  7. Replace the Nth bullet text (keep `- ` prefix).
  8. Write the modified file back.
  9. Report old and new text.
- [ ] Both templates use the same language (English, imperative, AI-optimized) as the existing templates.

### FR-006: SessionManager Render Methods

**What:** `SessionManager` gains private methods to render the two new templates and passes them to the converter options.

**Why:** Follows the existing architecture where `SessionManager` owns all command prompt rendering and passes callbacks to the converter.

**Acceptance Criteria:**
- [ ] `private renderSteeringRemoveCommandPrompt(position: number, replacementText?: string): string` — reads `steering_remove.md.ejs`, renders with EJS, returns string.
- [ ] `private renderSteeringAlterCommandPrompt(position: number, replacementText?: string): string` — reads `steering_alter.md.ejs`, renders with EJS, returns string.
- [ ] Both are passed to `converterOptions` in the constructor: `renderSteeringRemovePrompt: (position, text) => this.renderSteeringRemoveCommandPrompt(position, text)`.
- [ ] Both are passed to `converterOptions` in the constructor: `renderSteeringAlterPrompt: (position, text) => this.renderSteeringAlterCommandPrompt(position, text)`.

### FR-007: Internationalization (i18n)

**What:** Both new commands have translated descriptions in all 3 supported languages.

**Why:** Spec 90 (product-i18n) established that all UI strings must be translated. V14 requires that menus, wizards, and command descriptions speak the user's language.

**Acceptance Criteria:**
- [ ] `en.ts`: `"cmd.steering-remove": "Remove the Nth steering rule by position from AGENTS.md"`, `"cmd.steering-alter": "Alter the Nth steering rule by position in AGENTS.md"`
- [ ] `pt.ts`: `"cmd.steering-remove": "Remover a N-ésima regra de direção por posição do AGENTS.md"`, `"cmd.steering-alter": "Alterar a N-ésima regra de direção por posição no AGENTS.md"`
- [ ] `es.ts`: `"cmd.steering-remove": "Eliminar la N-ésima regla de dirección por posición del AGENTS.md"`, `"cmd.steering-alter": "Modificar la N-ésima regla de dirección por posición en el AGENTS.md"`
- [ ] TypeScript compilation passes — `I18nDictionary` type is keyed by `typeof enDictionary`, so all dictionaries must have both keys.

---

## Non-Functional Requirements

### NFR-001: Zero New Dependencies

**What:** This spec adds no npm packages, no new libraries, no new external dependencies.

**Acceptance Criteria:**
- [ ] `package.json` and `package-lock.json` show zero changes in `dependencies` or `devDependencies`.
- [ ] The implementation uses only: Node.js built-ins (`fs`, `path`, `crypto`), the existing `ejs` template engine (already a dependency), and existing project modules.

### NFR-002: Backward Compatibility

**What:** No existing behavior changes. All existing commands, templates, and API surfaces continue working exactly as before.

**Acceptance Criteria:**
- [ ] `npm test` passes with zero regressions.
- [ ] `/steering-add` and `/steering-list` continue working identically.
- [ ] `loadAgentInstructions()` is not modified.
- [ ] `AGENTS.md` format (bullet points under `## Steering`) is not changed.
- [ ] Existing EJS templates are not modified.

### NFR-003: Surgical Change Principle (P4)

**What:** Changes touch only the files required for the new commands. Adjacent code, comments, and formatting are not modified.

**Acceptance Criteria:**
- [ ] `src/session.ts` — only: 2 new private methods + 2 lines in constructor callback wiring.
- [ ] `src/common/openai-message-converter.ts` — only: 2 new optional callback types + 2 new regex match blocks in `renderContent()`.
- [ ] `src/ui/types/commands.ts` — only: 2 new entries in each const array.
- [ ] `src/ui/core/slash-commands.ts` — only: 2 new command objects.
- [ ] `src/ui/core/command-handlers.ts` — only: 2 new entries in `BUFFER_TEXT_COMMANDS` + 2 new entries in `COMMAND_HANDLERS`.
- [ ] `src/tests/slash-commands.test.ts` — only: 2 new entries in expected command list.
- [ ] `src/i18n/en.ts` — only: 2 new key-value pairs.
- [ ] `src/i18n/pt.ts` — only: 2 new key-value pairs.
- [ ] `src/i18n/es.ts` — only: 2 new key-value pairs.
- [ ] `templates/prompts/` — 2 new `.ejs` files (no modifications to existing templates).

### NFR-004: Deterministic AI Behavior

**What:** The prompt templates must produce deterministic, reproducible AI behavior. Given the same AGENTS.md content and the same command input, the AI must produce the same file edit.

**Acceptance Criteria:**
- [ ] The templates define step-by-step procedures with no branching that depends on AI "judgment."
- [ ] All error conditions (missing file, out-of-range N, empty section) have explicit instructions in the template.
- [ ] The templates use structured output format requirements so that unit tests can parse the AI's response.

---

## Constraints

- **Position-based only:** Rule identification uses 1-based positional numbering. No persistent IDs, no rule text matching, no fuzzy search. This is an explicit design decision from V15.
- **AGENTS.md format:** The `## Steering` section uses `- ` bullet syntax (dash + space). The implementation must recognize this exact format.
- **EJS template engine:** Templates use the existing `ejs` package (version 6.x), same as all other command templates.
- **No new tools:** The AI uses existing file tools (Read, Write, Edit) to perform the operations. The DsCode tool system is not extended.
- **Node.js 24 minimum:** All code targets Node.js 24 (es2024), same as the rest of the codebase.
- **TypeScript strict mode:** No `any` types, no `as` casts without justification.
- **English-only templates:** Prompt templates are in English (AI instruction language). User-facing messages use the detected locale.

---

## Edge Cases & Error States

| Scenario | Expected Behavior |
|----------|------------------|
| `/steering-remove` with no number | The `BUFFER_TEXT_COMMANDS` handler submits text `/steering-remove` verbatim. The converter regex does not match (no number). The AI receives the literal text and responds with help. |
| `/steering-remove 0` | Prompt template instructs AI: "Invalid rule number: must be a positive integer (1 or greater)." |
| `/steering-remove -5` | Regex does not match negative numbers. AI receives literal text. |
| `/steering-remove 999` (only 3 rules exist) | Prompt template instructs AI: "There are 3 rules. Position 999 is out of range." |
| `/steering-remove 1` (only rule) | Removes the rule. The `## Steering` section now has the heading with no bullets. |
| `/steering-alter` with no number | Same as remove — literal text sent, AI responds with help. |
| `/steering-alter 3` with no replacement text | Prompt template instructs AI to read rule 3, show it, then use `AskUserQuestion` to request new text. |
| `/steering-alter 3 Novo texto aqui` | `replacementText` = "Novo texto aqui". Template instructs AI to use this text directly without asking. |
| `/steering-alter 3    ` (whitespace only after number) | Converter `.trim()` yields empty string → `replacementText` = `undefined`. Template treats as "no text provided" and uses `AskUserQuestion`. |
| User selects `/steering-remove` from slash menu and presses Enter immediately (no number) | Buffer text = `/steering-remove ` (trailing space, no digits). Converter regex `/^\/steering-remove\s+(\d+)/` does not match. AI receives literal text and responds with usage help. |
| User selects `/steering-alter` from slash menu and presses Enter immediately (no number) | Same as above — AI receives literal `/steering-alter ` and responds with usage help. |
| `## Steering` section has blank lines between bullets (e.g., `- Rule 1\n\n- Rule 2`) | Template instructs AI: when removing bullet N, if the line immediately above or below the removed bullet is blank, remove that blank line too. This prevents residual blank lines from accumulating in the section. |
| No AGENTS.md exists at all | Prompt template detects no file, instructs AI: "No AGENTS.md file found. Create one with /steering-add first." |
| AGENTS.md exists, no `## Steering` heading | Prompt template instructs AI: "No steering rules found. Add rules with /steering-add first." |
| AGENTS.md has `## Steering` with no bullets | Same as above — section exists but is empty. |
| AGENTS.md has multiple `## Steering` headings (malformed) | Template instructs AI to use the first occurrence. |
| Concurrent file modification (file changed between read and write) | Race condition is acceptable per existing design (no file locking in any command). The AI's read-then-write is a single tool sequence so practical risk is near zero. |
| Very large AGENTS.md (100+ KB) | AI uses Read tool to read the file. Token cost is proportional. No special handling needed — this is an existing pattern for all file operations. |
| User cancels `AskUserQuestion` in alter flow | AI reports "Alteration cancelled." No file modification. |
| User provides empty replacement text in alter | Prompt template instructs AI to treat empty text as "no text provided" and ask again. |
| Replacement text in alter is identical to existing text | AI reports "Rule text unchanged." No file modification (but this is a "should" not a "must" — a no-op write is acceptable). |

---

## Dependencies

- **None.** Spec 100 is standalone. It builds on existing infrastructure:
  - `loadAgentInstructions()` in `src/session.ts` (already implemented, not modified)
  - `OpenAIMessageConverter` callback pattern (already implemented, extended with 2 new callbacks)
  - EJS template system (already in `dependencies`)
  - i18n dictionary system (already implemented, extended with 2 new keys)
  - Slash command registration system (already implemented, extended with 2 new commands)

---

## Out of Scope

- **Rule conflict detection** — already implemented in `/steering-add` template, not extended.
- **Rule reordering** — no `/steering-move` command.
- **Rule searching by text** — position-based only.
- **Rule export/import** — not needed.
- **Bulk operations** — single rule per command invocation.
- **File format changes** — `AGENTS.md` format (`## Steering` + `- ` bullets) is not altered.
- **Undo functionality** — Git provides undo; no built-in undo for steering operations.
- **Validation of rule content** — the AI does not validate whether the new rule text is "good" or "well-formed." Text is accepted as-is.
- **Multi-line rules** — rules are a single line (bullet point). Multi-line steering rules are out of scope.
