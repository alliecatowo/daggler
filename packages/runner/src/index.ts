/* ============================================================================
 * @daggler/runner — public surface.
 *
 * Node-only adapters that shell out to act, actionlint, and gh.
 * ========================================================================== */

export {
  which,
  toolVersion,
  isActAvailable,
  isActionlintAvailable,
  writeTempWorkflow,
  type TempWorkflow,
} from "./tools.js";

export {
  ActionlintAdapter,
  runActionlint,
  toDiagnostics,
  type ActionlintFinding,
  type ActionlintResult,
  type ActionlintDiagnostic,
} from "./actionlint.js";

export {
  ActAdapter,
  type ActRunOptions,
} from "./act.js";

export {
  GitHubDispatchAdapter,
  type DispatchOpts,
} from "./github.js";
