import fs from "node:fs";
import path from "node:path";

const ROADMAP_PATH = path.join("management", "roadmap.md");

let _cache: Map<string, string> | null = null;

function parseSpecNames(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const content = fs.readFileSync(ROADMAP_PATH, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      // Match spec table rows: | NNN | name | status | ...
      const match = line.match(/^\|\s*(\d+[A-Z]?)\s*\|\s*([^|]+?)\s*\|/);
      if (match) {
        map.set(match[1], match[2].trim());
      }
    }
  } catch {
    // File missing or unreadable — cache stays empty.
  }
  return map;
}

export function resolveSpecName(specId: string): string | null {
  if (!_cache) {
    _cache = parseSpecNames();
  }
  return _cache.get(specId) ?? null;
}

// Exposed for testing
export function clearSpecNameCache(): void {
  _cache = null;
}
