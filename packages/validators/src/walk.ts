/* ============================================================================
 * Shared traversal helpers for validator layers. Centralizing IR walking keeps
 * each layer small and consistent — especially expression collection, which
 * several layers need.
 * ========================================================================== */

import {
  parseExpression,
  stepPath,
  workflowField,
  type JobIR,
  type PermissionIR,
  type StepIR,
  type UsesStepIR,
  type WorkflowIR,
} from "@daggler/workflow-ir";

export interface JobStep {
  job: JobIR;
  step: StepIR;
}

export function eachStep(ir: WorkflowIR): JobStep[] {
  const out: JobStep[] = [];
  for (const job of ir.jobs) for (const step of job.steps) out.push({ job, step });
  return out;
}

export function eachUsesStep(
  ir: WorkflowIR,
): Array<{ job: JobIR; step: UsesStepIR }> {
  const out: Array<{ job: JobIR; step: UsesStepIR }> = [];
  for (const job of ir.jobs) {
    for (const step of job.steps) {
      if (step.kind === "uses") out.push({ job, step });
    }
  }
  return out;
}

/** A single `${{ … }}` occurrence, located by node path and field. */
export interface ExpressionUse {
  /** Canonical node path. */
  path: string;
  /** Where it appears, e.g. "if", "run", "runs-on", "with:token", "env:FOO". */
  field: string;
  /** The full raw string the expression sits inside. */
  raw: string;
  /** A single expression body, e.g. `github.event.issue.body`. */
  body: string;
  /** The owning job id, if any. */
  jobId?: string;
}

function pushExprs(
  out: ExpressionUse[],
  path: string,
  field: string,
  raw: unknown,
  jobId?: string,
) {
  if (raw == null) return;
  const expr = parseExpression(raw);
  if (!expr.hasExpression) return;
  for (const body of expr.expressions) {
    out.push({ path, field, raw: expr.raw, body, jobId });
  }
}

/** Every expression occurrence across the whole workflow, with its location. */
export function collectExpressions(ir: WorkflowIR): ExpressionUse[] {
  const out: ExpressionUse[] = [];

  pushExprs(out, workflowField("run-name"), "run-name", ir.runName);
  if (ir.concurrency) {
    pushExprs(out, workflowField("concurrency"), "concurrency", ir.concurrency.group);
  }
  for (const [k, v] of Object.entries(ir.env ?? {})) {
    pushExprs(out, workflowField("env"), `env:${k}`, v);
  }

  for (const job of ir.jobs) {
    const jp = job.path;
    pushExprs(out, jp, "if", job.if, job.id);
    if (Array.isArray(job.runsOn)) {
      job.runsOn.forEach((r) => pushExprs(out, jp, "runs-on", r, job.id));
    } else {
      pushExprs(out, jp, "runs-on", job.runsOn, job.id);
    }
    if (job.concurrency) pushExprs(out, jp, "concurrency", job.concurrency.group, job.id);
    if (job.environment?.url) pushExprs(out, jp, "environment.url", job.environment.url, job.id);
    for (const [k, v] of Object.entries(job.env ?? {})) {
      pushExprs(out, jp, `env:${k}`, v, job.id);
    }
    for (const [k, v] of Object.entries(job.outputs ?? {})) {
      pushExprs(out, jp, `outputs:${k}`, v, job.id);
    }
    for (const [k, v] of Object.entries(job.with ?? {})) {
      pushExprs(out, jp, `with:${k}`, v, job.id);
    }

    for (const step of job.steps) {
      const sp = stepPath(job.id, step.index);
      pushExprs(out, sp, "if", step.if, job.id);
      for (const [k, v] of Object.entries(step.env ?? {})) {
        pushExprs(out, sp, `env:${k}`, v, job.id);
      }
      if (step.kind === "run") {
        pushExprs(out, sp, "run", step.run, job.id);
      } else if (step.kind === "uses") {
        for (const [k, v] of Object.entries(step.with ?? {})) {
          pushExprs(out, sp, `with:${k}`, v, job.id);
        }
      }
    }
  }
  return out;
}

/** Effective permissions for a job (job block overrides workflow block). */
export function effectivePermissions(
  ir: WorkflowIR,
  job: JobIR,
): PermissionIR | undefined {
  return job.permissions ?? ir.permissions;
}

/** True if any trigger event is in the given set. */
export function hasTrigger(ir: WorkflowIR, events: string[]): boolean {
  return ir.on.some((t) => events.includes(t.event));
}

/**
 * Events where the workflow runs with the *base* repo's privileges while
 * potentially handling attacker-controlled content. The classic danger zone.
 */
export const PRIVILEGED_UNTRUSTED_EVENTS = [
  "pull_request_target",
  "workflow_run",
  "issue_comment",
  "issues",
  "discussion",
  "discussion_comment",
];

/** `github.event.*` paths that are attacker-controllable on the danger events. */
export const UNTRUSTED_EVENT_FIELDS = [
  "github.event.issue.title",
  "github.event.issue.body",
  "github.event.pull_request.title",
  "github.event.pull_request.body",
  "github.event.pull_request.head.ref",
  "github.event.pull_request.head.label",
  "github.event.comment.body",
  "github.event.review.body",
  "github.event.discussion.title",
  "github.event.discussion.body",
  "github.head_ref",
];
