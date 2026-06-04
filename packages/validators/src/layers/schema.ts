/* ============================================================================
 * @daggler/validators — layers/schema.ts
 *
 * Structural / schema validation layer. Catches workflow-level and job-level
 * shape problems that would make a workflow fail to parse or queue on GitHub
 * Actions: missing runs-on, empty job step lists, unclassifiable steps, and
 * a workflow with no jobs or no triggers at all.
 *
 * Codes emitted:
 *   SCHEMA001  error    job is missing 'runs-on' (non-reusable job only)
 *   SCHEMA002  error    normal job has no steps
 *   SCHEMA003  warning  step is kind "raw" (neither 'run' nor 'uses')
 *   SCHEMA004  error    workflow has no jobs at all
 *   SCHEMA005  warning  workflow declares no triggers
 *
 * All findings use source "semantic" per the orchestrator contract.
 * ========================================================================== */

import { jobPath, stepPath, workflowField } from "@daggler/workflow-ir";
import type { RawFinding, ValidationContext, ValidationLayer } from "../types.js";

export const checkSchema: ValidationLayer = (ctx: ValidationContext): RawFinding[] => {
  const { ir } = ctx;
  const findings: RawFinding[] = [];

  // ── SCHEMA004: no jobs at all ──────────────────────────────────────────────
  if (ir.jobs.length === 0) {
    findings.push({
      code: "SCHEMA004",
      severity: "error",
      source: "semantic",
      title: "Workflow has no jobs",
      message: "This workflow defines no jobs and will never run.",
      path: workflowField("jobs"),
      docsUrl:
        "https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobs",
    });
  }

  // ── SCHEMA005: no triggers ─────────────────────────────────────────────────
  if (ir.on.length === 0) {
    findings.push({
      code: "SCHEMA005",
      severity: "warning",
      source: "semantic",
      title: "Workflow declares no triggers",
      message: "This workflow has no 'on:' triggers and can never be scheduled or dispatched.",
      path: workflowField("on"),
      docsUrl:
        "https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#on",
    });
  }

  // ── Per-job checks ─────────────────────────────────────────────────────────
  for (const job of ir.jobs) {
    const jp = jobPath(job.id);

    // SCHEMA001: missing runs-on (only applies to non-reusable jobs)
    // A reusable-workflow call job (kind === "reusable" or job.uses is set)
    // is executed on the callee's runner — it does not need its own runs-on.
    if (job.kind !== "reusable" && job.uses === undefined && !job.runsOn) {
      findings.push({
        code: "SCHEMA001",
        severity: "error",
        source: "semantic",
        title: "Job missing 'runs-on'",
        message: `job '${job.id}' is missing 'runs-on'.`,
        path: jp,
        docsUrl:
          "https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idruns-on",
      });
    }

    // SCHEMA002: normal job with zero steps and no uses
    // A reusable-workflow call carries its logic via job.uses — it has no steps
    // by design and should not be flagged.
    if (job.kind === "normal" && job.uses === undefined && job.steps.length === 0) {
      findings.push({
        code: "SCHEMA002",
        severity: "error",
        source: "semantic",
        title: "Job has no steps",
        message: `job '${job.id}' has no steps.`,
        path: jp,
        docsUrl:
          "https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idsteps",
      });
    }

    // SCHEMA003: raw steps (neither 'run' nor 'uses')
    for (const step of job.steps) {
      if (step.kind === "raw") {
        findings.push({
          code: "SCHEMA003",
          severity: "warning",
          source: "semantic",
          title: "Step has neither 'run' nor 'uses'",
          message: "step has neither 'run' nor 'uses'.",
          path: stepPath(job.id, step.index),
          docsUrl:
            "https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idsteps",
        });
      }
    }
  }

  return findings;
};
