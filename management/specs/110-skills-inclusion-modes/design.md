# Spec 110: Skills Inclusion Modes — Design

## Design Approach

**Pattern: Minimal Type Extension + Guard Clause + Inline Syntax Detection**

This spec adds 3 surgical changes to the existing skill infrastructure:

1. **Type extension**: `SkillInfo` gains `inclusion?: "auto" | "manual"` — a single optional field.
2. **Guard clause**: `matchSkillsByKeywords()` adds 1 line to skip manual skills.
3. **Inline detection**: `submitCurrentBuffer()` adds ~15 lines to detect `#skill-name` prefix.

No new modules, no new files, no new dependencies, no changes to skill loading pipeline.

---

## Architecture Decisions

### AD-HOC-110-1: `#` Detection Before `/` in submitCurrentBuffer

**Decision:** The `#skill-name` check is placed BEFORE the `/` slash command check in `submitCurrentBuffer()`.

**Rationale:** `#` and `/` are mutually exclusive prefixes semantically. However, if a user types `#skill-name` and a slash command with the same name exists, they likely want the skill, not the command. Precedence: `#` is a content prefix (knowledge), `/` is an action prefix (commands).

**Alternative rejected:** Place `#` after `/` — would cause `#skill-name` to be interpreted as an unrecognized slash command, losing the skill activation.

### AD-HOC-110-2: Case-Insensitive `#skill-name` Matching

**Decision:** The regex for `#skill-name` is case-insensitive (`/^#([a-z][a-z0-9-]*)\b/i`).

**Rationale:** Skill names in `SkillInfo` are already stored in their original case. The `listSkills()` dedup uses `skillsByName` which is case-sensitive. However, `gray-matter` preserves the exact case from the frontmatter. The lookup must handle: the user types `#Deploy` but the skill name is `deploy`. Solution: case-insensitive lookup in the skills array.

### AD-HOC-110-3: `inclusion` Validation is Strict at Parse Time

**Decision:** `readSkillInfo()` validates the `inclusion` value against the exact strings `"auto"` and `"manual"` (case-sensitive). Invalid values are silently discarded (set to `undefined`).

**Rationale:** Silent discard prevents a typo in SKILL.md from breaking the whole skill system. A misspelled inclusion mode falls back to the default (`auto`). The skill author can correct it later.

**Alternative rejected:** Throw an error — would prevent the skill from being listed at all, which is worse than auto-matching unexpectedly.

---

## Component / Module Breakdown

### Component: `SkillInfo` Type Extension

**Purpose:** Add the `inclusion` field to the canonical skill metadata type.

**Interface (exact TypeScript):**
```typescript
// In src/session.ts, line 296-301, modify:
export type SkillInfo = {
  name: string;
  path: string;
  description: string;
  isLoaded?: boolean;
  inclusion?: "auto" | "manual";
};
```

**Dependencies:** None (pure type).

### Component: `readSkillInfo()` Extension

**Purpose:** Parse and validate the `inclusion` field from SKILL.md YAML frontmatter.

**Interface:** Existing private method `readSkillInfo(skillPath: string, displayPath: string, fallbackName: string): SkillInfo`.

**Internal Logic (add after existing `description` parsing, around line 722):**
```typescript
// After: description: typeof parsed.data.description === "string" ? parsed.data.description.trim() : "",
// Add:
const rawInclusion = typeof parsed.data.inclusion === "string" ? parsed.data.inclusion.trim() : "";
const inclusion = rawInclusion === "auto" || rawInclusion === "manual" ? rawInclusion : undefined;
// Add `inclusion` to the returned object:
return {
  name: ...,
  path: displayPath,
  description: ...,
  inclusion, // <-- NEW FIELD
};
```

**Validation rules:**
- `typeof parsed.data.inclusion === "string"` — ensure it's a string before calling `.trim()`.
- `rawInclusion === "auto" || rawInclusion === "manual"` — exact case-sensitive match.
- If neither matches → `inclusion = undefined` (backward compatible default).
- Whitespace trimmed before comparison.

**Dependencies:** `matter` from `gray-matter` (already imported as `matter` in session.ts).

**Error Handling:** Malformed YAML → `matter()` returns empty `data` → `parsed.data.inclusion` is `undefined` → `typeof undefined` is not `"string"` → `inclusion = undefined`. Graceful degradation.

### Component: `matchSkillsByKeywords()` Extension

**Purpose:** Exclude skills with `inclusion === "manual"` from automatic keyword matching.

**Interface:** Existing private method `matchSkillsByKeywords(skills: SkillInfo[], userPrompt: string): string[]`.

**Internal Logic (add 1 line after existing `isLoaded` guard at line 580):**
```typescript
for (const skill of skills) {
  if (skill.isLoaded) continue;
  if (skill.inclusion === "manual") continue;  // <-- NEW LINE
  // ... rest of the matching logic unchanged
}
```

**Rationale for placement:** The guard is placed AFTER the `isLoaded` check but BEFORE any keyword matching computation. This avoids unnecessary string operations for manual skills.

**Dependencies:** None (pure condition check on existing data).

### Component: `#skill-name` Detection in PromptInput

**Purpose:** Detect `#skill-name` prefix at the start of the prompt, load the referenced skill, and strip the prefix.

**Interface:** Modification to `submitCurrentBuffer()` in `src/ui/views/PromptInput.tsx`.

**Internal Logic (insert BEFORE the `/` slash command check, around line 689):**
```typescript
function submitCurrentBuffer(): void {
  if (busy) {
    setStatusMessage("wait for the current response or press esc to interrupt");
    return;
  }

  const trimmed = buffer.text.trim();
  if (!trimmed && imageUrls.length === 0 && selectedSkills.length === 0) {
    return;
  }

  // NEW BLOCK: #skill-name prefix detection
  const hashSkillMatch = trimmed.match(/^#([a-z][a-z0-9-]*)\b/i);
  if (hashSkillMatch) {
    const skillName = hashSkillMatch[1].toLowerCase();
    const matchedSkill = skills.find(
      (s) => s.name.toLowerCase() === skillName,
    );
    if (matchedSkill) {
      // Strip the #skill-name prefix and any trailing whitespace
      const strippedText = trimmed.slice(hashSkillMatch[0].length).trim();
      // Submit with the skill attached — text may be empty
      onSubmit({
        text: expandPasteMarkers(strippedText, pastesRef.current),
        imageUrls,
        selectedSkills: addUniqueSkill(selectedSkills, matchedSkill),
      });
      resetPromptInput();
      return;
    }
    // If no skill matched, fall through — # is treated as regular text
  }

  // Existing / slash command check
  if (trimmed.startsWith("/")) {
    // ... unchanged
  }

  // ... rest unchanged
}
```

**Regex breakdown:**
- `^#` — start of trimmed string, followed by `#`
- `([a-z][a-z0-9-]*)` — capture group: first char must be a letter, followed by letters/digits/hyphens
- `\b` — word boundary (prevents matching `#deploy` within `#deployment` beyond 7 chars — actually, `\b` after `[a-z0-9-]*` matches at end of alpha sequence, so `#deploy` in `#deployment` would capture `#deployment` since the `*` is greedy. The `\b` ensures the match ends at a word boundary.)
- `/i` — case-insensitive

**Skill lookup:** `skills.find((s) => s.name.toLowerCase() === skillName)` — case-insensitive comparison. The `skills` array is already available in the component closure (passed as a prop).

**Dependencies:** `addUniqueSkill` (already imported from `PromptInput.tsx`), `skills` prop (already passed to component), `pastesRef`, `expandPasteMarkers`, `onSubmit`, `resetPromptInput`, `imageUrls`, `selectedSkills`, `setSelectedSkills` — all already in scope.

**Error Handling:**
- No matching skill → fall through, `#` treated as regular text.
- `#` alone without letters → regex doesn't match → fall through.
- `#123` (digits after `#`) → regex requires first char letter → doesn't match → fall through.

### Component: SessionManager `createSession()` / `replySession()` — No Changes

**Purpose:** Verify that the existing skill auto-matching flow works correctly with manual skills excluded.

**Verification:** `matchSkillsByKeywords()` already handles the exclusion internally. The calling code in `createSession()` (line 931-932) and `replySession()` (line 1006-1007) calls `matchSkillsByKeywords(skills, userPrompt.text ?? "")` and uses the returned names. Since manual skills are filtered out inside `matchSkillsByKeywords()`, the calling code receives only auto-matched skill names. No changes needed.

---

## Data Flow

### Flow 1: `inclusion: manual` Skill — No Auto-Match

```
User types "I need help with deploying to production"
  ↓
submitCurrentBuffer() → onSubmit({ text: "I need help with deploying to production", ... })
  ↓
SessionManager.createSession()
  ↓
listSkills() → returns skills, including "deploy" with inclusion: "manual"
  ↓
matchSkillsByKeywords(skills, "I need help with deploying to production")
  ↓
Iterates skills:
  - "deploy": inclusion === "manual" → continue (SKIPPED)
  - "css-patterns": inclusion undefined → keywords: "production" matches? No.
  - ...
  ↓
Returns [] (no auto-matched skills)
  ↓
Skill "deploy" is NOT loaded into context.
```

### Flow 2: `#deploy` Activation

```
User types "#deploy What is the current deployment status?"
  ↓
submitCurrentBuffer() detects regex match: hashSkillMatch = ["#deploy", "deploy"]
  ↓
skills.find(s => s.name.toLowerCase() === "deploy") → found
  ↓
setSelectedSkills → adds "deploy" skill
  ↓
strippedText = "What is the current deployment status?"
  ↓
onSubmit({ text: "What is the current deployment status?", imageUrls: [], selectedSkills: [deploy] })
  ↓
SessionManager receives userPrompt with selectedSkills: [deploy]
  ↓
matchSkillsByKeywords() runs but deploy is already in selectedSkills → isLoaded check? No, isLoaded is checked via session messages.
  ↓
normalizeSkills() resolves selectedSkills, deduplicates, loads skill content into context.
  ↓
AI receives skill instructions + user prompt.
```

### Flow 3: `#deploy` (No Prompt Text)

```
User types "#deploy" and presses Enter
  ↓
trimmed = "#deploy" → non-empty, passes empty check
  ↓
hashSkillMatch detected, skill found
  ↓
strippedText = ""
  ↓
onSubmit({
  text: "",  // empty text
  imageUrls: [],
  selectedSkills: [deploy], // skill attached
})
  ↓
resetPromptInput()
  ↓
SessionManager processes empty prompt with skill → loads skill into context
```

---

## Data Structures

### Modified Type: `SkillInfo`

```typescript
export type SkillInfo = {
  name: string;
  path: string;
  description: string;
  isLoaded?: boolean;
  inclusion?: "auto" | "manual";  // NEW — undefined means "auto"
};
```

No new types, interfaces, or schemas.

---

## File / Module Layout

### Modified Files (2)

| File | Change | Lines |
|------|--------|-------|
| `src/session.ts` | 1 new field on `SkillInfo` type; 2-3 lines in `readSkillInfo()` to parse `inclusion`; 1 line guard in `matchSkillsByKeywords()` | +5 |
| `src/ui/views/PromptInput.tsx` | ~15 lines in `submitCurrentBuffer()` for `#skill-name` detection | +15 |

**Total: ~20 new lines across 2 files. Zero new files.**

---

## Testing Strategy

### Unit Test: `inclusion` Field Parsing

Test `readSkillInfo()` with various SKILL.md frontmatter inputs:

1. `inclusion: auto` → `SkillInfo.inclusion = "auto"`
2. `inclusion: manual` → `SkillInfo.inclusion = "manual"`
3. No `inclusion` field → `SkillInfo.inclusion = undefined`
4. `inclusion: always` (invalid) → `SkillInfo.inclusion = undefined`
5. `inclusion: Manual` (wrong case) → `SkillInfo.inclusion = undefined`
6. `inclusion: ""` (empty) → `SkillInfo.inclusion = undefined`
7. `inclusion: " manual"` (leading space) → `SkillInfo.inclusion = "manual"`

### Unit Test: `matchSkillsByKeywords()` Exclusion

Test with mock skills:
1. Skill with `inclusion: "manual"` and prompt containing its name → NOT matched.
2. Skill with `inclusion: "auto"` and prompt containing its name → matched.
3. Skill with `inclusion: undefined` and prompt containing its name → matched (backward compat).
4. Skill with `inclusion: "manual"` and prompt containing description keywords → NOT matched.

### Unit Test: `#skill-name` Regex

Test the regex against input strings:
1. `"#deploy"` → matches, group 1 = `"deploy"`
2. `"#deploy What is up?"` → matches, group 1 = `"deploy"`
3. `"#my-skill text"` → matches, group 1 = `"my-skill"`
4. `"#CSS-patterns"` → matches (case-insensitive), group 1 = `"CSS-patterns"`
5. `"#"` → no match (requires at least one letter)
6. `"#123"` → no match (first char must be letter)
7. `"Some text #deploy"` → no match (not at start)
8. `"/deploy"` → no match (starts with `/`, not `#`)

### Integration Test: Full Flow

1. Create a SKILL.md with `inclusion: manual` in a test project.
2. Start DsCode, verify the skill appears in `/skills` dropdown.
3. Type a prompt containing keywords from the skill's description → verify skill is NOT auto-loaded.
4. Type `#skill-name Some question` → verify skill IS loaded.
5. Type `#skill-name` with no trailing text → verify skill IS loaded (empty prompt).

### Manual Verification Checklist

1. Create a test skill: `.agents/skills/manual-test/SKILL.md` with `inclusion: manual`.
2. `dscode` → `/skills` → verify skill is listed.
3. Type "manual-test" → verify skill is NOT auto-loaded.
4. Type `#manual-test Hello` → verify skill IS loaded.
5. Type `#nonexistent-skill` → verify treated as normal text.
6. Verify existing auto skills still auto-match (backward compat).

---

## Migration / Rollback

**Migration:** None required. All existing `SKILL.md` files without `inclusion` continue working as `auto`.

**Rollback:** Revert the commit. No data format changes, no state changes. Existing skills with `inclusion: manual` in their frontmatter would auto-match again (the field would be ignored), but this is safe — they'd just be loaded more often than intended, not broken.
