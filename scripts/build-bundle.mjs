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
const OUT_FILE = resolve(OUT_DIR, "dscode.mjs");

mkdirSync(OUT_DIR, { recursive: true });

console.log(`[bundle] Building ESM bundle for ${name} v${version}...`);

await build({
  entryPoints: [resolve(root, "src", "cli.tsx")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: OUT_FILE,
  jsx: "automatic",
  jsxImportSource: "react",
  // Bundle everything except Node built-ins and tesseract.js (which uses CJS require() in ESM).
  external: ["tesseract.js"],
  banner: {
    js: [`import { createRequire } from "node:module";`, `const require = createRequire(import.meta.url);`].join("\n"),
  },
  define: {
    "process.env.DSCODE_VERSION": JSON.stringify(version),
  },
  logOverride: {
    "empty-import-meta": "silent",
  },
  minify: false,
  keepNames: true,
}).catch((err) => {
  console.error(`[bundle] ERROR: Bundling failed: ${err.message}`);
  process.exit(1);
});

console.log(`[bundle] Done → ${OUT_FILE}`);
