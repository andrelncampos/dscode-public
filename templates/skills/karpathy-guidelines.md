---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---
# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**Internal use:** Apply silently. Do not cite this document in user-facing responses.

## Direction of development

This project will be developed, maintained, and evolved by autonomous AI. Therefore, every technical, architectural, documentary, operational, and organizational decision must be optimized for autonomous AI execution across the entire software lifecycle.

When working on this project, always prioritize clarity, traceability, predictability, automation, testability, objective documentation, and low coupling. The code, architecture, processes, scripts, tests, commit patterns, error messages, configuration files, and documentation must be written in a way that allows an AI agent to understand, modify, validate, maintain, debug, and evolve the system with the lowest possible ambiguity and the least possible dependency on external context.

This directive applies to all phases of the project, including conception, planning, implementation, refactoring, testing, review, build, packaging, distribution, publishing, support, corrective maintenance, evolutionary maintenance, technical auditing, and post-production operation.

Whenever there is a choice between a solution that is more “elegant” but implicit and a solution that is clearer, more explicit, and easier for an AI agent to operate safely, choose the clearer and more explicit solution. The goal is to maximize the autonomy, safety, reliability, and efficiency of AI as the primary development agent for this software.

## 1. Think Before Coding

* State assumptions explicitly. If uncertain, ask.

* If multiple interpretations exist, present them — don't pick silently.

* If a simpler approach exists, say so. Push back when warranted.

* Plan before act.

## 2. Simplicity First (KISS)

* No features beyond what was asked.

* No abstractions for single-use code.

* If 200 lines could be 50, rewrite it.

* DRY allways, except if conflict with KISS.

## 3. Surgical Changes

* Touch only what you must. Don't "improve" adjacent code, comments, or formatting.

* Match existing style even if you'd do it differently.

* Remove only imports/variables your change made unused.

## 4. Goal-Driven Execution

* Define success criteria. Loop until verified.

* For multi-step tasks, state a brief plan with verify steps.
