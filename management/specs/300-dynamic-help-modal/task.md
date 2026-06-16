---
name: dynamic-help-modal
status: verified
references: V30, V1
---

# Spec 300: Dynamic Help Modal — Implementation Tasks

## Task Order

Tasks MUST be executed sequentially in numerical order. Each task depends on the completion of all preceding tasks.

## Tasks

### Task 1: Add `getCommandSection` Helper

**Objective:** Create a pure function that maps `kind` to section index.

**Requirements Covered:** FR-002.
**Design References:** Component 1 in design.md.

**Actions:**
1. Open `src/ui/views/HelpModal.tsx`.
2. Add after the `ShortcutEntry` type definition (line 22) and before `buildBaseShortcuts`:

```typescript
function getCommandSection(kind: string): number {
  if (kind.startsWith("notes")) return 1;
  if (kind.startsWith("spec")) return 2;
  if (kind.startsWith("model-")) return 3;
  if (kind.startsWith("steering") || kind === "budget") return 4;
  return 0; // Conversation
}
```

**Validation:** `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 2: Add `buildCommandShortcuts` Function

**Objective:** Create a function that generates `ShortcutEntry[]` from `BUILTIN_SLASH_COMMANDS`, grouped by section.

**Requirements Covered:** FR-001, FR-003.
**Design References:** Component 2 in design.md.

**Actions:**
1. Open `src/ui/views/HelpModal.tsx`.
2. Add import for `BUILTIN_SLASH_COMMANDS` (note: the file already imports from `"../core/slash-commands"` — add `BUILTIN_SLASH_COMMANDS` alongside the existing import or add a new import line).
3. Add the function after `getCommandSection`:

```typescript
function buildCommandShortcuts(t: (key: string) => string): ShortcutEntry[] {
  const sectionNames = ["Conversation", "Notes", "Specs", "Models", "Steering & Budget"];
  const bySection: ShortcutEntry[][] = sectionNames.map(() => []);

  for (const item of BUILTIN_SLASH_COMMANDS) {
    const section = getCommandSection(item.kind);
    let desc = t(`help.${item.kind}-cmd`);
    // Fallback: if untranslated, try the item's own description i18n key
    if (desc === `help.${item.kind}-cmd`) {
      desc = t(item.description);
      if (desc === item.description) desc = item.description;
    }
    bySection[section].push({
      key: item.label,
      description: desc ?? "",
    });
  }

  const result: ShortcutEntry[] = [];
  for (let i = 0; i < bySection.length; i++) {
    const entries = bySection[i];
    if (entries.length === 0) continue;
    entries.sort((a, b) => a.key.localeCompare(b.key));
    result.push({ key: "", description: "", separator: true });
    for (const entry of entries) {
      result.push(entry);
    }
  }
  return result;
}
```

**Validation:** `npx tsc --noEmit` passes.

**Status:** [x] done

---

### Task 3: Replace Hardcoded Commands with Generated List

**Objective:** Delete hardcoded command sections and use `buildCommandShortcuts`.

**Requirements Covered:** FR-001, FR-005.
**Design References:** Component 3 in design.md.

**Actions:**
1. Open `src/ui/views/HelpModal.tsx`.
2. In `buildBaseShortcuts`, delete lines 48-95 (from `// ── Conversation ──` through the `{ key: "/budget", description: t("help.budget-cmd") },` line).
3. After the keyboard shortcuts array (at the end of the remaining array, line 47), add:
   ```typescript
   ...buildCommandShortcuts(t),
   ```
4. The return statement becomes:
   ```typescript
   return [
     // Keyboard shortcuts (unchanged)
     { key: "?", description: t("help.toggle") },
     // ... existing keyboard entries ...
     { key: "PageUp/PageDown", description: t("help.scroll-history") },
     // Generated command shortcuts
     ...buildCommandShortcuts(t),
   ];
   ```

**Validation:** `npx tsc --noEmit` passes. The resulting shortcut list has the same total number of entries as before (21 keyboard + 40 commands = 61, excluding separators).

**Status:** [x] done

---

### Task 4: Verify Visual Identity

**Objective:** Manually verify the help screen renders identically to before.

**Requirements Covered:** NFR-002.
**Design References:** Testing Strategy in design.md.

**Actions:**
1. Run `npx tsc --noEmit` — confirm zero errors.
2. Build the project and launch DsCode.
3. Press `?` to open the help screen.
4. Verify:
   - All expected commands appear.
   - Sections are separated by blank lines in the correct order: Keyboard → Conversation → Notes → Specs → Models → Steering & Budget.
   - Commands within each section are sorted alphabetically.
   - No command is missing compared to the previous hardcoded version.

**Validation:** Visual inspection. Count of entries matches (61 non-separator entries).

**Status:** [x] done
