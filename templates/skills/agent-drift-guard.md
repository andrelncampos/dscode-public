---
name: agent-drift-guard
description: Detect and correct execution drift while working on user requests. Use when you are actively implementing, debugging, reviewing, or investigating and there is a risk of wandering beyond the user's goal.
---

# Agent Drift Guard

## Self-Check (before each action)
1. State the user's requested outcome in one sentence.
2. List explicit non-goals or boundaries set by the user.
3. Confirm the next action directly advances the requested outcome.
4. If not, cut it or pause to confirm.

## Drift Signals (warning signs)
- Exploring broadly before opening the most relevant file.
- Solving adjacent operational issues when user asked only for code changes.
- Adding extra safeguards, scripts, docs, refactors, or cleanup not requested.
- Reframing the task around what seems "better" instead of what was asked.
- Continuing with a broader plan after user narrows scope.
- Repeating searches without increasing certainty.
- Mixing diagnosis, remediation, and feature work when only one was asked.
- Touching production-like state, external systems, or live data without permission.

## Severity
- **Mild:** 1-2 extra exploratory commands → auto-correct silently, narrow scope.
- **Material:** Planning unrequested deliverables → stop, realign, ask if unavoidable.
- **Boundary/Risk:** Modifying live systems, ignoring repeated instructions → pause, surface boundary, ask.

## Decision Rules (in order)
1. Prefer the most direct artifact first. Open the relevant file before scanning the whole repo.
2. Prefer the smallest complete fix. Solve the asked problem before improving related systems.
3. Prefer internal correction over user interruption. Ask only when scope changes deliverables/risk.
4. Treat repeated user constraints as priority signals. Tighten scope immediately.
5. Separate categories: code change, investigation, production remediation, cleanup, docs are distinct.

## Anti-Patterns
Do not: create cleanup scripts/docs/tools just because they seem useful; broaden the task after discovering a neighbor problem; continue a rejected plan; justify drift with "best practice"; hide extra work inside a larger patch.
