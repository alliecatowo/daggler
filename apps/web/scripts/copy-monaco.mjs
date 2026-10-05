// Copies Monaco's prebuilt AMD bundle from node_modules into public/monaco/vs so the
// editor is served from this origin instead of the jsdelivr CDN (privacy, offline use,
// a strict CSP, and the loaded version always matches the installed monaco-editor).
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "monaco-editor", "min", "vs");
const dest = join(root, "public", "monaco", "vs");

if (!existsSync(src)) {
  console.error(`monaco-editor not found at ${src}; run pnpm install`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });

console.log("monaco copied to public/monaco/vs");
