/* ============================================================================
 * @daggler/validators — graph-semantics layer
 *
 * Detects structural/semantic problems in the workflow's job dependency graph:
 *
 *   SEM001 — needs cycle:      one finding per job in a detected cycle.
 *   SEM002 — dangling needs:   a job references an id that does not exist.
 *   SEM003 — unreachable job:  a job that can never run (not already SEM001/002).
 *   SEM005 — matrix explosion: a matrix that expands to more than 50 combinations.
 *
 * All diagnostics are keyed by jobPath(id) so the orchestrator can resolve YAML
 * source spans. No I/O, no console, fully deterministic.
 * ========================================================================== */

import { jobPath } from "@daggler/workflow-ir";
import type { RawFinding, ValidationContext, ValidationLayer } from "../types.js";

export const checkGraphSemantics: ValidationLayer = (ctx: ValidationContext): RawFinding[] => {
  const { ir, graph } = ctx;
  const findings: RawFinding[] = [];

  // Build a set of all known job ids once — used by SEM002 and SEM003 guards.
  const knownJobIds = new Set<string>(ir.jobs.map((j) => j.id));

  // Track which job ids have already been flagged by SEM001 or SEM002 so that
  // SEM003 does not double-report the same job.
  const flaggedByEarlyRule = new Set<string>();

  // ── SEM001: needs cycle ───────────────────────────────────────────────────
  // Only emit when the graph builder detected a cycle. Emit one finding per
  // job that participates in the cycle so each node lights up in the canvas.
  if (graph.hasCycle && graph.cycleNodes.length > 0) {
    const cycleLabel = graph.cycleNodes.join(" → ");

    for (const nodeId of graph.cycleNodes) {
      flaggedByEarlyRule.add(nodeId);
      findings.push({
        code: "SEM001",
        severity: "error",
        source: "semantic",
        title: "Needs cycle",
        message: `job '${nodeId}' is part of a needs cycle: ${cycleLabel}`,
        path: jobPath(nodeId),
        docsUrl:
          "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-jobs-in-a-workflow#defining-prerequisite-jobs",
      });
    }
  }

  // ── SEM002: dangling needs reference ─────────────────────────────────────
  // For every job, inspect each entry in job.needs. If the referenced id is not
  // in knownJobIds the workflow is broken — the referenced job simply does not
  // exist.
  for (const job of ir.jobs) {
    for (const need of job.needs) {
      if (!knownJobIds.has(need)) {
        flaggedByEarlyRule.add(job.id);
        findings.push({
          code: "SEM002",
          severity: "error",
          source: "semantic",
          title: "Undefined needs reference",
          message: `job '${job.id}' needs '${need}', which is not defined in this workflow`,
          path: jobPath(job.id),
          docsUrl:
            "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-jobs-in-a-workflow#defining-prerequisite-jobs",
        });
      }
    }
  }

  // ── SEM003: unreachable job ───────────────────────────────────────────────
  // The graph builder populates unreachable[] with job ids that can never run.
  // We only emit SEM003 when:
  //   1. The job id is not already flagged by SEM001 or SEM002 (no duplication).
  //   2. All of the job's needs ARE real jobs — if a need is missing (SEM002)
  //      the root cause is the dangling reference, not unreachability per se.
  for (const unreachableId of graph.unreachable) {
    if (flaggedByEarlyRule.has(unreachableId)) continue;

    // Guard: find the corresponding IR job to verify its needs are all real.
    const job = ir.jobs.find((j) => j.id === unreachableId);
    if (!job) continue;

    // Skip if any need is not a real job id — that case is covered by SEM002.
    const allNeedsReal = job.needs.every((n) => knownJobIds.has(n));
    if (!allNeedsReal) continue;

    flaggedByEarlyRule.add(unreachableId);
    findings.push({
      code: "SEM003",
      severity: "warning",
      source: "semantic",
      title: "Unreachable job",
      message: `job '${unreachableId}' can never run because a job it depends on can never complete`,
      path: jobPath(unreachableId),
      docsUrl:
        "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-jobs-in-a-workflow#defining-prerequisite-jobs",
    });
  }

  // ── SEM005: matrix explosion ──────────────────────────────────────────────
  // Inform authors when a matrix strategy expands to an unusually large number
  // of combinations (> 50). This is not an error — just an awareness signal.
  for (const job of ir.jobs) {
    const matrixSize = job.strategy?.matrix?.size;
    if (matrixSize !== undefined && matrixSize > 50) {
      findings.push({
        code: "SEM005",
        severity: "info",
        source: "semantic",
        title: "Large matrix expansion",
        message: `matrix for job '${job.id}' expands to ${matrixSize} combinations`,
        path: jobPath(job.id),
        docsUrl:
          "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow",
      });
    }
  }

  return findings;
};
