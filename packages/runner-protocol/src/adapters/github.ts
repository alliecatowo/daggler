/* ============================================================================
 * GitHubDispatchAdapter — rung 3 of the confidence ladder.
 *
 * Authoritative execution on real GitHub Actions infrastructure via a connected
 * GitHub App. Results from this adapter are the ground truth — no local
 * approximations.
 *
 * startRun rejects with NotConnectedError until a GitHub App is connected — we
 * never simulate results. This is a typed, clearly-commented adapter stub that
 * describes exactly what wiring is needed.
 * ========================================================================== */

import type {
  RunnerCapabilities,
  RunnerPort,
  RunnerRunRequest,
  RunnerRunResult,
} from "../types.js";
import { NotConnectedError } from "../types.js";

export class GitHubDispatchAdapter implements RunnerPort {
  capabilities(): RunnerCapabilities {
    return {
      kind: "github",
      label: "GitHub Actions (authoritative)",
      hasGit: true,
      hasDocker: false,
      hasAct: false,
      authoritative: true,
      notes:
        "Authoritative results from real GitHub Actions runners via a connected GitHub App. " +
        "Connect a GitHub App in Daggler settings to enable this rung.",
    };
  }

  async startRun(_req: RunnerRunRequest): Promise<RunnerRunResult> {
    throw new NotConnectedError(
      "Proving on GitHub requires connecting a GitHub App",
    );
  }
}
