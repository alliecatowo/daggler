/* ============================================================================
 * act.ts — ActAdapter
 *
 * Implements RunnerPort using nektos/act for local approximations.
 * Honest about its capabilities: if act or Docker is absent, startRun resolves
 * with status:"error" rather than throwing or returning fake results.
 * ========================================================================== */

import { spawnSync } from "node:child_process";
import type {
  RunnerCapabilities,
  RunnerPort,
  RunnerRunRequest,
  RunnerRunResult,
  RunnerLogEvent,
} from "@daggler/runner-protocol";
import { isActAvailable, which, writeTempWorkflow } from "./tools.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLog(
  seq: number,
  message: string,
  level: RunnerLogEvent["level"] = "info",
): RunnerLogEvent {
  return { seq, level, message };
}

/**
 * Build the augmented env for child processes so that ~/.local/bin is always
 * on PATH (where act and docker are typically installed on this machine).
 */
function childEnv(): NodeJS.ProcessEnv {
  const home = process.env["HOME"] ?? "";
  const localBin = `${home}/.local/bin`;
  const existing = process.env["PATH"] ?? "";
  return {
    ...process.env,
    PATH: existing.includes(localBin) ? existing : `${localBin}:${existing}`,
  };
}

// ---------------------------------------------------------------------------
// Additional public types
// ---------------------------------------------------------------------------

export interface ActRunOptions {
  /** When true, run the full act execution (may pull Docker images). */
  full?: boolean;
}

// ---------------------------------------------------------------------------
// ActAdapter
// ---------------------------------------------------------------------------

export class ActAdapter implements RunnerPort {
  /** Describe what this adapter can actually do — detected at call time. */
  capabilities(): RunnerCapabilities {
    const hasAct = which("act") !== null;
    const hasDocker =
      which("docker") !== null || which("podman") !== null;

    return {
      kind: "act",
      label: "Local runner (act)",
      hasGit: true,
      hasDocker,
      hasAct,
      authoritative: false,
      notes: hasAct && hasDocker
        ? "Local approximation via nektos/act + Docker."
        : "act and/or Docker not found — run: daggler bridge",
    };
  }

  /**
   * Run `act -W <dir> -l` to list planned jobs without executing them.
   * Fast and free of image pulls; useful for a quick sanity check.
   */
  async plan(req: RunnerRunRequest): Promise<RunnerRunResult> {
    if (!isActAvailable()) {
      return {
        status: "error",
        logs: [makeLog(0, "act/docker not available - run: daggler bridge", "error")],
        summary: "act/docker not available - run: daggler bridge",
      };
    }

    const tmp = writeTempWorkflow(
      req.workflowYaml,
      req.path ? req.path.replace(/.*[\\/]/, "") : "workflow.yml",
    );

    try {
      const bin = which("act")!;
      const result = spawnSync(bin, ["-W", tmp.dir, "-l"], {
        encoding: "utf8",
        timeout: 30_000,
        env: childEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const logs: RunnerLogEvent[] = [];
      let seq = 0;

      const combined = [result.stdout ?? "", result.stderr ?? ""].join("\n");
      for (const line of combined.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          logs.push(makeLog(seq++, trimmed, "info"));
        }
      }

      const status = (result.status ?? 1) === 0 ? "success" : "failure";
      return {
        status,
        logs,
        summary: `act plan: ${logs.length} line(s) (exit ${result.status ?? "?"})`,
      };
    } finally {
      tmp.cleanup();
    }
  }

  /**
   * Run the workflow via act.
   *
   * By default runs `act -W <dir> -n` (dry-run, no image pull).
   * Pass `{ full: true }` to execute fully (may pull Docker images).
   */
  async run(
    req: RunnerRunRequest,
    opts: ActRunOptions = {},
  ): Promise<RunnerRunResult> {
    if (!isActAvailable()) {
      return {
        status: "error",
        logs: [makeLog(0, "act/docker not available - run: daggler bridge", "error")],
        summary: "act/docker not available - run: daggler bridge",
      };
    }

    const tmp = writeTempWorkflow(
      req.workflowYaml,
      req.path ? req.path.replace(/.*[\\/]/, "") : "workflow.yml",
    );

    try {
      const bin = which("act")!;
      const args = opts.full
        ? ["-W", tmp.dir]
        : ["-W", tmp.dir, "-n"];

      if (req.event) {
        args.push(req.event);
      }

      const result = spawnSync(bin, args, {
        encoding: "utf8",
        timeout: opts.full ? 300_000 : 60_000,
        env: childEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const logs: RunnerLogEvent[] = [];
      let seq = 0;

      for (const line of (result.stdout ?? "").split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          logs.push(makeLog(seq++, trimmed, "info"));
        }
      }
      for (const line of (result.stderr ?? "").split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          logs.push(makeLog(seq++, trimmed, "warn"));
        }
      }

      // Sort by seq (stdout before stderr within a seq, both streams interleaved).
      const exitCode = result.status ?? 1;
      const status = exitCode === 0 ? "success" : "failure";
      const mode = opts.full ? "full" : "dry-run";
      return {
        status,
        logs,
        summary: `act ${mode}: exit ${exitCode}, ${logs.length} log line(s)`,
      };
    } finally {
      tmp.cleanup();
    }
  }

  /**
   * Implements RunnerPort.startRun — delegates to plan() by default (fast,
   * no image pull).  If act/docker are unavailable, resolves with an error
   * result rather than throwing.
   */
  async startRun(req: RunnerRunRequest): Promise<RunnerRunResult> {
    if (!isActAvailable()) {
      return {
        status: "error",
        logs: [makeLog(0, "act/docker not available - run: daggler bridge", "error")],
        summary: "act/docker not available - run: daggler bridge",
      };
    }
    return this.plan(req);
  }
}
