/* ============================================================================
 * daggler map — the repository automation map.
 *
 *   daggler map [target] [--json]
 *
 * target is a local directory (default ".") whose .github/workflows are scanned,
 * OR an "owner/repo" slug fetched live over the gh CLI. Renders the whole CI
 * surface: per-workflow triggers, jobs, third-party actions + trust, unpinned
 * count, secrets referenced, and a security grade; then a repo-level rollup.
 * ============================================================================ */

import {
  buildRepoAutomationMap,
  type RepoAutomationMap,
  type WorkflowSummary,
} from "@daggler/inventory";
import { GhCliAdapter, type RepoRef } from "@daggler/github";
import pc from "picocolors";
import * as fs from "node:fs";
import * as path from "node:path";

// ---- tiny self-contained styling (cli.ts runs main() on import, so we don't
// import its helpers) -------------------------------------------------------
let color = true;
const P = (fn: (s: string) => string, s: string) => (color ? fn(s) : s);
const dim = (s: string) => P(pc.dim as (s: string) => string, s);
const bold = (s: string) => P(pc.bold as (s: string) => string, s);
const rule = (c = "─") => dim(c.repeat(74));
function grade(g: string): string {
  if (g === "A" || g === "B") return P(pc.green, g);
  if (g === "C") return P(pc.yellow, g);
  return P(pc.red, g);
}
function trustBadge(t: string): string {
  if (t === "high") return P(pc.green, "● high");
  if (t === "medium") return P(pc.yellow, "● medium");
  return P(pc.red, "● low");
}

const SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function collectLocal(dir: string): Array<{ path: string; yaml: string }> {
  const ghDir = path.join(dir, ".github", "workflows");
  const scan = fs.existsSync(ghDir) ? ghDir : dir;
  const out: Array<{ path: string; yaml: string }> = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(scan, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.endsWith(".yml") && !e.name.endsWith(".yaml")) continue;
    const full = path.join(scan, e.name);
    try {
      out.push({ path: path.relative(dir, full), yaml: fs.readFileSync(full, "utf-8") });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectRemote(
  slug: string,
): Promise<{ files: Array<{ path: string; yaml: string }>; repo: RepoRef } | null> {
  if (!(await GhCliAdapter.isAvailable())) {
    process.stderr.write(
      `  ${P(pc.yellow, "note")}  ${dim("gh is not installed or not authenticated — cannot read a remote repo.")}\n` +
        `  ${dim("Install GitHub CLI and run")} ${P(pc.cyan, "gh auth login")}${dim(", or point map at a local directory.")}\n`,
    );
    return null;
  }
  const [owner, repo] = slug.split("/");
  const ref: RepoRef = { owner: owner!, repo: repo! };
  const adapter = new GhCliAdapter();
  const paths = await adapter.listWorkflowFiles(ref);
  const files: Array<{ path: string; yaml: string }> = [];
  for (const p of paths) {
    try {
      const blob = await adapter.getFile(ref, p);
      files.push({ path: p, yaml: blob.content });
    } catch {
      /* skip files we can't read */
    }
  }
  return { files, repo: ref };
}

function printWorkflow(w: WorkflowSummary): void {
  process.stdout.write(rule() + "\n");
  process.stdout.write(
    `  ${bold(P(pc.white as (s: string) => string, w.name ?? w.path))}  ${dim(w.path)}  ${dim("·")}  ${grade(w.security.grade)} ${dim(String(w.security.score) + "/100")}\n`,
  );
  const trig = w.triggers.length ? w.triggers.join(", ") : "(none)";
  process.stdout.write(`    ${dim("triggers")}  ${trig}\n`);
  if (w.schedules.length) {
    process.stdout.write(`    ${dim("schedule")}  ${w.schedules.join("  ")}\n`);
  }
  process.stdout.write(
    `    ${dim("graph")}     ${w.jobCount} ${dim("jobs")}  ${dim("·")}  ${w.stepCount} ${dim("steps")}  ${dim("·")}  complexity ${w.complexity}\n`,
  );
  if (w.thirdPartyActions.length) {
    process.stdout.write(`    ${dim("third-party actions")}\n`);
    for (const a of w.thirdPartyActions) {
      const warn =
        a.refKind === "tag" || a.refKind === "branch" ? P(pc.red, " !unpinned") : "";
      process.stdout.write(
        `      ${trustBadge(a.trust)}  ${P(pc.cyan, a.uses)}${warn}\n`,
      );
    }
  }
  if (w.secretsReferenced.length) {
    process.stdout.write(
      `    ${dim("secrets")}   ${w.secretsReferenced.map((s) => P(pc.magenta, s)).join("  ")}\n`,
    );
  }
  process.stdout.write("\n");
}

function printTotals(map: RepoAutomationMap): void {
  const t = map.totals;
  process.stdout.write(rule("═") + "\n");
  process.stdout.write(`  ${bold("Repository automation")}\n`);
  process.stdout.write(
    `    ${bold(String(t.workflows))} ${dim("workflows")}  ${dim("·")}  ` +
      `${bold(String(t.jobs))} ${dim("jobs")}  ${dim("·")}  ` +
      `${bold(String(t.uniqueActions))} ${dim("unique actions")}  ${dim("·")}  ` +
      `${t.unpinnedActions > 0 ? P(pc.red, String(t.unpinnedActions)) : P(pc.green, "0")} ${dim("unpinned")}\n`,
  );
  process.stdout.write(
    `    ${dim("security")}  worst ${grade(t.worstGrade)}  ${dim("·")}  best ${grade(t.bestGrade)}  ${dim("·")}  ` +
      `${t.errors > 0 ? P(pc.red, String(t.errors)) : dim("0")} ${dim("errors")}  ${dim("·")}  CI complexity ${t.ciComplexity}\n`,
  );
  if (t.secretsUsed.length) {
    process.stdout.write(
      `    ${dim("secrets used")}  ${t.secretsUsed.map((s) => P(pc.magenta, s)).join("  ")}\n`,
    );
  }
  if (map.actionUsage.length) {
    process.stdout.write(`\n  ${bold("Action usage")}\n`);
    for (const a of [...map.actionUsage].sort((x, y) => y.count - x.count).slice(0, 12)) {
      const pin = a.pinned ? P(pc.green, "pinned") : P(pc.red, "unpinned");
      process.stdout.write(
        `    ${dim("×" + a.count)}  ${P(pc.cyan, a.uses)}  ${trustBadge(a.trust)}  ${pin}\n`,
      );
    }
  }
  process.stdout.write(rule("═") + "\n");
}

export async function runMap(args: string[]): Promise<number> {
  const json = args.includes("--json");
  if (args.includes("--no-color")) color = false;
  const target = args.find((a) => !a.startsWith("--")) ?? ".";

  const isRemote = SLUG_RE.test(target) && !fs.existsSync(target);

  let files: Array<{ path: string; yaml: string }>;
  let label: string;
  if (isRemote) {
    const res = await collectRemote(target);
    if (!res) return 1;
    files = res.files;
    label = `${res.repo.owner}/${res.repo.repo} ${dim("(via gh)")}`;
  } else {
    files = collectLocal(path.resolve(target));
    label = path.resolve(target) === process.cwd() ? "this repository" : target;
  }

  if (files.length === 0) {
    process.stderr.write(`  ${P(pc.yellow, "warn")}  No workflow files found for ${bold(target)}.\n`);
    return 0;
  }

  const map = buildRepoAutomationMap(files);

  if (json) {
    process.stdout.write(JSON.stringify(map, null, 2) + "\n");
    return map.totals.errors > 0 ? 1 : 0;
  }

  process.stdout.write("\n");
  process.stdout.write(`  ${bold(P(pc.green, "DAG") + P(pc.white as (s: string) => string, "gler"))}  ${dim("automation map ·")} ${label}\n\n`);
  for (const w of map.workflows) printWorkflow(w);
  printTotals(map);
  process.stdout.write("\n");

  return map.totals.errors > 0 ? 1 : 0;
}
