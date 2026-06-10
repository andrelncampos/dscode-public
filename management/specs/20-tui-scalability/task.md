# Spec 20: TUI Scalability — Tasks

## Implementation Order (Strict)

---

### Task 20.1 — Centralize Layout Constants (QW#4)
**Status:** [x] done

### Task 20.2 — Extract Error Classification Module (QW#10)
**Status:** [x] done

### Task 20.3 — Create Barrel Export for core/ (QW#13)
**Status:** [x] done

### Task 20.4 — Typed PromptInput Props (QW#12)
**Status:** [x] done

### Task 20.5 — Command Handler Dispatch Map (QW#1)
**Status:** [x] done

### Task 20.6 — StatusBar Component (QW#7)
**Status:** [x] done

### Task 20.7 — PromptFooter Component (QW#8)
**Status:** [x] done

### Task 20.8 — Lazy Scan File Mentions (QW#9)
**Status:** [x] done

### Task 20.9 — Debounce Stream Progress (QW#15)
**Status:** [x] done

### Task 20.10 — useWelcomeScreen Hook (QW#14)
**Status:** [x] done

### Task 20.11 — useStreamingState Hook (QW#2)
**Status:** [x] done

### Task 20.12 — usePermissionFlow Hook (QW#3)
**Status:** [x] done

### Task 20.13 — useResizeHandler Hook (QW#11)
**Status:** [x] done

### Task 20.14 — useSessionManager Hook (QW#6)
**Status:** [x] done

### Task 20.15 — Type-Safe View Router (QW#5)
**Status:** [x] done

---

## Final Verification

- [x] `npm run typecheck` — zero errors
- [ ] `npm run test` — all existing tests pass
- [ ] `npm run lint` — no new warnings
- [ ] `App.tsx` reduced by ≥200 lines from pre-spec baseline
- [ ] `PromptInput.tsx` reduced by ≥150 lines from pre-spec baseline
- [ ] Zero magic numbers in layout components
- [ ] All 15 commits follow format: `refactor(ui): QW#N — descrição curta`
