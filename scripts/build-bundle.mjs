import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = (() => {
  const tag = process.env.GITHUB_REF_NAME;
  if (tag && tag.startsWith("v")) return tag.slice(1);
  return pkg.version;
})();
const name = pkg.name;

const OUT_DIR = resolve(root, "release", "bundle");
const OUT_FILE = resolve(OUT_DIR, "dscode.cjs");

mkdirSync(OUT_DIR, { recursive: true });

console.log(`[bundle] Building ESM bundle for ${name} v${version}...`);

await build({
  entryPoints: [resolve(root, "src", "cli.tsx")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: OUT_FILE,
  jsx: "automatic",
  jsxImportSource: "react",
  // For SEA compatibility, bundle everything. If this fails with CJS
  // top-level-await errors, the build-sea script will fall back to
  // the launcher approach using dist/cli.js (which uses external packages).
  external: [],
  define: {
    "process.env.DSCODE_VERSION": JSON.stringify(version),
  },
  logOverride: {
    "empty-import-meta": "silent",
  },
  minify: false,
  keepNames: true,
}).catch((err) => {
  console.warn(`[bundle] Bundling failed (${err.message}). The SEA step will use dist/cli.js as fallback.`);
  // Don't exit — let build:sea decide what to do
});

console.log(`[bundle] Done → ${OUT_FILE}`);
