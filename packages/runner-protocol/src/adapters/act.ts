/* ============================================================================
 * ActAdapter — rung 2 of the confidence ladder.
 *
 * Local approximation using nektos/act via the daggler bridge process.
 * This adapter accurately reports its capabilities: it requires the daggler
 * bridge to be running locally with act installed.
 *
 * startRun rejects with NotConnectedError until the bridge is wired up — this
 * is intentional. We never return fake results.
 * ========================================================================== */

import type {
  RunnerCapabilities,
  RunnerPort,
  RunnerRunRequest,
  RunnerRunResult,
} from "../types.js";
import { NotConnectedError } from "../types.js";

export class ActAdapter implements RunnerPort {
  capabilities(): RunnerCapabilities {
    return {
      kind: "act",
      label: "Local runner (act)",
      hasGit: true,
      hasDocker: true,
      hasAct: false, // requires the daggler bridge with act installed
      authoritative: false,
      notes:
        "Local approximation requires the daggler bridge with nektos/act installed. " +
        "Run: npx daggler bridge",
    };
  }

  async startRun(_req: RunnerRunRequest): Promise<RunnerRunResult> {
    throw new NotConnectedError(
      "Local approximation requires the daggler bridge - run: npx daggler bridge",
    );
  }
}
