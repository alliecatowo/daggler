/* ============================================================================
 * daggler logs — apps/cli/src/logs.ts
 *
 * Fetch a GitHub Actions run, parse its failure, and map it back to the
 * workflow source with a beautiful terminal report.
 *
 * Usage:
 *   daggler logs <run-id> [--repo owner/repo] [--workflow <file>]
 *
 * Exit codes:
 *   0   run succeeded (or we printed the success banner)
 *   1   run failed (report printed)
 *   2   infrastructure unavailable (gh missing / not authed)
 *   3   usage error
 * ============================================================================ */

import { spawnSync, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { parseWorkflow, SourceMap } from "@daggler/workflow-ir";
import { parseRunFailure, mapFailureToSource } from "@daggler/runner";
import { GhCliAdapter } from "@daggler/github";

// ---------------------------------------------------------------------------
// Color / style helpers (self-contained; not shared with cli.ts at runtime)
// ---------------------------------------------------------------------------

let colorEnabled = true;

function paint<T extends string>(fn: (s: T) => string, s: T): string {
  return colorEnabled ? fn(s) : s;
}

function bold(s: string): string {
  return paint(pc.bold as (s: string) => string, s);
}

function dim(s: string): string {
  return paint(pc.dim as (s: string) => string, s);
}

const RULE_WIDTH = 72;

function rule(char = "─"): string {
  return dim(char.repeat(RULE_WIDTH));
}

// ---------------------------------------------------------------------------
// Git / repo helpers
// ---------------------------------------------------------------------------

function gitOutput(...args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8_000,
    }).trim();
  } catch {
    return null;
  }
}

function inferRepo(): string | null {
  const remote = gitOutput("remote", "get-url", "origin");
  if (!remote) return null;

  // SSH: git@github.com:owner/repo.git
  const sshMatch = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1]) return sshMatch[1];

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remote.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch?.[1]) return httpsMatch[1];

  return null;
}

// ---------------------------------------------------------------------------
// gh helpers
// ---------------------------------------------------------------------------

function ghAvailable(): boolean {
  const result = spawnSync("gh", ["auth", "status"], {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "ignore", "ignore"],
  });
  return (result.status ?? 1) === 0;
}

interface RunMeta {
  status: string;
  conclusion: string | null;
  headBranch: string;
  workflowName: string;
  jobs: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    steps: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      number: number;
    }>;
  }>;
}

function fetchRunMeta(runId: string, repo: string): RunMeta | null {
  const result = spawnSync(
    "gh",
    [
      "run", "view", runId,
      "--repo", repo,
      "--json", "status,conclusion,headBranch,workflowName,jobs",
    ],
    { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  if ((result.status ?? 1) !== 0) return null;
  try {
    return JSON.parse(result.stdout) as RunMeta;
  } catch {
    return null;
  }
}

function fetchLogText(runId: string, repo: string): string {
  // Try --log-failed first; fall back to --log
  const failedResult = spawnSync(
    "gh",
    ["run", "view", runId, "--repo", repo, "--log-failed"],
    { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  if ((failedResult.status ?? 1) === 0 && failedResult.stdout.trim()) {
    return failedResult.stdout;
  }

  const allResult = spawnSync(
    "gh",
    ["run", "view", runId, "--repo", repo, "--log"],
    { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  return allResult.stdout ?? "";
}

// ---------------------------------------------------------------------------
// Workflow file resolution
// ---------------------------------------------------------------------------

/**
 * Derive candidate local file paths from a workflowName (from the GitHub API).
 * The API returns the display name (e.g. "CI"), not the filename.
 * We try the .github/workflows directory to find matching files.
 */
function guessLocalWorkflowFile(workflowName: string): string | null {
  const dir = path.resolve(".github", "workflows");
  if (!fs.existsSync(dir)) return null;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) continue;
    // Match by filename stem or full name against workflowName
    const stem = entry.name.replace(/\.(ya?ml)$/, "");
    if (
      stem.toLowerCase() === workflowName.toLowerCase() ||
      entry.name.toLowerCase() === workflowName.toLowerCase()
    ) {
      return path.join(dir, entry.name);
    }
  }

  // Looser: workflowName contains the stem or vice-versa
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) continue;
    const stem = entry.name.replace(/\.(ya?ml)$/, "").toLowerCase();
    const nameLower = workflowName.toLowerCase();
    if (stem.includes(nameLower) || nameLower.includes(stem)) {
      return path.join(dir, entry.name);
    }
  }

  return null;
}

/**
 * Try to read the workflow YAML: first from local disk, then via gh API.
 * Returns { yaml, filePath } or null.
 */
async function resolveWorkflowYaml(
  workflowFlag: string | undefined,
  workflowName: string,
  repo: string,
): Promise<{ yaml: string; filePath: string } | null> {
  // 1. Explicit --workflow flag
  if (workflowFlag) {
    const abs = path.resolve(workflowFlag);
    if (fs.existsSync(abs)) {
      return { yaml: fs.readFileSync(abs, "utf-8"), filePath: workflowFlag };
    }
    // Maybe it's a repo-relative path without a local checkout — try remote
    const [owner, repoName] = repo.split("/");
    if (owner && repoName) {
      try {
        const adapter = new GhCliAdapter();
        const blob = await adapter.getFile({ owner, repo: repoName }, workflowFlag);
        return { yaml: blob.content, filePath: workflowFlag };
      } catch {
        // fall through
      }
    }
    return null;
  }

  // 2. Infer from local .github/workflows
  const local = guessLocalWorkflowFile(workflowName);
  if (local) {
    return { yaml: fs.readFileSync(local, "utf-8"), filePath: local };
  }

  // 3. Fetch from GitHub via GhCliAdapter
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) return null;

  const adapter = new GhCliAdapter();
  // List remote workflow files and pick one whose name matches
  try {
    const files = await adapter.listWorkflowFiles({ owner, repo: repoName });
    let match = files.find((f) => {
      const base = f.split("/").pop() ?? "";
      const stem = base.replace(/\.(ya?ml)$/, "").toLowerCase();
      return (
        stem === workflowName.toLowerCase() ||
        base.toLowerCase() === workflowName.toLowerCase() ||
        stem.includes(workflowName.toLowerCase()) ||
        workflowName.toLowerCase().includes(stem)
      );
    });
    if (!match && files.length === 1) match = files[0];

    if (match) {
      const blob = await adapter.getFile({ owner, repo: repoName }, match);
      return { yaml: blob.content, filePath: match };
    }
  } catch {
    // gh not available or API error — skip gracefully
  }

  return null;
}

// ---------------------------------------------------------------------------
// Conclusion coloring
// ---------------------------------------------------------------------------

function colorConclusion(conclusion: string | null, status: string): string {
  const effective = conclusion ?? status;
  if (effective === "success") return paint(pc.green, effective);
  if (effective === "failure" || effective === "timed_out") return paint(pc.red, effective);
  if (effective === "cancelled") return paint(pc.yellow, effective);
  if (effective === "in_progress" || effective === "queued") return paint(pc.yellow, effective);
  return paint(pc.dim as (s: string) => string, effective);
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function printHeader(
  runId: string,
  repo: string,
  meta: RunMeta,
): void {
  process.stdout.write(rule("═") + "\n");
  process.stdout.write(
    `  ${bold("daggler logs")}  ${dim("·")}  ${dim(repo)}  ${dim("#" + runId)}\n`,
  );
  process.stdout.write("\n");
  process.stdout.write(
    `  ${bold("Workflow")}   ${meta.workflowName}\n` +
      `  ${bold("Branch")}     ${meta.headBranch}\n` +
      `  ${bold("Status")}     ${colorConclusion(meta.conclusion, meta.status)}\n`,
  );
  process.stdout.write("\n");
}

function printSuccessBanner(runId: string, repo: string, meta: RunMeta): void {
  printHeader(runId, repo, meta);
  process.stdout.write(
    `  ${paint(pc.green, "✓")}  Run ${paint(pc.green, "#" + runId)} completed ${paint(pc.green, "successfully")}.\n`,
  );
  process.stdout.write(
    `  ${dim("https://github.com/" + repo + "/actions/runs/" + runId)}\n`,
  );
  process.stdout.write(rule("═") + "\n");
}

function printJobsSection(meta: RunMeta): void {
  const failedJobs = meta.jobs.filter(
    (j) => j.conclusion === "failure" || j.conclusion === "timed_out",
  );
  if (failedJobs.length === 0) return;

  process.stdout.write(`  ${bold("Failed jobs")}\n`);
  for (const job of failedJobs) {
    process.stdout.write(`    ${paint(pc.red, "●")}  ${bold(job.name)}\n`);
    const failedSteps = job.steps.filter(
      (s) => s.conclusion === "failure" || s.conclusion === "timed_out",
    );
    for (const step of failedSteps) {
      process.stdout.write(
        `       ${dim("└─ step " + step.number + ":")} ${step.name}\n`,
      );
    }
  }
  process.stdout.write("\n");
}

function printErrorLines(errorLines: string[], annotations: string[]): void {
  const all = [...errorLines, ...annotations].slice(0, 8);
  if (all.length === 0) return;

  process.stdout.write(`  ${bold("Errors")}\n`);
  for (const line of all) {
    process.stdout.write(
      `    ${paint(pc.red, "●")}  ${line}\n`,
    );
  }
  if (errorLines.length + annotations.length > 8) {
    process.stdout.write(
      `    ${dim("… +" + (errorLines.length + annotations.length - 8) + " more error lines")}\n`,
    );
  }
  process.stdout.write("\n");
}

function printSourceMapping(
  location: import("@daggler/runner").FailureLocation,
  filePath: string,
): void {
  if (location.span) {
    const line = location.span.start.line;
    const col = location.span.start.col;
    process.stdout.write(
      `  ${bold("Source")}  ${paint(pc.cyan, "→")}  ${paint(pc.white as (s: string) => string, filePath)}${dim(":" + line + ":" + col)}\n`,
    );
  } else {
    process.stdout.write(
      `  ${bold("Source")}  ${paint(pc.cyan, "→")}  ${paint(pc.white as (s: string) => string, filePath)}  ${dim("(no line span resolved)")}\n`,
    );
  }

  if (location.jobPath) {
    process.stdout.write(
      `  ${bold("Job")}     ${dim(location.jobPath)}\n`,
    );
  }
  if (location.stepPath) {
    process.stdout.write(
      `  ${bold("Step")}    ${dim(location.stepPath)}\n`,
    );
  }
  process.stdout.write("\n");
  process.stdout.write(`  ${dim(location.summary)}\n`);
}

// ---------------------------------------------------------------------------
// runLogs — public entry point
// ---------------------------------------------------------------------------

export async function runLogs(args: string[]): Promise<number> {
  // ---------- Parse flags ----------------------------------------------------

  const flagNoColor = args.includes("--no-color");
  if (flagNoColor) colorEnabled = false;

  let repoFlag: string | undefined;
  let workflowFlag: string | undefined;

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--repo" && i + 1 < args.length) {
      repoFlag = args[++i];
    } else if (a === "--workflow" && i + 1 < args.length) {
      workflowFlag = args[++i];
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }

  const runId = positional[0];

  if (!runId) {
    process.stderr.write(
      `  ${paint(pc.red, "error")}  No run ID specified.\n` +
        `  Usage: ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "logs")} ${dim("<run-id>")} ${dim("[--repo owner/repo] [--workflow <file>]")}\n`,
    );
    return 3;
  }

  // ---------- Check gh availability -----------------------------------------

  if (!ghAvailable()) {
    process.stderr.write(
      `  ${paint(pc.red, "error")}  gh CLI is not available or not authenticated.\n` +
        `  ${dim("Install gh and run:")} ${paint(pc.cyan, "gh auth login")}\n`,
    );
    return 2;
  }

  // ---------- Resolve repo ---------------------------------------------------

  const repo = repoFlag ?? inferRepo();
  if (!repo) {
    process.stderr.write(
      `  ${paint(pc.red, "error")}  Cannot infer repo from git remote.\n` +
        `  ${dim("Pass")} ${paint(pc.yellow, "--repo owner/repo")} ${dim("explicitly.")}\n`,
    );
    return 3;
  }

  // ---------- Fetch run metadata --------------------------------------------

  process.stdout.write(
    `  ${dim("Fetching run")} ${paint(pc.cyan, "#" + runId)} ${dim("from")} ${dim(repo)} ${dim("…")}\n`,
  );

  const meta = fetchRunMeta(runId, repo);
  if (!meta) {
    process.stderr.write(
      `  ${paint(pc.red, "error")}  Could not fetch run #${runId} from ${repo}.\n` +
        `  ${dim("Check the run ID and repository, or try:")} ${paint(pc.cyan, "gh run view " + runId + " --repo " + repo)}\n`,
    );
    return 1;
  }

  // ---------- Success path ---------------------------------------------------

  const effectiveConclusion = meta.conclusion ?? meta.status;
  if (effectiveConclusion === "success") {
    printSuccessBanner(runId, repo, meta);
    return 0;
  }

  // ---------- Failure path ---------------------------------------------------

  // Fetch log text
  process.stdout.write(
    `  ${dim("Fetching logs")} ${dim("…")}\n\n`,
  );
  const logText = fetchLogText(runId, repo);

  // Parse the failure
  const failure = parseRunFailure(logText);

  // Print run header
  printHeader(runId, repo, meta);

  // Print failed jobs section from metadata
  printJobsSection(meta);

  // Print error lines
  printErrorLines(failure.errorLines, failure.annotations);

  // ---------- Source mapping ------------------------------------------------

  process.stdout.write(`  ${bold("Source mapping")}\n`);
  process.stdout.write(
    `  ${dim("Resolving workflow file")} ${dim("…")}\n`,
  );

  const resolved = await resolveWorkflowYaml(
    workflowFlag,
    meta.workflowName,
    repo,
  );

  if (!resolved) {
    process.stdout.write(
      `  ${paint(pc.yellow, "warn")}  Could not locate workflow file locally or via gh.\n` +
        `  ${dim("Pass")} ${paint(pc.yellow, "--workflow .github/workflows/<file>.yml")} ${dim("to enable source mapping.")}\n`,
    );
  } else {
    let parseResult: ReturnType<typeof parseWorkflow>;
    try {
      parseResult = parseWorkflow(resolved.yaml, { path: resolved.filePath });
    } catch {
      process.stdout.write(
        `  ${paint(pc.yellow, "warn")}  Could not parse workflow YAML from ${resolved.filePath}.\n`,
      );
      process.stdout.write(rule("═") + "\n");
      process.stdout.write(
        `  ${dim("https://github.com/" + repo + "/actions/runs/" + runId)}\n`,
      );
      return 1;
    }

    const sourceMap = new SourceMap(parseResult.sourceMap);
    const location = mapFailureToSource(failure, parseResult.ir, sourceMap);

    process.stdout.write("\n");
    printSourceMapping(location, resolved.filePath);
  }

  // ---------- Footer --------------------------------------------------------

  process.stdout.write("\n");
  process.stdout.write(rule("═") + "\n");
  process.stdout.write(
    `  ${dim("https://github.com/" + repo + "/actions/runs/" + runId)}\n`,
  );
  process.stdout.write(rule("═") + "\n");

  return 1;
}
