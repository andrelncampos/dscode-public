import chalk from "chalk";

// ── Highlighter registry ────────────────────────────────────────

type Highlighter = (code: string) => string;

const HIGHLIGHTERS: Record<string, Highlighter> = {
  ts: highlightTypeScript,
  tsx: highlightTypeScript,
  js: highlightTypeScript,
  jsx: highlightTypeScript,
  mjs: highlightTypeScript,
  cjs: highlightTypeScript,
  py: highlightPython,
  python: highlightPython,
  rs: highlightRust,
  rust: highlightRust,
  go: highlightGo,
  bash: highlightBash,
  sh: highlightBash,
  shell: highlightBash,
  zsh: highlightBash,
  json: highlightJson,
  yaml: highlightYaml,
  yml: highlightYaml,
  html: highlightHtml,
  xml: highlightHtml,
  svg: highlightHtml,
  css: highlightCss,
  scss: highlightCss,
  less: highlightCss,
  sql: highlightSql,
  md: highlightMarkdown,
  markdown: highlightMarkdown,
  diff: highlightDiff,
  patch: highlightDiff,
};

export function highlightCode(code: string, lang: string): string {
  if (!code) return code;
  const normalized = lang.toLowerCase().trim();
  const highlighter = HIGHLIGHTERS[normalized];
  if (!highlighter) return chalk.cyan(code);

  try {
    return highlighter(code);
  } catch {
    return chalk.cyan(code);
  }
}

// ── TypeScript / JavaScript ──────────────────────────────────────

function highlightTypeScript(code: string): string {
  // 1. Strings (single, double, backtick) — must come first
  code = code.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/gs, (m) => chalk.green(m));

  // 2. Block comments
  code = code.replace(/\/\*[\s\S]*?\*\//g, (m) => chalk.dim.gray(m));

  // 3. Line comments
  code = code.replace(/\/\/[^\n]*/g, (m) => chalk.dim.gray(m));

  // 4. Numbers
  code = code.replace(/\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, (m) => chalk.yellow(m));

  // 5. Keywords
  code = code.replace(
    /\b(?:import|export|default|from|const|let|var|function|class|interface|type|enum|extends|implements|abstract|private|protected|public|readonly|static|async|await|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|delete|typeof|instanceof|in|of|void|never|unknown|any|boolean|number|string|symbol|undefined|null|true|false|yield|as|get|set|declare|module|namespace|require|constructor|super|this|keyof|is|asserts|infer)\b/g,
    (m) => chalk.magenta(m)
  );

  // 6. Function calls (identifier immediately before paren)
  code = code.replace(/\b([a-zA-Z_$][\w$]*)\s*(?=\()/g, (_, name) => chalk.cyan(name));

  // 7. Type annotations (capitalised identifiers after `:` or `<`)
  code = code.replace(/([:<]\s*)([A-Z][\w$]*)/g, (_, prefix, type) => prefix + chalk.blue(type));

  return code;
}

// ── Python ───────────────────────────────────────────────────────

function highlightPython(code: string): string {
  // 1. f-strings (before regular strings to capture the `f` prefix)
  code = code.replace(/f(["'])(?:(?!\1|\\).|\\.)*\1/g, (m) => chalk.green(m));

  // 2. Regular strings
  code = code.replace(/(["'])(?:(?!\1|\\).|\\.)*\1/g, (m) => chalk.green(m));

  // 3. Comments
  code = code.replace(/#[^\n]*/g, (m) => chalk.dim.gray(m));

  // 4. Numbers
  code = code.replace(/\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, (m) => chalk.yellow(m));

  // 5. Keywords
  code = code.replace(
    /\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g,
    (m) => chalk.magenta(m)
  );

  // 6. Decorators
  code = code.replace(/@\w+/g, (m) => chalk.cyan(m));

  // 7. Function calls
  code = code.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, (_, name) => chalk.blue(name));

  return code;
}

// ── Rust ─────────────────────────────────────────────────────────

function highlightRust(code: string): string {
  code = code.replace(/(["'])(?:(?!\1|\\).|\\.)*\1/gs, (m) => chalk.green(m));

  code = code.replace(/\/\*[\s\S]*?\*\//g, (m) => chalk.dim.gray(m));
  code = code.replace(/\/\/[^\n]*/g, (m) => chalk.dim.gray(m));

  code = code.replace(/\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, (m) => chalk.yellow(m));

  code = code.replace(
    /\b(?:as|break|const|continue|crate|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while|async|await|dyn)\b/g,
    (m) => chalk.magenta(m)
  );

  // Macros
  code = code.replace(/\b\w+!/g, (m) => chalk.cyan(m));

  // Lifetimes
  code = code.replace(/'\w+/g, (m) => chalk.blue(m));

  return code;
}

// ── Go ───────────────────────────────────────────────────────────

function highlightGo(code: string): string {
  code = code.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/gs, (m) => chalk.green(m));

  code = code.replace(/\/\*[\s\S]*?\*\//g, (m) => chalk.dim.gray(m));
  code = code.replace(/\/\/[^\n]*/g, (m) => chalk.dim.gray(m));

  code = code.replace(/\b\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, (m) => chalk.yellow(m));

  code = code.replace(
    /\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|bool|byte|complex64|complex128|error|float32|float64|int|int8|int16|int32|int64|rune|string|uint|uint8|uint16|uint32|uint64|uintptr|true|false|iota|nil)\b/g,
    (m) => chalk.magenta(m)
  );

  // Capitalised identifiers (types)
  code = code.replace(/\b([A-Z][\w]*)\b/g, (m) => chalk.blue(m));

  return code;
}

// ── Bash / Shell ─────────────────────────────────────────────────

function highlightBash(code: string): string {
  code = code.replace(/(["'])(?:(?!\1|\\).|\\.)*\1/gs, (m) => chalk.green(m));

  code = code.replace(/#[^\n]*/g, (m) => chalk.dim.gray(m));

  // Variables
  code = code.replace(/\$\{?\w+\}?/g, (m) => chalk.yellow(m));

  // Common commands
  code = code.replace(
    /\b(?:echo|cd|ls|cat|grep|sed|awk|curl|wget|git|npm|yarn|pnpm|node|python|pip|docker|kubectl|ssh|scp|rsync|tar|gzip|unzip|chmod|chown|sudo|apt|brew|yum|dnf|systemctl|journalctl|ps|kill|top|htop|df|du|find|mkdir|rm|cp|mv|touch|ln|export|source|exit|return|if|then|else|elif|fi|for|while|do|done|case|esac|function|local|readonly|declare|unset|shift|trap|set|eval|exec)\b/g,
    (m) => chalk.blue(m)
  );

  return code;
}

// ── JSON ─────────────────────────────────────────────────────────

function highlightJson(code: string): string {
  // Strings (keys and values)
  code = code.replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, (m) => chalk.green(m));

  // Numbers
  code = code.replace(/\b-?\d+\.?\d*(?:[eE][+-]?\d+)?\b/g, (m) => chalk.yellow(m));

  // true / false / null
  code = code.replace(/\b(?:true|false|null)\b/g, (m) => chalk.magenta(m));

  return code;
}

// ── YAML ─────────────────────────────────────────────────────────

function highlightYaml(code: string): string {
  // Comments
  code = code.replace(/#[^\n]*/g, (m) => chalk.dim.gray(m));

  // Keys (identifiers at line start before colon)
  code = code.replace(/^(\s*)([\w.-]+)(\s*:)/gm, (_, indent, key, colon) => indent + chalk.blue(key) + colon);

  // Values after colon
  code = code.replace(/:\s*([^\n#]+)/g, (_, val) => ": " + chalk.green(val.trim()));

  // Numbers
  code = code.replace(/\b\d+\.?\d*\b/g, (m) => chalk.yellow(m));

  // Booleans / null
  code = code.replace(/\b(?:true|false|null|yes|no|on|off)\b/gi, (m) => chalk.magenta(m));

  return code;
}

// ── HTML / XML ───────────────────────────────────────────────────

function highlightHtml(code: string): string {
  // Comments
  code = code.replace(/<!--[\s\S]*?-->/g, (m) => chalk.dim.gray(m));

  // Tags and attributes
  code = code.replace(/(<\/?)([\w-]+)([^>]*>)/g, (_, open, tag, rest) => open + chalk.magenta(tag) + chalk.green(rest));

  // Attribute names
  code = code.replace(/\s([\w-]+)=/g, (_, attr) => " " + chalk.blue(attr) + "=");

  // Attribute values
  code = code.replace(/"[^"]*"/g, (m) => chalk.green(m));

  return code;
}

// ── CSS ──────────────────────────────────────────────────────────

function highlightCss(code: string): string {
  code = code.replace(/\/\*[\s\S]*?\*\//g, (m) => chalk.dim.gray(m));

  // Selectors
  code = code.replace(/([.#@]?[\w-]+)(?=\s*\{)/g, (m) => chalk.blue(m));

  // Property names
  code = code.replace(/([\w-]+)(?=\s*:)/g, (m) => chalk.cyan(m));

  // Numbers with units
  code = code.replace(/\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|ch|fr)\b/g, (m) => chalk.yellow(m));

  // Hex colours
  code = code.replace(/#[0-9a-fA-F]{3,8}\b/g, (m) => chalk.green(m));

  // Strings
  code = code.replace(/"[^"]*"/g, (m) => chalk.green(m));

  // !important
  code = code.replace(/!important\b/g, (m) => chalk.magenta(m));

  return code;
}

// ── SQL ──────────────────────────────────────────────────────────

function highlightSql(code: string): string {
  code = code.replace(/'[^']*'/g, (m) => chalk.green(m));

  code = code.replace(/\/\*[\s\S]*?\*\//g, (m) => chalk.dim.gray(m));
  code = code.replace(/--[^\n]*/g, (m) => chalk.dim.gray(m));

  code = code.replace(/\b\d+\.?\d*\b/g, (m) => chalk.yellow(m));

  code = code.replace(
    /\b(?:SELECT|FROM|WHERE|AND|OR|NOT|IN|LIKE|BETWEEN|JOIN|LEFT|RIGHT|OUTER|INNER|CROSS|ON|AS|GROUP|BY|ORDER|ASC|DESC|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|ADD|DROP|INDEX|VIEW|IF|EXISTS|PRIMARY|KEY|FOREIGN|REFERENCES|NULL|DEFAULT|UNIQUE|CHECK|COUNT|SUM|AVG|MIN|MAX|COALESCE|CAST|CASE|WHEN|THEN|ELSE|END|UNION|ALL|DISTINCT|TOP|OFFSET|FETCH|NEXT|ROWS|ONLY)\b/gi,
    (m) => chalk.magenta(m)
  );

  // Function calls
  code = code.replace(/\b([A-Z][A-Z_]*)\s*(?=\()/g, (_, name) => chalk.blue(name));

  return code;
}

// ── Markdown ─────────────────────────────────────────────────────

function highlightMarkdown(code: string): string {
  // Headings
  code = code.replace(/^(#{1,6}\s)(.+)$/gm, (_, hash, text) => chalk.magenta(hash) + chalk.bold(text));

  // Bold
  code = code.replace(/\*\*([^*]+)\*\*/g, (_, text) => chalk.bold(text));

  // Italic
  code = code.replace(/\*([^*]+)\*/g, (_, text) => chalk.italic(text));

  // Links
  code = code.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => chalk.blue(text) + chalk.dim("(" + url + ")"));

  // Inline code
  code = code.replace(/`([^`]+)`/g, (_, text) => chalk.cyan(text));

  return code;
}

// ── Diff ─────────────────────────────────────────────────────────

function highlightDiff(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      if (line.startsWith("+")) return chalk.green(line);
      if (line.startsWith("-")) return chalk.red(line);
      if (line.startsWith("@@")) return chalk.cyan(line);
      if (line.startsWith("diff") || line.startsWith("---") || line.startsWith("+++")) return chalk.bold(line);
      return line;
    })
    .join("\n");
}
