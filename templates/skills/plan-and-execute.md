---
name: plan-and-execute
description: Automatically plan and execute requirements. Creates a markdown task list with the UpdatePlan tool, and systematically executes each task while updating progress. Use when working with task planning or when you need to break down and execute complex multi-step requirements.
---

# Plan and Execute

## Workflow
1. Analyze requirements and explore project context.
2. Clarify ambiguities with AskUserQuestion.
3. Create markdown task list via UpdatePlan.
4. Execute tasks one at a time, updating plan in real time.
5. Revise remaining plan as new context appears.

## Task States
- `[ ]` Pending
- `[>]` In progress
- `[x]` Completed
- `[!]` Blocked

## Rules
- Only ONE task in progress at a time.
- Always pass the complete markdown task list (not a partial diff).
- Refresh plan before first task and after each task completion.
- Remove irrelevant tasks; add newly discovered ones before working on them.
- For complex tasks, add indented sub-tasks below the main task.

## When to Use
Multi-step tasks (3+ steps), feature implementation, bug fixing, refactoring, detailed requirements, progress tracking.

## When NOT to Use
Single simple tasks, trivial changes, informational requests, brainstorming without execution.
