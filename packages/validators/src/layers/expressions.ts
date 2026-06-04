/* ============================================================================
 * expressions.ts — EXPR001–EXPR004: expression-context validation layer.
 *
 * Walks every `${{ … }}` occurrence in the workflow IR and checks that the
 * referenced context (matrix, needs, steps, inputs) is actually available at
 * the point of use. All findings are "semantic" source; none set span (the
 * orchestrator resolves those from the SourceMap).
 *
 * Rules:
 *   EXPR001 (error)   – `matrix.<x>` used in a job with no matrix strategy.
 *   EXPR002 (error)   – `needs.<name>.` references a job not in needs array.
 *   EXPR003 (warning) – `steps.<id>.` references a step id that doesn't exist.
 *   EXPR004 (warning) – `inputs.<x>` used without workflow_dispatch/call inputs.
 *
 * De-duplication: at most one finding per (code, path, offending-name).
 * ========================================================================== */

import type { RawFinding, ValidationLayer } from "../types.js";
import { collectExpressions } from "../walk.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a de-dup key so we never emit the same (code, path, name) twice. */
function dedupKey(code: string, path: string, name: string): string {
  return `${code}::${path}::${name}`;
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const checkExpressions: ValidationLayer = (ctx) => {
  const findings: RawFinding[] = [];
  const seen = new Set<string>();

  /** Emit at most once per (code, path, name). */
  function emit(f: RawFinding, name: string): void {
    const key = dedupKey(f.code, f.path, name);
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  }

  const uses = collectExpressions(ctx.ir);

  // Pre-compute: does this workflow have workflow_dispatch or workflow_call
  // triggers with declared inputs?
  const hasInputTrigger = ctx.ir.on.some(
    (t) =>
      (t.event === "workflow_dispatch" || t.event === "workflow_call") &&
      t.inputs != null &&
      Object.keys(t.inputs).length > 0,
  );

  for (const use of uses) {
    const { path, body, jobId } = use;

    // Find the owning job when there is one.
    const job = jobId != null ? ctx.ir.jobs.find((j) => j.id === jobId) : undefined;

    // ------------------------------------------------------------------
    // EXPR001 — `matrix.<x>` in a job with no matrix strategy
    // ------------------------------------------------------------------
    if (/\bmatrix\./.test(body) && jobId != null) {
      const hasMatrix =
        job != null &&
        (job.strategy?.matrix?.fromExpression === true ||
          (job.strategy?.matrix?.dimensions != null &&
            Object.keys(job.strategy.matrix.dimensions).length > 0));

      if (!hasMatrix) {
        emit(
          {
            code: "EXPR001",
            severity: "error",
            source: "semantic",
            title: "matrix context without matrix strategy",
            message: `'matrix' context used in job '${jobId}' which has no matrix strategy.`,
            path,
            docsUrl:
              "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow",
          },
          "matrix",
        );
      }
    }

    // ------------------------------------------------------------------
    // EXPR002 — `needs.<name>.` referencing a job not in the needs array
    // ------------------------------------------------------------------
    const needsMatches = body.matchAll(/\bneeds\.([A-Za-z0-9_-]+)/g);
    for (const match of needsMatches) {
      const neededName = match[1];
      if (!neededName) continue;

      // If we can't determine the owning job, skip (no jobId).
      if (jobId == null || job == null) continue;

      if (!job.needs.includes(neededName)) {
        emit(
          {
            code: "EXPR002",
            severity: "error",
            source: "semantic",
            title: "needs reference not declared",
            message: `references needs.${neededName} but job '${jobId}' does not declare needs: [${neededName}].`,
            path,
            docsUrl:
              "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-jobs-in-a-workflow#defining-prerequisite-jobs",
          },
          neededName,
        );
      }
    }

    // ------------------------------------------------------------------
    // EXPR003 — `steps.<id>.` referencing a non-existent step id
    // ------------------------------------------------------------------
    const stepsMatches = body.matchAll(/\bsteps\.([A-Za-z0-9_-]+)/g);
    for (const match of stepsMatches) {
      const stepId = match[1];
      if (!stepId) continue;

      if (jobId == null || job == null) continue;

      // Only flag when NO step in the job has that id at all (conservative).
      const exists = job.steps.some((s) => s.id === stepId);
      if (!exists) {
        emit(
          {
            code: "EXPR003",
            severity: "warning",
            source: "semantic",
            title: "steps reference to unknown step id",
            message: `references steps.${stepId} but no step with id '${stepId}' exists in job '${jobId}'.`,
            path,
            docsUrl:
              "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs#steps-context",
          },
          stepId,
        );
      }
    }

    // ------------------------------------------------------------------
    // EXPR004 — `inputs.<x>` without workflow_dispatch/workflow_call inputs
    // ------------------------------------------------------------------
    if (/\binputs\./.test(body) && !hasInputTrigger) {
      emit(
        {
          code: "EXPR004",
          severity: "warning",
          source: "semantic",
          title: "inputs context without dispatch/call inputs",
          message:
            "'inputs' context used without workflow_dispatch/workflow_call inputs.",
          path,
          docsUrl:
            "https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#workflow_dispatch",
        },
        "inputs",
      );
    }
  }

  return findings;
};
