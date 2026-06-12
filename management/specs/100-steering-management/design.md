# Spec 100: Steering Management — Design

## Design Approach

**Pattern: EJS Prompt Templates + Converter Interception**

This spec follows the exact same architectural pattern as all existing AI-executed slash commands (`/init`, `/steering-add`, `/steering-list`, `/spec-*`, `/model-*`):

1. **User types command** → Slash command menu or bare text in prompt.
2. **Command handler submits** → `text: "/steering-remove 3"` with preserved context.
3. **Message converter intercepts** → Regex match replaces raw text with rendered EJS template.
4. **AI executes instructions** → Uses existing tools (Read, Write, Edit, AskUserQuestion) to perform the operation.
5. **AI reports result** → User sees confirmation in the chat.

**Why not a programmatic implementation?** V15 explicitly states: "The AI performs the file edits using its existing file tools (Read, Write, Edit) — no new tool implementations needed." This keeps the implementation minimal (~18 lines per command across all files) and leverages the AI's ability to handle edge cases (file format variations, encoding, missing files) that would require significant defensive code in a programmatic approach.

---

## Architecture Decisions

### AD-HOC-100-1: Buffer Text Pattern (Not Fixed Text)

**Decision:** Both `/steering-remove <N>` and `/steering-alter <N>` use the "buffer text" pattern (like `/steering-add` and `/spec-plan`), not the "fixed text" pattern (like `/steering-list` and `/spec-init`).

**Rationale:** Both commands accept variable text — a number and optionally additional text. The buffer text pattern allows the user to type `/steering-alter 3 Replace with this text` in the prompt, which gets captured and passed to the template as `replacementText`.

**Alternative rejected:** Fixed text — would require the user to always type exactly `/steering-alter` and then provide text separately, which is less ergonomic.

### AD-HOC-100-2: Regex-Based Detection in Converter (Not isSteeringAddPrompt Pattern)

**Decision:** The converter detects both commands via regex in `renderContent()`, matching the existing pattern for `/steering-add` and `/spec-plan`. No separate `isSteeringRemovePrompt()` method is created.

**Rationale:** The `isSteeringAddPrompt()` method exists solely because `/steering-add` needs a custom message grouping behavior (the rendered prompt is a different message shape than the raw command). The new commands don't need special grouping — the regex in `renderContent()` is sufficient.

---

## Component / Module Breakdown

### Component: `steering_remove.md.ejs` Template

**Purpose:** Provides the AI with complete, deterministic instructions for removing a steering rule by position.

**Interface:**
- Input variables (EJS): `position: number`, `replacementText: string | null`
- Output: Rendered string (system prompt content)

**Internal Logic:**
```
1. INSTRUCT: Find AGENTS.md file
   - Check ./.dscode/AGENTS.md
   - Fallback: ./.deepcode/AGENTS.md
   - Fallback: ./AGENTS.md
   - If none found → STOP: "No AGENTS.md file found."

2. INSTRUCT: Read the file using Read tool
   - Locate heading matching /^## Steering\s*$/m
   - If no match → STOP: "No steering rules to remove."

3. INSTRUCT: Extract bullets
   - Parse lines between heading and next heading/EOF
   - Collect lines matching /^\s*-\s+.+/
   - Count bullets → bulletCount

4. INSTRUCT: Validate position
   - If position < 1 → STOP: "Invalid rule number: must be a positive integer."
   - If position > bulletCount → STOP: "There are {{bulletCount}} rules. Position {{position}} is out of range."

5. INSTRUCT: Remove bullet at index (position - 1)
   - Use Edit tool with snippet_id from the Read
   - old_string = the entire bullet line (including leading whitespace, "- ", content, and trailing newline)
   - ALSO include adjacent blank lines: if the line immediately above the bullet is blank, include it in old_string. If the line immediately below the bullet is blank AND that blank line is still within the Steering section (not a section separator), include it in old_string.
   - new_string = "" (empty)
   - If this is the last bullet, also trim any trailing blank lines before the next section heading

6. INSTRUCT: Report
   - "Removed rule #{{position}}: {{ruleText}}"
   - Optionally show remaining rules
```

**Dependencies:** EJS template engine (`ejs` package, already in project).

**Error Handling:**
- Missing file → AI reports to user, no file operations
- Missing section → AI reports to user, no file operations
- Out-of-range position → AI reports to user with bulletCount
- Invalid position (< 1) → AI reports to user
- Edit tool failure → AI reports the error (standard DsCode error propagation)

### Component: `steering_alter.md.ejs` Template

**Purpose:** Provides the AI with complete, deterministic instructions for altering a steering rule by position.

**Interface:**
- Input variables (EJS): `position: number`, `replacementText: string | null`
- Output: Rendered string (system prompt content)

**Internal Logic:**
```
1. INSTRUCT: Find AGENTS.md file (same as remove template)
   - If none → STOP: "No AGENTS.md file found."

2. INSTRUCT: Read and parse (same as remove template)
   - Extract bullets, count → bulletCount

3. INSTRUCT: Validate position (same as remove template)

4. INSTRUCT: Read current rule text
   - Get the text of bullet at index (position - 1)
   - Store as oldText (without "- " prefix)

5. INSTRUCT: Get replacement text
   - IF replacementText is provided AND has at least 1 non-whitespace character:
       newText = replacementText.trim()
   - ELSE:
       Show user: "Current rule #{{position}}: {{oldText}}"
       Use AskUserQuestion tool:
         Question: "Enter the new text for this rule:"
         Single text input
       IF user cancels → STOP: "Alteration cancelled."
       IF user input is empty or whitespace-only → re-ask (loop until non-empty or cancelled)
       newText = user input.trim()
   - IF newText === oldText → STOP: "Rule text unchanged." (no-op write is also acceptable)

6. INSTRUCT: Replace the rule
   - Use Edit tool with snippet_id from step 2
   - old_string = the entire bullet line (including leading whitespace, "- ", oldText, and newline)
   - new_string = the entire bullet line with newText (preserve "- " prefix and leading whitespace)

7. INSTRUCT: Report
   - "Rule #{{position}} altered."
   - Show old and new text
```

**Dependencies:** EJS template engine.

**Error Handling:**
- User cancels AskUserQuestion → AI reports cancellation
- Empty replacement text submitted by user → AI treats as "no text" and re-asks (template must enforce minimum 1 non-whitespace character)
- Whitespace-only replacement text submitted by user (e.g., `"   "`) → same as empty — re-ask
- All file-level errors (same as remove template)

### Component: `OpenAIMessageConverterOptions` Interface Extension

**Purpose:** Define the callback signatures for the new command prompt renderers.

**Interface (exact TypeScript):**
```typescript
// In src/common/openai-message-converter.ts
export interface OpenAIMessageConverterOptions {
  // ... existing fields ...
  /** Optional callback to render the /steering-remove command prompt template. */
  renderSteeringRemovePrompt?: (position: number, replacementText?: string) => string;
  /** Optional callback to render the /steering-alter command prompt template. */
  renderSteeringAlterPrompt?: (position: number, replacementText?: string) => string;
}
```

**Dependencies:** None (pure interface).

**Error Handling:** If callback is undefined, `renderContent()` returns the raw user text — no crash, no error message.

### Component: `renderContent()` Extension

**Purpose:** Detect the two new command patterns and substitute rendered templates.

**Interface:** Existing method `private renderContent(message: SessionMessage): string`.

**Internal Logic (add after existing `/steering-list` block, around line 167):**
```typescript
// After steering-list block (line 167-168):
if (message.role === "user") {
  const steeringRemoveMatch = message.content?.match(/^\/steering-remove\s+(\d+)(?:\s+(.+))?$/s);
  if (steeringRemoveMatch) {
    return this.options.renderSteeringRemovePrompt?.(
      parseInt(steeringRemoveMatch[1], 10),
      steeringRemoveMatch[2]?.trim()
    ) ?? "";
  }
}
if (message.role === "user") {
  const steeringAlterMatch = message.content?.match(/^\/steering-alter\s+(\d+)(?:\s+(.+))?$/s);
  if (steeringAlterMatch) {
    return this.options.renderSteeringAlterPrompt?.(
      parseInt(steeringAlterMatch[1], 10),
      steeringAlterMatch[2]?.trim()
    ) ?? "";
  }
}
```

**Regex patterns:**
- Remove: `/^\/steering-remove\s+(\d+)(?:\s+(.+))?$/s`
  - Group 1: position (digits)
  - Group 2: optional trailing text (captured but logged for `/steering-remove`; template ignores it)
- Alter: `/^\/steering-alter\s+(\d+)(?:\s+(.+))?$/s`
  - Group 1: position (digits)
  - Group 2: optional replacement text

**Dependencies:** None (pure string matching).

### Component: `SessionManager` Render Methods

**Purpose:** Two new private methods that load and render EJS templates.

**Interface (exact TypeScript):**
```typescript
// In src/session.ts, after renderSteeringListCommandPrompt (around line 2400)
private renderSteeringRemoveCommandPrompt(position: number, replacementText?: string): string {
  const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "steering_remove.md.ejs");
  const template = fs.readFileSync(templatePath, "utf8");
  return ejs.render(template, { position, replacementText: replacementText ?? null });
}

private renderSteeringAlterCommandPrompt(position: number, replacementText?: string): string {
  const templatePath = path.join(getExtensionRoot(), "templates", "prompts", "steering_alter.md.ejs");
  const template = fs.readFileSync(templatePath, "utf8");
  return ejs.render(template, { position, replacementText: replacementText ?? null });
}
```

**Dependencies:** `fs.readFileSync`, `path.join`, `ejs.render`, `getExtensionRoot()` (all already imported/available).

**Constructor wiring (add 2 lines to converterOptions object):**
```typescript
renderSteeringRemovePrompt: (position: number, replacementText?: string) =>
  this.renderSteeringRemoveCommandPrompt(position, replacementText),
renderSteeringAlterPrompt: (position: number, replacementText?: string) =>
  this.renderSteeringAlterCommandPrompt(position, replacementText),
```

### Component: Command Registration Points

**Purpose:** Register the two new commands in all 5 mandatory registration arrays.

**File: `src/ui/types/commands.ts`:**
```typescript
// In COMMAND_KINDS array (add after "steering-list"):
"steering-remove",
"steering-alter",

// In PROMPT_COMMAND_KINDS array (add after "steering-list"):
"steering-remove",
"steering-alter",
```

**File: `src/ui/core/command-handlers.ts`:**
```typescript
// In BUFFER_TEXT_COMMANDS set (add after "steering-add"):
"steering-remove",
"steering-alter",

// In COMMAND_HANDLERS record (add after steering-list handler):
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

**File: `src/ui/core/slash-commands.ts`:**
```typescript
// In commands array (add after steering-list entry):
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

### Component: i18n Dictionary Extensions

**Purpose:** Add translated command descriptions.

**File: `src/i18n/en.ts` (add after "cmd.steering-list"):**
```typescript
"cmd.steering-remove": "Remove the Nth steering rule by position from AGENTS.md",
"cmd.steering-alter": "Alter the Nth steering rule by position in AGENTS.md",
```

**File: `src/i18n/pt.ts` (add after "cmd.steering-list"):**
```typescript
"cmd.steering-remove": "Remover a N-ésima regra de direção por posição do AGENTS.md",
"cmd.steering-alter": "Alterar a N-ésima regra de direção por posição no AGENTS.md",
```

**File: `src/i18n/es.ts` (add after "cmd.steering-list"):**
```typescript
"cmd.steering-remove": "Eliminar la N-ésima regla de dirección por posición del AGENTS.md",
"cmd.steering-alter": "Modificar la N-ésima regla de dirección por posición en el AGENTS.md",
```

### Component: Test Extension

**Purpose:** Include new commands in the existing slash command test.

**File: `src/tests/slash-commands.test.ts`:**
```typescript
// In expected command list (add after "steering-list"):
"steering-remove",
"steering-alter",
```

---

## Data Flow

### Flow 1: `/steering-remove 2`

```
User types "/steering-remove 2" in prompt
  ↓
PromptInput submits { text: "/steering-remove 2", command: "steering-remove" }
  ↓
SessionManager.replySession() receives userPrompt.text = "/steering-remove 2"
  ↓
OpenAIMessageConverter.renderContent() detects regex match
  Groups: [1]="2", [2]=undefined
  ↓
Calls converterOptions.renderSteeringRemovePrompt(2, undefined)
  ↓
SessionManager.renderSteeringRemoveCommandPrompt(2, undefined)
  ↓
Reads templates/prompts/steering_remove.md.ejs
Renders with ejs: { position: 2, replacementText: null }
  ↓
Rendered prompt replaces "/steering-remove 2" in the message array
  ↓
AI receives instructions: find file, read, locate 2nd bullet, remove, write, report
  ↓
AI uses Read tool → finds AGENTS.md, extracts 2nd bullet
  ↓
AI uses Edit tool → removes the bullet line
  ↓
AI reports: "Removed rule #2: Always use tabs"
```

### Flow 2: `/steering-alter 3 Use spaces instead`

```
User types "/steering-alter 3 Use spaces instead" in prompt
  ↓
PromptInput submits { text: "/steering-alter 3 Use spaces instead", ... }
  ↓
OpenAIMessageConverter.renderContent() detects regex match
  Groups: [1]="3", [2]="Use spaces instead"
  ↓
Calls converterOptions.renderSteeringAlterPrompt(3, "Use spaces instead")
  ↓
Template receives { position: 3, replacementText: "Use spaces instead" }
  ↓
AI receives instructions: find file, read, locate 3rd bullet, replace text, write, report
  ↓
AI uses Read tool → finds AGENTS.md, extracts 3rd bullet
  ↓
Template says: replacementText is provided, use it directly (skip AskUserQuestion)
  ↓
AI uses Edit tool → replaces bullet text, keeps "- " prefix
  ↓
AI reports: "Rule #3 altered. Old: 'Always use tabs' → New: 'Use spaces instead'"
```

### Flow 3: `/steering-alter 1` (no replacement text)

```
User types "/steering-alter 1" in prompt (or selects from slash menu)
  ↓
Converter calls renderSteeringAlterPrompt(1, undefined)
  ↓
Template receives { position: 1, replacementText: null }
  ↓
AI receives instructions: read rule 1, show user, ask for new text
  ↓
AI uses Read tool → shows "Current rule #1: Always write tests first"
  ↓
AI uses AskUserQuestion → "Enter the new text for this rule:"
  ↓
User types "Never skip tests" → AI uses Edit tool → replaces
  ↓
AI reports alteration
```

---

## Data Structures

No new data structures. The only data flow is:
- Command strings (`"/steering-remove 2"`, `"/steering-alter 3 new text"`) → parsed by regex into `position: number` and `replacementText: string | undefined`
- Template variables: `{ position: number, replacementText: string | null }` passed to EJS

No new types, interfaces (beyond the two new optional callback fields on an existing interface), or schemas.

---

## File / Module Layout

### New Files (2)

| File | Purpose | Content |
|------|---------|---------|
| `templates/prompts/steering_remove.md.ejs` | AI prompt for rule removal | ~40 lines EJS template |
| `templates/prompts/steering_alter.md.ejs` | AI prompt for rule alteration | ~50 lines EJS template |

### Modified Files (9)

| File | Change | Lines |
|------|--------|-------|
| `src/common/openai-message-converter.ts` | 2 optional callback types in interface; 2 regex match blocks in `renderContent()` | +12 |
| `src/session.ts` | 2 private render methods; 2 lines in constructor callback wiring | +14 |
| `src/ui/types/commands.ts` | 2 entries in `COMMAND_KINDS`; 2 entries in `PROMPT_COMMAND_KINDS` | +4 |
| `src/ui/core/slash-commands.ts` | 2 command objects in commands array | +12 |
| `src/ui/core/command-handlers.ts` | 2 entries in `BUFFER_TEXT_COMMANDS`; 2 entries in `COMMAND_HANDLERS` | +18 |
| `src/i18n/en.ts` | 2 new key-value pairs | +2 |
| `src/i18n/pt.ts` | 2 new key-value pairs | +2 |
| `src/i18n/es.ts` | 2 new key-value pairs | +2 |
| `src/tests/slash-commands.test.ts` | 2 entries in expected command list | +2 |

**Total: ~68 new/modified lines across 9 files + 2 new template files (~90 lines).**

---

## Testing Strategy

### Unit Test: Command Registration

**Test file:** `src/tests/slash-commands.test.ts`

- Verify that `COMMAND_KINDS` includes `"steering-remove"` and `"steering-alter"`.
- Verify that `PROMPT_COMMAND_KINDS` includes both.
- Verify that all slash commands have corresponding descriptions in all 3 i18n dictionaries.

### Unit Test: Message Converter Regex

**Test file:** `src/tests/openai-message-converter.test.ts` (if exists) or new test block in `slash-commands.test.ts`.

**Scenarios:**
1. Input: `"/steering-remove 3"` → converter calls `renderSteeringRemovePrompt(3, undefined)`.
2. Input: `"/steering-remove   5   extra text"` → converter calls `renderSteeringRemovePrompt(5, "extra text")`.
3. Input: `"/steering-alter 2 New rule"` → converter calls `renderSteeringAlterPrompt(2, "New rule")`.
4. Input: `"/steering-alter 1"` → converter calls `renderSteeringAlterPrompt(1, undefined)`.
5. Input: `"/steering-remove"` (no number) → regex does not match, raw text passes through.
6. Input: `"/steering-alter abc"` (non-numeric) → regex does not match, raw text passes through.

### Integration Test: Template Rendering

**Test approach:** Create mock AGENTS.md files with known content, invoke the rendered prompt via the converter pipeline, and verify the AI receives correct instructions.

**Cannot test the AI's actual file edits** — that requires a running LLM. The template content is validated by:
- Manual review of the template (ensuring it matches the design spec).
- EJS syntax validation (`ejs.render()` throws on syntax errors).

### Manual Verification Checklist

1. Type `/steering-remove 2` → AI reads file, removes 2nd rule, confirms.
2. Type `/steering-alter 1 Always commit before asking for review` → AI reads, replaces, confirms.
3. Type `/steering-alter 5` (out of range) → AI reports "out of range."
4. Empty AGENTS.md → Both commands report appropriate messages.
5. Verify the slash menu shows both commands under the steering group.

---

## Migration / Rollback

**Migration:** None required. This is a pure addition — no existing behavior changes, no data format changes, no configuration changes.

**Rollback:** Revert the commit. Since no file format or state changes, rollback has zero side effects. All existing AGENTS.md files remain compatible.
