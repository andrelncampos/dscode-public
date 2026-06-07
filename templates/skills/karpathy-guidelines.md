---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**Internal use:** Apply silently. Do not cite this document in user-facing responses.

## 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

## 2. Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- If 200 lines could be 50, rewrite it.

## 3. Surgical Changes
- Touch only what you must. Don't "improve" adjacent code, comments, or formatting.
- Match existing style even if you'd do it differently.
- Remove only imports/variables your change made unused.

## 4. Goal-Driven Execution
- Define success criteria. Loop until verified.
- For multi-step tasks, state a brief plan with verify steps.
