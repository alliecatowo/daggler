/* ============================================================================
 * @daggler/simulate — type contracts
 * ========================================================================== */

/**
 * A concrete event fixture that drives the simulation.  All fields that are
 * not relevant to a particular event can be omitted.
 */
export interface EventFixture {
  /** The GitHub event name, e.g. "push", "pull_request", "workflow_dispatch". */
  event: string;
  /**
   * The fully-qualified ref, e.g. "refs/heads/main" or "refs/tags/v1.2.3".
   * Defaults to "refs/heads/main" when omitted.
   */
  ref?: string;
  /** The base ref for pull_request events ("refs/heads/<base>"). */
  baseRef?: string;
  /** Paths that changed (used for `paths` / `paths-ignore` filters). */
  changedPaths?: string[];
  /** The actor (user) that triggered the event. */
  actor?: string;
  /** The activity type, e.g. "opened", "synchronize" for pull_request. */
  action?: string;
  /** Whether the repository is a fork (relevant for pull_request contexts). */
  forked?: boolean;
  /** Inputs provided for workflow_dispatch / workflow_call events. */
  inputs?: Record<string, string>;
}

/** The simulation verdict for a single job. */
export interface JobDecision {
  decision: "run" | "skip" | "unknown";
  reason: string;
}

/** The full result returned by simulateEvent(). */
export interface SimulationResult {
  /** True when at least one trigger matched the event fixture. */
  triggered: boolean;
  /** Human-readable explanation of why the workflow was (or was not) triggered. */
  triggerReason: string;
  /** The event name of the first trigger that matched, if any. */
  matchedTrigger?: string;
  /** Decision map keyed by job id. */
  jobs: Record<string, JobDecision>;
}
