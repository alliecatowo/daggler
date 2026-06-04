/* ============================================================================
 * github.ts — GitHubDispatchAdapter
 *
 * Shells out to `gh` (GitHub CLI) to trigger and observe real GitHub Actions
 * runs.  Honest: if gh is absent or unauthenticated, every method reports that
 * truthfully rather than throwing or returning fake data.
 * ========================================================================== */

import { spawnSync } from "node:child_process";
import type {
  RunnerCapabilities,
  RunnerPort,
  RunnerRunRequest,
  RunnerRunResult,
  RunnerLogEvent,
} from "@daggler/runner-protocol";
import { which } from "./tools.js";

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

export interface DispatchOpts {
  repo: string;
  workflowFile: string;
  ref: string;
  inputs?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Raw JSON shapes returned by `gh run list --json ...`
// ---------------------------------------------------------------------------

interface GhRunListItem {
  databaseId?: number;
  status?: string;
  conclusion?: string | null;
  headSha?: string;
  event?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ghBin(): string | null {
  return which("gh");
}

function makeLog(
  seq: number,
  message: string,
  level: RunnerLogEvent["level"] = "info",
): RunnerLogEvent {
  return { seq, level, message };
}

function runGh(args: string[], timeoutMs = 30_000): { ok: boolean; stdout: string; stderr: string; status: number } {
  const bin = ghBin();
  if (!bin) {
    return { ok: false, stdout: "", stderr: "gh not found", status: 127 };
  }

  const result = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const status = result.status ?? 1;
  return {
    ok: status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status,
  };
}

// ---------------------------------------------------------------------------
// GitHubDispatchAdapter
// ---------------------------------------------------------------------------

export class GitHubDispatchAdapter implements RunnerPort {
  // ---- RunnerPort ----------------------------------------------------------

  capabilities(): RunnerCapabilities {
    const available = this.isAvailable();
    return {
      kind: "github",
      label: "GitHub Actions (authoritative)",
      hasGit: true,
      hasDocker: false,
      hasAct: false,
      authoritative: true,
      notes: available
        ? "Authoritative results from real GitHub Actions runners via gh CLI."
        : "gh not found or not authenticated — install gh and run: gh auth login",
    };
  }

  /**
   * Implements RunnerPort.startRun.
   *
   * NOTE: This adapter requires a real repo + workflow file to dispatch against.
   * The RunnerRunRequest only carries YAML, not a repo slug, so startRun
   * returns an informative error result rather than attempting a dispatch.
   * Callers that have repo/ref/workflowFile information should use dispatch()
   * directly.
   */
  async startRun(_req: RunnerRunRequest): Promise<RunnerRunResult> {
    if (!this.isAvailable()) {
      return {
        status: "error",
        logs: [makeLog(0, "gh not found or not authenticated", "error")],
        summary: "gh not found or not authenticated — install gh and run: gh auth login",
      };
    }
    return {
      status: "error",
      logs: [makeLog(0, "Use GitHubDispatchAdapter.dispatch() with a repo slug and workflow file", "warn")],
      summary: "dispatch requires repo + workflowFile — use dispatch() directly",
    };
  }

  // ---- GitHub-specific API -------------------------------------------------

  /**
   * True when `gh` is installed and `gh auth status` exits 0.
   */
  isAvailable(): boolean {
    if (!ghBin()) return false;
    const result = runGh(["auth", "status"], 10_000);
    return result.ok;
  }

  /**
   * Trigger a workflow via `gh workflow run`.
   */
  dispatch(opts: DispatchOpts): { ok: boolean; message: string } {
    if (!ghBin()) {
      return { ok: false, message: "gh not found" };
    }

    const args = [
      "workflow", "run", opts.workflowFile,
      "--repo", opts.repo,
      "--ref", opts.ref,
    ];

    if (opts.inputs) {
      for (const [k, v] of Object.entries(opts.inputs)) {
        args.push("-f", `${k}=${v}`);
      }
    }

    const result = runGh(args, 30_000);
    return {
      ok: result.ok,
      message: result.ok
        ? `Workflow dispatched: ${opts.workflowFile}@${opts.ref}`
        : result.stderr.trim() || `gh exited with status ${result.status}`,
    };
  }

  /**
   * Return the most-recent run for a workflow in a repo.
   * Uses `gh run list --json ...`.
   */
  latestRun(
    repo: string,
    workflowFile: string,
  ): GhRunListItem | null {
    const result = runGh([
      "run", "list",
      "--repo", repo,
      "--workflow", workflowFile,
      "--limit", "1",
      "--json", "databaseId,status,conclusion,headSha,event",
    ], 20_000);

    if (!result.ok) return null;

    try {
      const parsed: unknown = JSON.parse(result.stdout.trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed[0] as GhRunListItem;
      }
    } catch {
      // parse error — return null
    }
    return null;
  }

  /**
   * Watch a run until it completes via `gh run watch`.
   * Returns captured output lines.
   */
  watch(repo: string, runId: number): string[] {
    const result = runGh([
      "run", "watch", String(runId),
      "--repo", repo,
    ], 600_000); // up to 10 min

    return (result.stdout + "\n" + result.stderr)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /**
   * Import the last portion of logs for a completed run via `gh run view --log`.
   * Returns up to 500 lines from the tail.
   */
  importLogs(repo: string, runId: number): RunnerLogEvent[] {
    const result = runGh([
      "run", "view", String(runId),
      "--repo", repo,
      "--log",
    ], 60_000);

    const allLines = (result.stdout + "\n" + result.stderr)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // Tail: keep last 500 lines.
    const tail = allLines.slice(-500);
    return tail.map((message, i) => makeLog(i, message, "info"));
  }

  /**
   * Map a completed GhRunListItem to a RunnerRunResult.
   */
  toRunResult(
    run: GhRunListItem,
    logs: RunnerLogEvent[] = [],
  ): RunnerRunResult {
    const conclusion = run.conclusion ?? run.status ?? "unknown";
    let status: RunnerRunResult["status"];
    switch (conclusion) {
      case "success":
        status = "success";
        break;
      case "failure":
      case "cancelled":
      case "timed_out":
        status = "failure";
        break;
      case "queued":
      case "in_progress":
      case "waiting":
        status = "running";
        break;
      default:
        status = "error";
    }

    return {
      status,
      logs,
      summary: `GitHub run #${run.databaseId ?? "?"}: ${conclusion} (${run.event ?? "?"}, sha ${(run.headSha ?? "?").slice(0, 7)})`,
    };
  }
}
