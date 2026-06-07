## Glob

Searches for files matching a glob pattern within the project workspace.

Usage:
- Prefer Glob over `ls` or `find` when you need to locate files by pattern.
- Patterns are matched against paths relative to the project root (e.g., `src/**/*.ts`).
- Results are automatically filtered through `.gitignore` rules and common directories like `node_modules`, `.git`, and `dist`.
- Returns a JSON object with `pattern`, `matches` (array of relative POSIX paths), and `truncated` (boolean — true when results exceed 500).
- If the pattern has no directory component (e.g., `*.test.ts`), it matches in any directory (matchBase behavior).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pattern": {
      "description": "Glob pattern to match (e.g., '**/*.ts', 'src/**/*.tsx', '*.test.ts')",
      "type": "string"
    }
  },
  "required": [
    "pattern"
  ],
  "additionalProperties": false
}
```
