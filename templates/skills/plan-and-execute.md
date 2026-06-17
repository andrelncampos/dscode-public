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

## Direction of development

This project will be developed, maintained, and evolved by autonomous AI. Therefore, every technical, architectural, documentary, operational, and organizational decision must be optimized for autonomous AI execution across the entire software lifecycle.

When working on this project, always prioritize clarity, traceability, predictability, automation, testability, objective documentation, and low coupling. The code, architecture, processes, scripts, tests, commit patterns, error messages, configuration files, and documentation must be written in a way that allows an AI agent to understand, modify, validate, maintain, debug, and evolve the system with the lowest possible ambiguity and the least possible dependency on external context.

This directive applies to all phases of the project, including conception, planning, implementation, refactoring, testing, review, build, packaging, distribution, publishing, support, corrective maintenance, evolutionary maintenance, technical auditing, and post-production operation.

Whenever there is a choice between a solution that is more “elegant” but implicit and a solution that is clearer, more explicit, and easier for an AI agent to operate safely, choose the clearer and more explicit solution. The goal is to maximize the autonomy, safety, reliability, and efficiency of AI as the primary development agent for this software.
