/* ============================================================================
 * daggler run — apps/cli/src/run.ts
 *
 * Execute a workflow against a rung of the confidence ladder.
 *
 * Usage:
 *   daggler run <file> [--static|--local|--github] [--full] [--repo R] [--ref REF]
 *
 * Rungs:
 *   --static  (default)  AnalyzerAdapter — deterministic static analysis
 *   --local              ActAdapter — plan (or --full run) via act + Docker
 *   --github             GitHubDispatchAdapter — dispatch via gh CLI
 *
 * Exit codes:
 *   0   success / clean
 *   1   run completed with failure/error status (workflow problems)
 *   2   infrastructure not available (act/docker missing, gh not auth'd)
 * ============================================================================ */

import { AnalyzerAdapter } from "@daggler/runner-protocol";
import { ActAdapter, GitHubDispatchAdapter } from "@daggler/runner";
import { isActAvailable } from "@daggler/runner";
import type { RunnerRunResult, RunnerLogEvent } from "@daggler/runner-protocol";
import pc from "picocolors";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Color / style helpers
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

function logLevelGlyph(level: RunnerLogEvent["level"]): string {
  switch (level) {
    case "error":
      return paint(pc.red, "●");
    case "warn":
      return paint(pc.yellow, "▲");
    case "info":
      return paint(pc.cyan, "○");
  }
}

function statusColor(status: RunnerRunResult["status"]): string {
  switch (status) {
    case "success":
      return paint(pc.green, status);
    case "failure":
    case "error":
      return paint(pc.red, status);
    case "running":
    case "queued":
      return paint(pc.yellow, status);
  }
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Run git synchronously and return trimmed stdout, or null on error. */
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

function inferRef(): string {
  return gitOutput("rev-parse", "--abbrev-ref", "HEAD") ?? "main";
}

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------

function printResult(
  result: RunnerRunResult,
  rungLabel: string,
): void {
  process.stdout.write(rule() + "\n");
  process.stdout.write(
    `  ${bold("daggler run")}  ${dim("·")}  ${dim(rungLabel)}\n`,
  );
  process.stdout.write("\n");

  if (result.logs.length > 0) {
    for (const log of result.logs) {
      const glyph = logLevelGlyph(log.level);
      const node = log.nodePath ? `${dim(log.nodePath)}  ` : "";
      process.stdout.write(`  ${glyph}  ${node}${log.message}\n`);
    }
    process.stdout.write("\n");
  }

  process.stdout.write(rule() + "\n");
  process.stdout.write(
    `  ${bold("Status")}  ${statusColor(result.status)}  ${dim("·")}  ${result.summary}\n`,
  );
  process.stdout.write(rule() + "\n");
}

// ---------------------------------------------------------------------------
// runRun — public entry point
// ---------------------------------------------------------------------------

export async function runRun(args: string[]): Promise<number> {
  const flagNoColor = args.includes("--no-color");
  if (flagNoColor) colorEnabled = false;

  const flagStatic = args.includes("--static");
  const flagLocal = args.includes("--local");
  const flagGitHub = args.includes("--github");
  const flagFull = args.includes("--full");

  // Determine rung — --static is default if nothing specified
  type Rung = "static" | "local" | "github";
  let rung: Rung;
  if (flagGitHub) {
    rung = "github";
  } else if (flagLocal) {
    rung = "local";
  } else {
    rung = "static";
  }

  // --repo / --ref flags
  let repoFlag: string | undefined;
  let refFlag: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--repo" && i + 1 < args.length) {
      repoFlag = args[++i];
    } else if (a === "--ref" && i + 1 < args.length) {
      refFlag = args[++i];
    }
  }

  // First positional arg (not a flag) is the file
  const positional = args.filter((a) => !a.startsWith("--"));
  const fileArg = positional[0];

  if (!fileArg) {
    process.stderr.write(
      `  ${paint(pc.red, "error")}  No workflow file specified.\n` +
        `  Usage: ${paint(pc.cyan, "daggler")} ${paint(pc.green as (s: string) => string, "run")} ${dim("<file>")} ${dim("[--static|--local|--github]")}\n`,
    );
    return 1;
  }

  const absFile = path.resolve(fileArg);

  // Read the file
  let workflowYaml: string;
  try {
    workflowYaml = fs.readFileSync(absFile, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `  ${paint(pc.red, "error")}  Cannot read ${absFile}: ${msg}\n`,
    );
    return 1;
  }

  const relPath = path.relative(process.cwd(), absFile);
  const req = { workflowYaml, path: relPath };

  // ── Static rung ────────────────────────────────────────────────────────────
  if (rung === "static") {
    const adapter = new AnalyzerAdapter();
    const caps = adapter.capabilities();
    process.stdout.write(
      `  ${bold("rung")}  ${dim(caps.label)}  ${dim("·")}  ${dim(caps.notes ?? "")}\n\n`,
    );
    const result = await adapter.startRun(req);
    printResult(result, caps.label);
    return result.status === "success" ? 0 : 1;
  }

  // ── Local rung (act) ───────────────────────────────────────────────────────
  if (rung === "local") {
    const adapter = new ActAdapter();
    const caps = adapter.capabilities();

    if (!isActAvailable()) {
      process.stderr.write(
        `  ${paint(pc.red, "error")}  act/docker not available on this machine.\n` +
          `  ${dim(caps.notes ?? "")}\n` +
          `  ${dim("Run")} ${paint(pc.cyan, "daggler bridge")} ${dim("to see what is installed.")}\n`,
      );
      return 2;
    }

    process.stdout.write(
      `  ${bold("rung")}  ${dim(caps.label)}  ${dim("·")}  ${flagFull ? dim("full run") : dim("plan (act -l)")}\n\n`,
    );

    let result: RunnerRunResult;
    if (flagFull) {
      result = await adapter.run(req, { full: true });
    } else {
      result = await adapter.plan(req);
    }

    if (result.status === "error" && result.logs[0]?.message.includes("not available")) {
      process.stderr.write(
        `  ${paint(pc.red, "error")}  ${result.summary}\n` +
          `  ${dim("Run")} ${paint(pc.cyan, "daggler bridge")} ${dim("to see what is installed.")}\n`,
      );
      return 2;
    }

    printResult(result, caps.label);
    return result.status === "success" ? 0 : 1;
  }

  // ── GitHub rung ───────────────────────────────────────────────────────────
  if (rung === "github") {
    const adapter = new GitHubDispatchAdapter();

    if (!adapter.isAvailable()) {
      process.stderr.write(
        `  ${paint(pc.red, "error")}  gh not found or not authenticated.\n` +
          `  ${dim("Install gh and run:")} ${paint(pc.cyan, "gh auth login")}\n`,
      );
      return 2;
    }

    // Infer repo and ref
    const repo = repoFlag ?? inferRepo();
    const ref = refFlag ?? inferRef();

    if (!repo) {
      process.stderr.write(
        `  ${paint(pc.red, "error")}  Cannot infer repo from git remote.\n` +
          `  ${dim("Pass")} ${paint(pc.yellow, "--repo owner/repo")} ${dim("explicitly.")}\n`,
      );
      return 1;
    }

    // Workflow file relative to repo root — use basename of the path
    const workflowFile = path.basename(absFile);

    process.stdout.write(
      `  ${bold("rung")}  ${dim("GitHub Actions (authoritative)")}  ${dim("·")}  ${dim(`${repo}@${ref}`)}\n`,
    );
    process.stdout.write(
      `  ${dim("dispatching")}  ${paint(pc.cyan, workflowFile)}  ${dim("...")}  `,
    );

    const dispatchResult = adapter.dispatch({ repo, workflowFile, ref });

    if (!dispatchResult.ok) {
      process.stdout.write("\n");
      process.stderr.write(
        `  ${paint(pc.red, "error")}  Dispatch failed: ${dispatchResult.message}\n` +
          `  ${dim("Make sure the workflow has")} ${paint(pc.yellow, "workflow_dispatch:")} ${dim("in its on: triggers.")}\n`,
      );
      return 1;
    }

    process.stdout.write(paint(pc.green, "dispatched") + "\n\n");
    process.stdout.write(
      `  ${dim("https://github.com/" + repo + "/actions")}\n\n`,
    );

    // Fetch the latest queued / in-progress run
    process.stdout.write(`  ${dim("fetching run status")} ${dim("...")}\n`);

    // Brief poll: give GitHub ~5 s to register the run
    let latestRun = adapter.latestRun(repo, workflowFile);
    if (!latestRun) {
      // Wait a couple of seconds and retry once
      await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
      latestRun = adapter.latestRun(repo, workflowFile);
    }

    if (!latestRun) {
      process.stdout.write(
        `  ${paint(pc.yellow, "note")}  Could not retrieve run status — check GitHub Actions dashboard.\n` +
          `  ${dim("https://github.com/" + repo + "/actions")}\n`,
      );
      return 0;
    }

    const runResult = adapter.toRunResult(latestRun);
    process.stdout.write(rule() + "\n");
    process.stdout.write(
      `  ${bold("Status")}  ${statusColor(runResult.status)}  ${dim("·")}  ${runResult.summary}\n`,
    );
    process.stdout.write(
      `  ${dim("https://github.com/" + repo + "/actions/runs/" + (latestRun.databaseId ?? ""))}\n`,
    );
    process.stdout.write(rule() + "\n");

    return runResult.status === "success" ? 0 : 0; // don't fail CLI for in-progress runs
  }

  return 0;
}
