/* ============================================================================
 * @daggler/simulate — public API
 * ========================================================================== */

export type { EventFixture, JobDecision, SimulationResult } from "./types.js";
export { matchesTrigger, matchGlob } from "./triggers.js";
export type { TriggerMatchResult } from "./triggers.js";
export { evalIf } from "./expr.js";
export type { EvalContext, GithubContext, EvalResult } from "./expr.js";
export { simulateEvent } from "./simulate.js";
