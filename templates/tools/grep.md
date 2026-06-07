## Grep

Searches file contents within the project workspace using a regex pattern.

Usage:
- Prefer Grep over `grep -r` via Bash when you need to search file contents by text or regex across the workspace; it is much faster and respects `.gitignore`.
- The `pattern` is a JavaScript regex applied per line.
- Optional `path` narrows the search to a specific file or subdirectory (defaults to the project root).
- Optional `glob` filters files by pattern (e.g., `*.ts`, `src/**/*.tsx`) before searching.
- Results are automatically filtered through `.gitignore` rules and common directories like `node_modules`, `.git`, and `dist`.
- Returns a JSON object with `pattern`, `matches` (array of `{file, line, column, match, line_content}` objects), `truncated` (boolean), and `files_searched` (number).
- Files larger than 1 MB are skipped. Binary files are skipped.
- Maximum 500 matches returned.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pattern": {
      "description": "Regex pattern to search for in file contents (e.g., 'TODO', 'import.*from', 'function\\s+\\w+')",
      "type": "string"
    },
    "path": {
      "description": "Optional file or directory path relative to project root to search within (default: entire project)",
      "type": "string"
    },
    "glob": {
      "description": "Optional glob pattern to filter which files to search (e.g., '*.ts', 'src/**/*.tsx')",
      "type": "string"
    }
  },
  "required": [
    "pattern"
  ],
  "additionalProperties": false
}
```
