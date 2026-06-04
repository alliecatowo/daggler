/* ============================================================================
 * @daggler/runner-protocol — port + value types.
 *
 * The RunnerPort is the single seam between Daggler's static analysis core
 * and any execution back-end. Adapters are honest about what they can actually
 * do — see CONFIDENCE_LADDER in index.ts.
 * ========================================================================== */

/** Which rung of the confidence ladder this adapter occupies. */
export type RunnerKind = "analyzer" | "act" | "github";

/**
 * What a RunnerPort implementation can actually do.
 * Consumers should surface these to the user before starting a run.
 */
export interface RunnerCapabilities {
  kind: RunnerKind;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Adapter can read local git state (e.g. branch, SHA). */
  hasGit: boolean;
  /** Adapter can spin up Docker containers. */
  hasDocker: boolean;
  /** Adapter uses nektos/act for local execution. */
  hasAct: boolean;
  /**
   * True only when results come from a real GitHub Actions runner.
   * Static-analysis and act adapters are approximations.
   */
  authoritative: boolean;
  /** Additional context shown in UI capability tooltip. */
  notes?: string;
}

/** Lifecycle state of a run. */
export type RunStatus = "queued" | "running" | "success" | "failure" | "error";

/** Input to a run request. */
export interface RunnerRunRequest {
  /** Raw YAML of the workflow to analyse or execute. */
  workflowYaml: string;
  /** Optional path hint (e.g. ".github/workflows/ci.yml") for diagnostics. */
  path?: string;
  /** Event name that triggers the workflow (e.g. "push", "pull_request"). */
  event?: string;
}

/** A single structured log line emitted during (or after) a run. */
export interface RunnerLogEvent {
  /** Monotonically increasing counter, 0-based, for stable ordering. */
  seq: number;
  level: "info" | "warn" | "error";
  /**
   * Canonical node path in the WorkflowIR (e.g. "jobs.build.steps[2]").
   * Undefined for workflow-level messages.
   */
  nodePath?: string;
  message: string;
}

/** The outcome of a run request. */
export interface RunnerRunResult {
  status: RunStatus;
  logs: RunnerLogEvent[];
  /** One-line human summary surfaced in the UI. */
  summary: string;
}

/**
 * The hexagonal port every execution back-end must satisfy.
 *
 * Implementors must be honest: if they cannot execute a workflow they MUST
 * reject startRun with NotConnectedError rather than return fake results.
 */
export interface RunnerPort {
  /** Describe what this adapter can actually do. */
  capabilities(): RunnerCapabilities;
  /**
   * Start a run (or analysis pass) and resolve when it completes.
   *
   * @throws {NotConnectedError} when the required infrastructure is absent.
   */
  startRun(req: RunnerRunRequest): Promise<RunnerRunResult>;
}

/**
 * Thrown by adapters that require external infrastructure (act, GitHub App)
 * that is not yet connected in the current environment.
 */
export class NotConnectedError extends Error {
  override readonly name = "NotConnectedError";

  constructor(message: string) {
    super(message);
    // Maintains proper prototype chain in ES5-compiled environments.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
