/* ============================================================================
 * serialize — WorkflowIR → native GitHub Actions YAML.
 *
 * Used for templates, "new workflow", and export-from-model. We denormalize the
 * IR back into a plain GitHub Actions object and stringify with the `yaml`
 * library so the output is always valid YAML. (In-place edits to *existing*
 * YAML go through applyCommand, which preserves comments and formatting.)
 * ========================================================================== */

import { stringify } from "yaml";
import type {
  JobIR,
  PermissionIR,
  StepIR,
  StrategyIR,
  TriggerIR,
  WorkflowIR,
} from "../ir/types.js";

function denormPermissions(p: PermissionIR): unknown {
  if (p.all) return p.all === "read" ? "read-all" : "write-all";
  if (p.none) return {};
  return p.scopes ?? {};
}

function denormTriggers(triggers: TriggerIR[]): unknown {
  // Always emit map form — it is valid for every event and round-trips cleanly.
  const out: Record<string, unknown> = {};
  for (const t of triggers) {
    if (t.event === "schedule" && t.schedule?.length) {
      out.schedule = t.schedule.map((cron) => ({ cron }));
      continue;
    }
    const cfg: Record<string, unknown> = {};
    if (t.branches) cfg.branches = t.branches;
    if (t.branchesIgnore) cfg["branches-ignore"] = t.branchesIgnore;
    if (t.tags) cfg.tags = t.tags;
    if (t.tagsIgnore) cfg["tags-ignore"] = t.tagsIgnore;
    if (t.paths) cfg.paths = t.paths;
    if (t.pathsIgnore) cfg["paths-ignore"] = t.pathsIgnore;
    if (t.types) cfg.types = t.types;
    if (t.inputs) cfg.inputs = t.inputs;
    if (t.secrets) cfg.secrets = t.secrets;
    if (t.outputs) {
      cfg.outputs = Object.fromEntries(
        Object.entries(t.outputs).map(([k, v]) => [k, { value: v }]),
      );
    }
    out[t.event] = Object.keys(cfg).length ? cfg : null;
  }
  return out;
}

function denormStrategy(s: StrategyIR): unknown {
  const out: Record<string, unknown> = {};
  if (s.matrix) {
    const m: Record<string, unknown> = { ...s.matrix.dimensions };
    if (s.matrix.include) m.include = s.matrix.include;
    if (s.matrix.exclude) m.exclude = s.matrix.exclude;
    out.matrix = m;
  }
  if (s.failFast != null) out["fail-fast"] = s.failFast;
  if (s.maxParallel != null) out["max-parallel"] = s.maxParallel;
  return out;
}

function denormStep(step: StepIR): unknown {
  const out: Record<string, unknown> = {};
  if (step.name) out.name = step.name;
  if (step.id) out.id = step.id;
  if (step.if) out.if = step.if;
  if (step.kind === "uses") {
    out.uses = step.uses;
    if (step.with) out.with = step.with;
  } else if (step.kind === "run") {
    out.run = step.run;
    if (step.shell) out.shell = step.shell;
    if (step.workingDirectory) out["working-directory"] = step.workingDirectory;
  } else {
    Object.assign(out, step.raw as Record<string, unknown>);
  }
  if (step.env) out.env = step.env;
  if (step.continueOnError) out["continue-on-error"] = step.continueOnError;
  if (step.timeoutMinutes != null) out["timeout-minutes"] = step.timeoutMinutes;
  return out;
}

function denormJob(job: JobIR): unknown {
  const out: Record<string, unknown> = {};
  if (job.name) out.name = job.name;
  if (job.uses) {
    out.uses = job.uses.raw;
    if (job.with) out.with = job.with;
    if (job.secrets) out.secrets = job.secrets;
    return out;
  }
  if (job.runsOn) out["runs-on"] = job.runsOn;
  if (job.needs.length) out.needs = job.needs;
  if (job.if) out.if = job.if;
  if (job.permissions) out.permissions = denormPermissions(job.permissions);
  if (job.environment) {
    out.environment = job.environment.url
      ? job.environment
      : job.environment.name;
  }
  if (job.concurrency) out.concurrency = job.concurrency;
  if (job.env) out.env = job.env;
  if (job.strategy) out.strategy = denormStrategy(job.strategy);
  if (job.timeoutMinutes != null) out["timeout-minutes"] = job.timeoutMinutes;
  if (job.continueOnError) out["continue-on-error"] = job.continueOnError;
  if (job.outputs) out.outputs = job.outputs;
  out.steps = job.steps.map(denormStep);
  return out;
}

export function denormalize(ir: WorkflowIR): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (ir.name) out.name = ir.name;
  if (ir.runName) out["run-name"] = ir.runName;
  out.on = denormTriggers(ir.on);
  if (ir.permissions) out.permissions = denormPermissions(ir.permissions);
  if (ir.env) out.env = ir.env;
  if (ir.concurrency) out.concurrency = ir.concurrency;
  if (ir.defaults) {
    out.defaults = {
      run: {
        ...(ir.defaults.shell ? { shell: ir.defaults.shell } : {}),
        ...(ir.defaults.workingDirectory
          ? { "working-directory": ir.defaults.workingDirectory }
          : {}),
      },
    };
  }
  out.jobs = Object.fromEntries(ir.jobs.map((j) => [j.id, denormJob(j)]));
  return out;
}

export function serialize(ir: WorkflowIR): string {
  return stringify(denormalize(ir), { lineWidth: 0, nullStr: "" });
}
