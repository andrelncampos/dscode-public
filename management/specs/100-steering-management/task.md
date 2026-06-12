# Spec 100: Steering Management — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Create EJS Prompt Templates

**Objective:** Create the two new EJS prompt template files that instruct the AI how to execute `/steering-remove` and `/steering-alter`.

**Requirements Covered:** FR-005

**Design References:** Design → Component: `steering_remove.md.ejs` Template, Component: `steering_alter.md.ejs` Template

**Actions:**
1. Create `templates/prompts/steering_remove.md.ejs` with content following the internal logic specified in the design (find file, parse section, validate position, remove bullet, report). Template variables: `position` (number), `replacementText` (string | null).
2. Create `templates/prompts/steering_alter.md.ejs` with content following the internal logic specified in the design (find file, parse section, validate position, get replacement text via AskUserQuestion or use provided text, replace bullet, report). Template variables: `position` (number), `replacementText` (string | null).
3. Verify both templates are syntactically valid EJS by loading with `ejs.compile()` in a Node.js one-liner.

**Validation:**
```
node -e "const ejs = require('ejs'); ejs.compile(require('fs').readFileSync('templates/prompts/steering_remove.md.ejs','utf8')); console.log('remove OK')"
node -e "const ejs = require('ejs'); ejs.compile(require('fs').readFileSync('templates/prompts/steering_alter.md.ejs','utf8')); console.log('alter OK')"
```
Both commands must print "OK" without errors.

**Status:** [x] done

---

### Task 2: Extend OpenAIMessageConverterOptions Interface

**Objective:** Add two optional callback types to the converter options interface.

**Requirements Covered:** FR-004

**Design References:** Design → Component: `OpenAIMessageConverterOptions` Interface Extension

**Actions:**
1. Open `src/common/openai-message-converter.ts`.
2. Locate the `OpenAIMessageConverterOptions` interface definition (near line 8).
3. Add after the existing `renderSteeringListPrompt` field:
   ```typescript
   /** Optional callback to render the /steering-remove command prompt template. */
   renderSteeringRemovePrompt?: (position: number, replacementText?: string) => string;
   /** Optional callback to render the /steering-alter command prompt template. */
   renderSteeringAlterPrompt?: (position: number, replacementText?: string) => string;
   ```
4. Verify TypeScript compilation: `npx tsc --noEmit`.

**Validation:** TypeScript compilation succeeds (`npx tsc --noEmit` returns 0).

**Status:** [x] done

---

### Task 3: Add Regex Detection in renderContent()

**Objective:** Detect `/steering-remove` and `/steering-alter` commands in the message converter and call the new callback functions.

**Requirements Covered:** FR-004

**Design References:** Design → Component: `renderContent()` Extension

**Actions:**
1. In `src/common/openai-message-converter.ts`, locate the `renderContent()` method.
2. After the existing `/steering-list` detection block (around line 167-168), add two new detection blocks:
   - Regex: `/^\/steering-remove\s+(\d+)(?:\s+(.+))?$/s` → calls `this.options.renderSteeringRemovePrompt?.(parseInt(match[1], 10), match[2]?.trim())`
   - Regex: `/^\/steering-alter\s+(\d+)(?:\s+(.+))?$/s` → calls `this.options.renderSteeringAlterPrompt?.(parseInt(match[1], 10), match[2]?.trim())`
3. Both blocks must be guarded by `if (message.role === "user")`.
4. Verify TypeScript compilation.

**Validation:** `npx tsc --noEmit` passes. Manual check: the regex correctly extracts position and optional text from sample strings.

**Status:** [x] done

---

### Task 4: Add SessionManager Render Methods

**Objective:** Implement the two private methods in SessionManager that load and render the EJS templates.

**Requirements Covered:** FR-006

**Design References:** Design → Component: `SessionManager` Render Methods

**Actions:**
1. Open `src/session.ts`.
2. After the existing `renderSteeringListCommandPrompt()` method (around line 2400), add:
   - `private renderSteeringRemoveCommandPrompt(position: number, replacementText?: string): string`
   - `private renderSteeringAlterCommandPrompt(position: number, replacementText?: string): string`
3. Both methods follow the exact pattern of existing render methods:
   - Build template path with `path.join(getExtensionRoot(), "templates", "prompts", "steering_remove.md.ejs")`
   - Read file with `fs.readFileSync(templatePath, "utf8")`
   - Render with `ejs.render(template, { position, replacementText: replacementText ?? null })`
4. Verify TypeScript compilation.

**Validation:** `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 5: Wire Converter Callbacks in SessionManager Constructor

**Objective:** Pass the new render methods to the converter options so the converter can call them.

**Requirements Covered:** FR-004, FR-006

**Design References:** Design → Component: `SessionManager` Render Methods (constructor wiring section)

**Actions:**
1. In `src/session.ts`, locate the `converterOptions` object in the constructor (around line 399-411).
2. Add two new lines after the existing `renderSteeringListPrompt` line:
   ```typescript
   renderSteeringRemovePrompt: (position: number, replacementText?: string) =>
     this.renderSteeringRemoveCommandPrompt(position, replacementText),
   renderSteeringAlterPrompt: (position: number, replacementText?: string) =>
     this.renderSteeringAlterCommandPrompt(position, replacementText),
   ```
3. Verify TypeScript compilation.

**Validation:** `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 6: Register Commands in Types (COMMAND_KINDS + PROMPT_COMMAND_KINDS)

**Objective:** Add both new command identifiers to the type system.

**Requirements Covered:** FR-003

**Design References:** Design → Component: Command Registration Points → `src/ui/types/commands.ts`

**Actions:**
1. Open `src/ui/types/commands.ts`.
2. In `COMMAND_KINDS` array (line 21-22), add after `"steering-list"`:
   ```typescript
   "steering-remove",
   "steering-alter",
   ```
3. In `PROMPT_COMMAND_KINDS` array (line 52-53), add after `"steering-list"`:
   ```typescript
   "steering-remove",
   "steering-alter",
   ```
4. Verify TypeScript compilation — this may reveal missing handlers/descriptions in other files, which is expected and will be resolved by subsequent tasks.

**Validation:** `npx tsc --noEmit` — may show errors about missing handlers (expected, fixed in Tasks 7-9).

**Status:** [x] done

---

### Task 7: Register Commands in Slash Menu

**Objective:** Add both commands to the slash command dropdown menu.

**Requirements Covered:** FR-003

**Design References:** Design → Component: Command Registration Points → `src/ui/core/slash-commands.ts`

**Actions:**
1. Open `src/ui/core/slash-commands.ts`.
2. In the commands array, after the `steering-list` entry (around line 83), add two new command objects:
   ```typescript
   {
     kind: "steering-remove",
     name: "steering-remove",
     label: "/steering-remove",
     description: "cmd.steering-remove",
   },
   {
     kind: "steering-alter",
     name: "steering-alter",
     label: "/steering-alter",
     description: "cmd.steering-alter",
   },
   ```
3. Verify by checking that the `SlashCommandKind` type now includes both new kinds, and the `description` fields use i18n keys.

**Validation:** `npx tsc --noEmit` — the `description` fields must have corresponding i18n keys (added in Task 11).

**Status:** [x] done

---

### Task 8: Register Commands in Buffer Text Set

**Objective:** Mark both commands as buffer-text commands so the prompt input captures trailing text.

**Requirements Covered:** FR-003

**Design References:** Design → Component: Command Registration Points → `src/ui/core/command-handlers.ts` (BUFFER_TEXT_COMMANDS)

**Actions:**
1. Open `src/ui/core/command-handlers.ts`.
2. In the `BUFFER_TEXT_COMMANDS` set (around line 80), add after `"steering-add"`:
   ```typescript
   "steering-remove",
   "steering-alter",
   ```

**Validation:** `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 9: Register Command Handlers

**Objective:** Add handler functions that submit the command text when the user selects them from the slash menu.

**Requirements Covered:** FR-003

**Design References:** Design → Component: Command Registration Points → `src/ui/core/command-handlers.ts` (COMMAND_HANDLERS)

**Actions:**
1. In `src/ui/core/command-handlers.ts`, in the `COMMAND_HANDLERS` record, add after the `steering-list` handler (around line 98-101):
   ```typescript
   "steering-remove": (_item, ctx) => {
     ctx.onSubmit({
       text: "/steering-remove " + ctx.buffer.text.replace(/^\/steering-remove\s+/, ""),
       imageUrls: [],
       selectedSkills: ctx.selectedSkills.length > 0 ? ctx.selectedSkills : undefined,
     });
     ctx.resetPromptInput();
   },
   "steering-alter": (_item, ctx) => {
     ctx.onSubmit({
       text: "/steering-alter " + ctx.buffer.text.replace(/^\/steering-alter\s+/, ""),
       imageUrls: [],
       selectedSkills: ctx.selectedSkills.length > 0 ? ctx.selectedSkills : undefined,
     });
     ctx.resetPromptInput();
   },
   ```
2. The pattern matches the existing `steering-add` handler — extracts trailing text from the buffer and appends it to the command.

**Validation:** `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 10: Update Slash Command Tests

**Objective:** Include both new commands in the expected command list used by existing tests.

**Requirements Covered:** FR-003

**Design References:** Design → Component: Test Extension

**Actions:**
1. Open `src/tests/slash-commands.test.ts`.
2. Find the array that lists all expected command kinds (around line 32-33, includes `"steering-add"` and `"steering-list"`).
3. Add `"steering-remove"` and `"steering-alter"` to that array, after `"steering-list"`.

**Validation:** `npm test` — the existing slash command tests should pass and include the new commands.

**Status:** [x] done

---

### Task 11: Add i18n Keys (English)

**Objective:** Add English descriptions for both new commands.

**Requirements Covered:** FR-007

**Design References:** Design → Component: i18n Dictionary Extensions → `src/i18n/en.ts`

**Actions:**
1. Open `src/i18n/en.ts`.
2. After the `"cmd.steering-list"` entry (line 13), add:
   ```typescript
   "cmd.steering-remove": "Remove the Nth steering rule by position from AGENTS.md",
   "cmd.steering-alter": "Alter the Nth steering rule by position in AGENTS.md",
   ```

**Validation:** `npx tsc --noEmit` — `I18nDictionary` type should now include both keys. The Portuguese and Spanish dictionaries will show type errors (missing keys) — expected, fixed in Tasks 12-13.

**Status:** [x] done

---

### Task 12: Add i18n Keys (Portuguese)

**Objective:** Add Portuguese translations for both new commands.

**Requirements Covered:** FR-007

**Design References:** Design → Component: i18n Dictionary Extensions → `src/i18n/pt.ts`

**Actions:**
1. Open `src/i18n/pt.ts`.
2. After the `"cmd.steering-list"` entry (line 15), add:
   ```typescript
   "cmd.steering-remove": "Remover a N-ésima regra de direção por posição do AGENTS.md",
   "cmd.steering-alter": "Alterar a N-ésima regra de direção por posição no AGENTS.md",
   ```

**Validation:** `npx tsc --noEmit` — Portuguese dictionary should be satisfied. Spanish will still show error (fixed in Task 13).

**Status:** [x] done

---

### Task 13: Add i18n Keys (Spanish)

**Objective:** Add Spanish translations for both new commands.

**Requirements Covered:** FR-007

**Design References:** Design → Component: i18n Dictionary Extensions → `src/i18n/es.ts`

**Actions:**
1. Open `src/i18n/es.ts`.
2. After the `"cmd.steering-list"` entry (line 15), add:
   ```typescript
   "cmd.steering-remove": "Eliminar la N-ésima regla de dirección por posición del AGENTS.md",
   "cmd.steering-alter": "Modificar la N-ésima regla de dirección por posición en el AGENTS.md",
   ```

**Validation:** `npx tsc --noEmit` — all three dictionaries should now have both keys. Zero type errors.

**Status:** [x] done

---

### Task 14: Full TypeScript Compilation Check

**Objective:** Verify that all changes compile without errors and no regressions are introduced.

**Requirements Covered:** All FRs (integration check)

**Design References:** All design components

**Actions:**
1. Run `npx tsc --noEmit`.
2. Verify zero errors.
3. If errors exist, fix them sequentially (most likely: missing import, type mismatch, or forgotten registration).

**Validation:** `npx tsc --noEmit` exits with code 0 and zero output (no errors).

**Status:** [x] done

---

### Task 15: Run Full Test Suite

**Objective:** Verify all existing tests pass with the changes.

**Requirements Covered:** NFR-002, All FRs

**Design References:** Testing Strategy

**Actions:**
1. Run `npm test`.
2. Verify all tests pass.
3. If any test fails, investigate the failure — it may reveal a missed registration point or a type mismatch.

**Validation:** `npm test` exits with code 0. All existing tests pass.

**Status:** [x] done

---

### Task 16: Manual Integration Verification

**Objective:** Verify the full end-to-end flow works correctly in a real DsCode session.

**Requirements Covered:** FR-001, FR-002, FR-003

**Design References:** Testing Strategy → Manual Verification Checklist

**Actions:**
1. Build the project: `npm run build`.
2. Launch DsCode in a test project that has an AGENTS.md with at least 3 steering rules.
3. Execute `/steering-list` to see the rules.
4. Execute `/steering-remove 2` — verify the 2nd rule is removed and reported.
5. Execute `/steering-list` — verify rule 2 is gone, rules are renumbered in the display.
6. Execute `/steering-alter 1 Always use camelCase` — verify the 1st rule is replaced.
7. Execute `/steering-remove 99` (out of range) — verify AI reports "out of range."
8. Verify the slash menu (`/`) shows both new commands under the steering group.
9. Verify Portuguese locale: `DEEPCODE_LOCALE=pt dscode` → menu shows Portuguese descriptions.

**Validation:** All manual checks pass.

**Status:** [x] done
