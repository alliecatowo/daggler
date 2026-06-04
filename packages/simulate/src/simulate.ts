/* ============================================================================
 * @daggler/simulate — main simulation engine
 *
 * simulateEvent(ir, fx) determines:
 *   1. Whether the workflow is triggered (any trigger matches the fixture).
 *   2. For each job, whether it runs, skips, or is unknown — accounting for
 *      `if:` conditions and `needs:` dependency propagation.
 * ========================================================================== */

import type { WorkflowIR, JobIR } from "@daggler/workflow-ir";
import type { EventFixture, JobDecision, SimulationResult } from "./types.js";
import { matchesTrigger } from "./triggers.js";
import { evalIf, type EvalContext, type GithubContext } from "./expr.js";

/* -------------------------------------------------------------------------- */
/* Context construction                                                         */
/* -------------------------------------------------------------------------- */

function buildGithubContext(fx: EventFixture): GithubContext {
  const ref = fx.ref ?? "refs/heads/main";

  let ref_name: string;
  if (ref.startsWith("refs/heads/")) {
    ref_name = ref.slice("refs/heads/".length);
  } else if (ref.startsWith("refs/tags/")) {
    ref_name = ref.slice("refs/tags/".length);
  } else {
    ref_name = ref;
  }

  return {
    event_name: fx.event,
    ref,
    ref_name,
    actor: fx.actor ?? "",
    base_ref: fx.baseRef ?? "",
    head_ref: ref_name,
  };
}

/* -------------------------------------------------------------------------- */
/* Topological sort                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Returns a job order that respects `needs:` dependencies (topological sort).
 * Jobs with no needs come first. If there are cycles or unresolvable refs we
 * still return a best-effort ordering so the simulation does not crash.
 */
function topoSort(jobs: JobIR[]): JobIR[] {
  const byId = new Map<string, JobIR>(jobs.map((j) => [j.id, j]));
  const visited = new Set<string>();
  const result: JobIR[] = [];

  function visit(id: string, stack: Set<string>): void {
    if (visited.has(id)) return;
    if (stack.has(id)) return; // cycle — skip to avoid infinite loop

    const job = byId.get(id);
    if (!job) return;

    stack.add(id);
    for (const need of job.needs) {
      visit(need, stack);
    }
    stack.delete(id);
    visited.add(id);
    result.push(job);
  }

  for (const job of jobs) {
    visit(job.id, new Set());
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Returns true when an if-expression references always() so that the job
 * should run even when a dependency was skipped.
 *
 * We use a simple heuristic: if evalIf returns true with a "cancelled" or
 * "failure" job status it implicitly uses always().  For clarity we just look
 * for the presence of the token "always" in the raw expression string, which
 * is safe because "always" is only meaningful as a function call here.
 */
function expressionUsesAlways(ifExpr: string): boolean {
  return /\balways\s*\(\s*\)/.test(ifExpr);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Simulate which jobs would run given a WorkflowIR and an EventFixture.
 */
export function simulateEvent(ir: WorkflowIR, fx: EventFixture): SimulationResult {
  // ---- Step 1: trigger matching ----
  let matchedTrigger: string | undefined;
  let triggerReason = "No trigger matched the event";

  for (const trigger of ir.on) {
    const result = matchesTrigger(trigger, fx);
    if (result.matched) {
      matchedTrigger = trigger.event;
      triggerReason = result.reason;
      break;
    }
  }

  const triggered = matchedTrigger !== undefined;

  // ---- Step 2: short-circuit when workflow is not triggered ----
  if (!triggered) {
    const jobs: Record<string, JobDecision> = {};
    for (const job of ir.jobs) {
      jobs[job.id] = {
        decision: "skip",
        reason: "Workflow not triggered",
      };
    }
    return { triggered: false, triggerReason, jobs };
  }

  // ---- Step 3: build evaluation context ----
  const github = buildGithubContext(fx);
  const evalCtx: EvalContext = {
    github,
    inputs: fx.inputs,
    jobStatus: "success",
  };

  // ---- Step 4: evaluate each job's own `if:` condition ----
  // Process in topological order so we can propagate needs decisions.
  const sorted = topoSort(ir.jobs);
  const decisions = new Map<string, JobDecision>();

  for (const job of sorted) {
    // Start assuming the job runs
    let decision: "run" | "skip" | "unknown" = "run";
    let reason = "Job runs";

    // Evaluate the job's own `if:` expression first
    if (job.if !== undefined) {
      const evalResult = evalIf(job.if, evalCtx);
      if (evalResult.value === false) {
        decision = "skip";
        reason = evalResult.reason;
      } else if (evalResult.value === "unknown") {
        decision = "unknown";
        reason = evalResult.reason;
      }
      // If true, decision stays "run"
    }

    // ---- Step 5: propagate needs decisions ----
    // Only apply needs propagation if this job would otherwise run or is unknown
    if (decision !== "skip") {
      const usesAlways = job.if !== undefined && expressionUsesAlways(job.if);

      for (const needId of job.needs) {
        const needDecision = decisions.get(needId);
        if (!needDecision) {
          // Referenced job not found (broken graph) — we cannot determine the outcome
          if (decision === "run") {
            decision = "unknown";
            reason = `Dependency "${needId}" not found in workflow`;
          }
          continue;
        }

        if (needDecision.decision === "skip") {
          if (!usesAlways) {
            decision = "skip";
            reason = `Dependency "${needId}" was skipped`;
            break;
          }
          // if: always() — job still runs even if needs was skipped
        } else if (needDecision.decision === "unknown") {
          if (decision === "run") {
            decision = "unknown";
            reason = `Dependency "${needId}" has an unknown outcome`;
          }
        }
      }
    }

    decisions.set(job.id, { decision, reason });
  }

  // ---- Step 6: build result record keyed by job id ----
  const jobs: Record<string, JobDecision> = {};
  for (const job of ir.jobs) {
    jobs[job.id] = decisions.get(job.id) ?? {
      decision: "unknown",
      reason: "Job was not reached during simulation",
    };
  }

  return {
    triggered: true,
    triggerReason,
    matchedTrigger,
    jobs,
  };
}
