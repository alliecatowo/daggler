// Builds the static hosted demo into apps/web/out.
//
// The hosted build has no server, so the API routes (which run workflows, dispatch
// to GitHub and call the AI provider) are moved out of the tree for the duration of
// the build and restored afterwards. They can never be reached from the hosted site.
//
//   NEXT_PUBLIC_BASE_PATH  sub-path the site is served from (default /daggler/app)
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const api = join(root, "src", "app", "api");
// Same filesystem as the source tree (rename cannot cross devices).
const stash = join(root, ".api-stash");

const cp = spawnSync("node", [join(root, "scripts", "copy-monaco.mjs")], { stdio: "inherit" });
if (cp.status !== 0) process.exit(cp.status ?? 1);

let moved = false;
if (existsSync(api)) {
  renameSync(api, stash);
  moved = true;
}
let status = 1;
try {
  rmSync(join(root, ".next"), { recursive: true, force: true });
  const r = spawnSync("pnpm", ["exec", "next", "build", "--webpack"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_DAGGLER_HOSTED: "1",
      NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH ?? "/daggler/app",
    },
  });
  status = r.status ?? 1;
} finally {
  if (moved) renameSync(stash, api);
}
process.exit(status);
