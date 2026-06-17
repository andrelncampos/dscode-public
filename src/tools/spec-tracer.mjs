#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const command = args[0]; // "--validate" or "--trace"
const specNumber = args[1];

if (!command || !specNumber) {
  console.error("Usage: node spec-tracer.mjs --validate <spec-number>");
  console.error("       node spec-tracer.mjs --trace <spec-number>");
  process.exit(1);
}

const projectRoot = process.cwd();
const specsDir = join(projectRoot, "management", "specs");

let specDir;
try {
  const dirs = readdirSync(specsDir).filter((d) => d.startsWith(`${specNumber}-`));
  if (dirs.length === 0) {
    console.error(`Spec folder management/specs/${specNumber}-<name>/ not found. Run /spec-new ${specNumber} first.`);
    process.exit(1);
  }
  specDir = join(specsDir, dirs[0]);
} catch {
  console.error(`Specs directory not found at ${specsDir}. Run /spec-init first.`);
  process.exit(1);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function readSpecFile(dir, filename) {
  const filePath = join(dir, filename);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8");
}

function getLineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

// ─── validate ─────────────────────────────────────────────────────────────────

if (command === "--validate") {
  const violations = [];

  // Validate requirements.md
  const req = readSpecFile(specDir, "requirements.md");
  if (req) {
    validateRequirements(req, violations);
  } else {
    violations.push({ file: "requirements.md", message: "File not found." });
  }

  // Validate design.md
  const des = readSpecFile(specDir, "design.md");
  if (des) {
    validateDesign(des, violations);
  } else {
    violations.push({ file: "design.md", message: "File not found." });
  }

  // Validate task.md
  const task = readSpecFile(specDir, "task.md");
  if (task) {
    validateTask(task, violations);
  } else {
    violations.push({ file: "task.md", message: "File not found." });
  }

  if (violations.length === 0) {
    console.log("✅ All spec documents structurally valid.");
    process.exit(0);
  } else {
    console.log("## Structural Validation Violations\n");
    violations.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      return (a.line ?? 0) - (b.line ?? 0);
    });
    for (const v of violations) {
      console.log(`- **${v.file}**${v.line ? ` (line ${v.line})` : ""}: ${v.message}`);
    }
    process.exit(1);
  }
}

function validateRequirements(content, violations) {
  // Check YAML frontmatter
  if (!content.startsWith("---")) {
    violations.push({
      file: "requirements.md",
      line: 1,
      message: "Missing YAML frontmatter (expected --- delimited block).",
    });
  } else {
    const end = content.indexOf("---", 3);
    if (end === -1) {
      violations.push({ file: "requirements.md", line: 1, message: "Unclosed YAML frontmatter." });
    } else {
      const fm = content.slice(3, end);
      if (!fm.includes("name:")) {
        violations.push({ file: "requirements.md", line: 1, message: "YAML frontmatter missing 'name' field." });
      }
      if (!fm.includes("status:")) {
        violations.push({ file: "requirements.md", line: 1, message: "YAML frontmatter missing 'status' field." });
      }
    }
  }

  // Check required sections
  const requiredSections = [
    "## Value Delivery",
    "## Functional Requirements",
    "## Non-Functional Requirements",
    "## Constraints",
    "## Edge Cases",
  ];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      violations.push({ file: "requirements.md", message: `Missing required section: '${section}'.` });
    }
  }

  // Check FR naming
  const frRegex = /^###\s+(FR\S+)\s*:/gm;
  let frMatch;
  while ((frMatch = frRegex.exec(content)) !== null) {
    const id = frMatch[1];
    if (!/^FR-\d{3}$/.test(id)) {
      const line = getLineNumber(content, frMatch.index);
      violations.push({
        file: "requirements.md",
        line,
        message: `FR heading '${id}' does not match pattern 'FR-XXX: ...' (expected FR-NNN where NNN is 3 digits).`,
      });
    }
  }
}

function validateDesign(content, violations) {
  const requiredSections = ["## Design Approach", "## Data Flow", "## File / Module Layout"];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      violations.push({ file: "design.md", message: `Missing required section: '${section}'.` });
    }
  }
  // Must have Architecture Decisions OR Component / Module Breakdown
  if (!content.includes("## Architecture Decisions") && !content.includes("## Component / Module Breakdown")) {
    violations.push({
      file: "design.md",
      message: "Missing required section: must have '## Architecture Decisions' or '## Component / Module Breakdown'.",
    });
  }
}

function validateTask(content, violations) {
  if (!content.includes("## Tasks")) {
    violations.push({ file: "task.md", message: "Missing required section: '## Tasks'." });
  }

  // Check task headings
  const taskRegex = /^###\s+(Task\s+\d+)\s*:/gm;
  let taskMatch;
  const seenTasks = new Set();
  while ((taskMatch = taskRegex.exec(content)) !== null) {
    const id = taskMatch[1].replace(/\s+/g, " ");
    if (!/^Task \d+$/.test(id)) {
      const line = getLineNumber(content, taskMatch.index);
      violations.push({ file: "task.md", line, message: `Task heading '${id}' does not match pattern 'Task N: ...'.` });
    }
    seenTasks.add(id);
  }

  // Check that each task has a status line
  if (seenTasks.size > 0) {
    const statusRegex = /\*\*Status:\*\*\s+\[[ x]\]\s+(pending|done)/g;
    const statusCount = [...content.matchAll(statusRegex)].length;
    if (statusCount < seenTasks.size) {
      violations.push({
        file: "task.md",
        message: `Found ${seenTasks.size} tasks but only ${statusCount} status lines. Each task must have '**Status:** [ ] pending' or '**Status:** [x] done'.`,
      });
    }
  }
}

// ─── trace ────────────────────────────────────────────────────────────────────

if (command === "--trace") {
  const req = readSpecFile(specDir, "requirements.md");
  if (!req) {
    console.error("requirements.md not found");
    process.exit(1);
  }

  const frIds = extractFrIds(req);
  if (frIds.length === 0) {
    console.log("No FRs found in requirements.md.");
    process.exit(0);
  }

  const des = readSpecFile(specDir, "design.md");
  const components = extractComponents(des || "");

  const task = readSpecFile(specDir, "task.md");
  const taskMap = extractTaskFrMap(task || "");

  console.log("## Traceability Report\n");
  console.log("| FR | Design Component | Task | Code Reference |");
  console.log("|----|-----------------|------|----------------|");

  let foundCount = 0;
  for (const fr of frIds) {
    const component = findComponentForFr(fr, components, taskMap) || "NOT FOUND";
    const taskRef = taskMap[fr] || "NOT COVERED";
    const codeRef = findCodeReference(fr, projectRoot);
    if (codeRef) foundCount++;
    console.log(`| ${fr} | ${component} | ${taskRef} | ${codeRef || "NOT FOUND"} |`);
  }

  const pct = frIds.length > 0 ? Math.round((foundCount / frIds.length) * 100) : 0;
  console.log(`\n**Coverage: ${foundCount}/${frIds.length} FRs traced to code (${pct}%).**`);
  process.exit(0);
}

function extractFrIds(content) {
  const ids = [];
  const regex = /^###\s+(FR-\d{3})\s*:/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const id = match[1];
    if (!ids.includes(id)) ids.push(id);
  }
  ids.sort();
  return ids;
}

function extractComponents(content) {
  const names = [];
  const regex = /^###\s+Component\b[^:\n]*:\s*(.+)/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    names.push(match[1].trim());
  }
  return names;
}

function extractTaskFrMap(content) {
  const map = {};
  const taskBlocks = content.split(/^###\s+Task\s+\d+/gm).slice(1);
  const taskHeaders = [...content.matchAll(/^###\s+(Task\s+\d+)\s*:/gm)];

  for (let i = 0; i < taskHeaders.length; i++) {
    const taskId = taskHeaders[i][1].replace(/\s+/g, " ");
    const block = taskBlocks[i] || "";
    const coveredMatch = block.match(/\*\*Requirements Covered:\*\*\s*(.+)/);
    if (coveredMatch) {
      const frs = coveredMatch[1].match(/FR-\d{3}/g) || [];
      for (const fr of frs) {
        if (!map[fr]) map[fr] = taskId;
      }
    }
  }
  return map;
}

function findComponentForFr(fr, components, _taskMap) {
  if (components.length > 0) return components[0];
  return null;
}

function findCodeReference(frId, root) {
  try {
    const cmd = `grep -r "${frId}" src/ --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" -l 2>nul`;
    const result = execSync(cmd, { cwd: root, encoding: "utf8", timeout: 5000, windowsHide: true });
    const lines = result.trim().split("\n").filter(Boolean);
    return lines.length > 0 ? lines[0].replace(/\\/g, "/") : null;
  } catch {
    return null;
  }
}
