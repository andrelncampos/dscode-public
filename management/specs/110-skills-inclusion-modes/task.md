# Spec 110: Skills Inclusion Modes — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

---

## Tasks

### Task 1: Add `inclusion` Field to `SkillInfo` Type

**Objective:** Extend the `SkillInfo` type definition with the new `inclusion` optional field.

**Requirements Covered:** FR-001

**Design References:** Design → Component: `SkillInfo` Type Extension

**Actions:**
1. Open `src/session.ts`.
2. Locate the `SkillInfo` type definition (line 296-301).
3. Add `inclusion?: "auto" | "manual";` after the `isLoaded` field (before the closing `}`).
4. Verify TypeScript compilation: `npx tsc --noEmit`.

**Validation:** `npx tsc --noEmit` passes. No type errors from the new field.

**Status:** [x] done

---

### Task 2: Parse `inclusion` from SKILL.md Frontmatter

**Objective:** Extend `readSkillInfo()` to read and validate the `inclusion` field from YAML frontmatter.

**Requirements Covered:** FR-002

**Design References:** Design → Component: `readSkillInfo()` Extension

**Actions:**
1. In `src/session.ts`, locate the `readSkillInfo()` method (line 706-727).
2. In the try block, after the `description` assignment and before the `return` statement, add:
   ```typescript
   const rawInclusion = typeof parsed.data.inclusion === "string" ? parsed.data.inclusion.trim() : "";
   const inclusion: "auto" | "manual" | undefined =
     rawInclusion === "auto" || rawInclusion === "manual" ? (rawInclusion as "auto" | "manual") : undefined;
   ```
3. Add `inclusion` to the returned object:
   ```typescript
   return {
     name: ...,
     path: displayPath,
     description: ...,
     inclusion,
   };
   ```
4. Verify TypeScript compilation: `npx tsc --noEmit`.

**Validation:** `npx tsc --noEmit` passes. The returned `SkillInfo` object now includes `inclusion`.

**Status:** [x] done

---

### Task 3: Skip Manual Skills in `matchSkillsByKeywords()`

**Objective:** Add a guard clause to exclude skills with `inclusion === "manual"` from keyword matching.

**Requirements Covered:** FR-003, FR-006

**Design References:** Design → Component: `matchSkillsByKeywords()` Extension

**Actions:**
1. In `src/session.ts`, locate the `matchSkillsByKeywords()` method (line 574-603).
2. In the `for (const skill of skills)` loop, after the existing `if (skill.isLoaded) continue;` guard (line 580), add:
   ```typescript
   if (skill.inclusion === "manual") continue;
   ```
3. Verify TypeScript compilation: `npx tsc --noEmit`.

**Validation:** `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 4: Add `#skill-name` Detection in `submitCurrentBuffer()`

**Objective:** Detect `#skill-name` prefix in prompt input, load the skill, strip the prefix.

**Requirements Covered:** FR-004, FR-005

**Design References:** Design → Component: `#skill-name` Detection in PromptInput

**Actions:**
1. Open `src/ui/views/PromptInput.tsx`.
2. Locate the `submitCurrentBuffer()` function (line 678-703).
3. After the `if (!trimmed && imageUrls.length === 0 && selectedSkills.length === 0) return;` guard (line 685-687), and BEFORE the `if (trimmed.startsWith("/"))` check (line 689), insert the new `#skill-name` detection block:
   ```typescript
   const hashSkillMatch = trimmed.match(/^#([a-z][a-z0-9-]*)\b/i);
   if (hashSkillMatch) {
     const skillName = hashSkillMatch[1].toLowerCase();
     const matchedSkill = skills.find(
       (s) => s.name.toLowerCase() === skillName,
     );
     if (matchedSkill) {
       const strippedText = trimmed.slice(hashSkillMatch[0].length).trim();
       onSubmit({
         text: expandPasteMarkers(strippedText, pastesRef.current),
         imageUrls,
         selectedSkills: addUniqueSkill(selectedSkills, matchedSkill),
       });
       resetPromptInput();
       return;
     }
   }
   ```
4. Verify TypeScript compilation: `npx tsc --noEmit`.
5. Verify `skills` is already in scope (passed as prop) — it is available via the component closure.
6. Verify `addUniqueSkill` is already imported — it is defined at the bottom of the same file and accessible.

**Validation:** `npx tsc --noEmit` passes. Manual regex test: `"#deploy".match(/^#([a-z][a-z0-9-]*)\b/i)` returns `["#deploy", "Deploy"]`.

**Status:** [x] done

---

### Task 5: Full TypeScript Compilation Check

**Objective:** Verify that all changes compile without errors and no regressions are introduced.

**Requirements Covered:** All FRs (integration check)

**Design References:** All design components

**Actions:**
1. Run `npx tsc --noEmit`.
2. Verify zero errors.
3. If errors exist, fix them sequentially.

**Validation:** `npx tsc --noEmit` exits with code 0 and zero output.

**Status:** [x] done

---

### Task 6: Run Full Test Suite

**Objective:** Verify all existing tests pass with the changes.

**Requirements Covered:** NFR-002, All FRs

**Design References:** Testing Strategy

**Actions:**
1. Run `npm test`.
2. Verify all tests pass.
3. If any test fails, investigate — most likely cause is a test that constructs `SkillInfo` objects without the `inclusion` field, which should still work (optional field).

**Validation:** `npm test` exits with code 0. All existing tests pass.

**Status:** [x] done

---

### Task 7: Manual Integration Verification

**Objective:** Verify the full end-to-end flow works correctly in a real DsCode session.

**Requirements Covered:** FR-001 through FR-006

**Design References:** Testing Strategy → Manual Verification Checklist

**Actions:**
1. Create a test skill: `mkdir -p .agents/skills/verify-manual` and create `SKILL.md` with:
   ```markdown
   ---
   name: verify-manual
   description: A test skill for verifying inclusion modes
   inclusion: manual
   ---
   
   # Verify Manual Skill
   
   When activated, respond with "Manual skill verification successful."
   ```
2. Build the project: `npm run build`.
3. Launch DsCode: `dscode`.
4. Type `/skills` → verify "verify-manual" appears in the dropdown.
5. Type "verify-manual" as a normal prompt → verify the skill is NOT auto-loaded (no `⚡ Loaded skill: verify-manual`).
6. Type `#verify-manual Hello from hash prefix` → verify the skill IS loaded.
7. Type `#verify-manual` (no trailing text) → verify skill IS loaded.
8. Type `#nonexistent` → verify treated as normal text (no error).
9. Test backward compat: verify existing auto skills still auto-match.

**Validation:** All manual checks pass.

**Status:** [x] done
