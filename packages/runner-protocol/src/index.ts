/* ============================================================================
 * @daggler/runner-protocol — public surface.
 *
 * The RunnerPort is the single seam between Daggler's analysis core and any
 * execution back-end. Consumers pick a rung from CONFIDENCE_LADDER based on
 * what's available in their environment.
 * ========================================================================== */

export type {
  RunnerKind,
  RunnerCapabilities,
  RunStatus,
  RunnerRunRequest,
  RunnerLogEvent,
  RunnerRunResult,
  RunnerPort,
} from "./types.js";
export { NotConnectedError } from "./types.js";

export { AnalyzerAdapter } from "./adapters/analyzer.js";
export { ActAdapter } from "./adapters/act.js";
export { GitHubDispatchAdapter } from "./adapters/github.js";

import { AnalyzerAdapter } from "./adapters/analyzer.js";
import { ActAdapter } from "./adapters/act.js";
import { GitHubDispatchAdapter } from "./adapters/github.js";
import type { RunnerPort } from "./types.js";

/**
 * A rung on the confidence ladder.
 *
 * Rungs are ordered from least to most authoritative. The UI should walk up
 * from rung 0 and pick the highest rung whose adapter does NOT throw
 * NotConnectedError on startRun.
 */
export interface ConfidenceLadderRung {
  /** Short identifier. */
  id: "static" | "local" | "github";
  /** Human-readable label for the UI. */
  label: string;
  /** One-line description of what this rung provides. */
  description: string;
  /** Factory that creates a fresh adapter instance for this rung. */
  createAdapter: () => RunnerPort;
}

/**
 * The three-rung confidence ladder.
 *
 * - static: always available, deterministic; uses @daggler/validators.
 * - local:  requires the daggler bridge with nektos/act installed.
 * - github: requires a connected GitHub App; authoritative ground truth.
 */
export const CONFIDENCE_LADDER: readonly ConfidenceLadderRung[] = [
  {
    id: "static",
    label: "Static analysis",
    description:
      "Deterministic checks via @daggler/validators. Always available, no infrastructure required.",
    createAdapter: () => new AnalyzerAdapter(),
  },
  {
    id: "local",
    label: "Local runner (act)",
    description:
      "Local approximation using nektos/act via the daggler bridge. Requires Docker and the bridge process.",
    createAdapter: () => new ActAdapter(),
  },
  {
    id: "github",
    label: "GitHub Actions (authoritative)",
    description:
      "Real execution on GitHub-hosted runners via a connected GitHub App. Ground truth results.",
    createAdapter: () => new GitHubDispatchAdapter(),
  },
] as const;
