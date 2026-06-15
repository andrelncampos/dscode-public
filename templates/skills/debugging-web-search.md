---
name: debugging-web-search
description: Use when diagnosing bugs, build failures, or tool incompatibilities in open source dependencies. Guides WebSearch query formulation to surface GitHub issues, release notes, and official documentation instead of generic SEO results.
license: MIT
---

# Debugging Web Search

Tactical query patterns to extract actionable technical answers from WebSearch, avoiding generic SEO noise.

**Internal use:** Apply silently. Do not cite this document in user-facing responses.

## 1. GitHub Issues First

When diagnosing a bug in an open source tool (postject, esbuild, Node.js, etc.), **always** scope the first query to GitHub:

```
site:github.com <tool-name> "<exact error message>"
```

If the tool lives under a specific org/repo, narrow further:

```
site:github.com/nodejs/<repo> <keywords>
```

**Why it works:** Generic queries return SEO-optimized blog posts. GitHub issues surface real bug reports with exact error messages.

## 2. Exact Error Messages

Copy the **exact error string** from logs, wrapped in double quotes. Do NOT paraphrase.

```
✅ "Can't read and write to target executable"
❌ postject write error
```

Exact matching hits issue titles and stack traces that a paraphrase misses.

## 3. Version-Specific Queries

Always include the major version number. Open source breakage is often version-locked:

```
site:github.com <tool> <version> <symptom>
```

Example: `site:github.com nodejs/postject node 24 "Can't read and write"`

## 4. Commit Log Archaeology

If no issue exists, search commit messages for the relevant source file or error:

```
site:github.com <org/repo> "<source-file>" <version-tag>
```

## 5. Release Notes and Changelogs

After finding a fix or workaround in an issue, verify it landed in a release:

```
site:github.com <org/repo> releases <version>
```

Or fetch directly via WebFetch on `https://github.com/<org>/<repo>/releases`.

## 6. Fallback to Official Documentation

If GitHub returns nothing, escalate to official docs with `site:`:

```
site:nodejs.org <api-name> <version>
site:deepseek.com api pricing
```

## Decision Flow

```
Error in build/CI/dependency?
  ├─ 1. site:github.com <repo> "<exact error>"
  ├─ 2. site:github.com <repo> <version> <keywords>
  ├─ 3. WebFetch → github.com/<repo>/issues?q=<error>
  ├─ 4. site:github.com <repo> commits <file>
  └─ 5. site:<official-docs-domain> <api>
```
