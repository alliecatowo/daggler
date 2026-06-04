/* ============================================================================
 * @daggler/inventory — core engine.
 *
 * buildWorkflowSummary  — parse + validate one workflow file, extract surface.
 * buildRepoAutomationMap — aggregate across all files in a repository.
 * ========================================================================== */

import {
  parseWorkflow,
  parseExpression,
  type WorkflowIR,
  type StepIR,
} from "@daggler/workflow-ir";
import { validateWorkflow, trustOf } from "@daggler/validators";
import type {
  ActionUsageEntry,
  RepoAutomationMap,
  ThirdPartyActionEntry,
  WorkflowSummary,
} from "./types.js";

/* -------------------------------------------------------------------------- */
/* Expression walking helpers                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Extract all `secrets.X` names from a raw expression body like
 * `secrets.DEPLOY_TOKEN`.  Matches `secrets.<identifier>` patterns.
 */
function secretsFromExpr(expr: string): string[] {
  const out: string[] = [];
  // Match secrets.<NAME> where NAME is a word-boundary identifier
  const re = /\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/**
 * Extract all `env.X` names from a raw expression body like `env.MY_VAR`.
 */
function envFromExpr(expr: string): string[] {
  const out: string[] = [];
  const re = /\benv\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/**
 * Walk all string-valued fields in a step and collect every expression body
 * found, then extract secrets/env names from them.
 */
function collectFromStep(
  step: StepIR,
  secrets: Set<string>,
  envs: Set<string>,
): void {
  function scanString(raw: unknown): void {
    if (typeof raw !== "string") return;
    const parsed = parseExpression(raw);
    for (const expr of parsed.expressions) {
      for (const s of secretsFromExpr(expr)) secrets.add(s);
      for (const e of envFromExpr(expr)) envs.add(e);
    }
  }

  // Scan `if:` conditions
  if (step.if !== undefined) scanString(step.if);

  // Scan env values at step level
  if (step.env !== undefined) {
    for (const v of Object.values(step.env)) scanString(v);
  }

  if (step.kind === "run") {
    scanString(step.run);
  } else if (step.kind === "uses") {
    if (step.with !== undefined) {
      for (const v of Object.values(step.with)) scanString(String(v));
    }
  }
}

/**
 * Walk the full IR and collect all secrets.X and env.X references from
 * expressions anywhere in the workflow.
 */
function collectExpressionRefs(ir: WorkflowIR): {
  secrets: string[];
  envs: string[];
} {
  const secrets = new Set<string>();
  const envs = new Set<string>();

  function scanString(raw: unknown): void {
    if (typeof raw !== "string") return;
    const parsed = parseExpression(raw);
    for (const expr of parsed.expressions) {
      for (const s of secretsFromExpr(expr)) secrets.add(s);
      for (const e of envFromExpr(expr)) envs.add(e);
    }
  }

  // Top-level env
  if (ir.env !== undefined) {
    for (const v of Object.values(ir.env)) scanString(v);
  }

  // Top-level concurrency group
  if (ir.concurrency !== undefined) {
    scanString(ir.concurrency.group);
  }

  for (const job of ir.jobs) {
    // Job-level env
    if (job.env !== undefined) {
      for (const v of Object.values(job.env)) scanString(v);
    }

    // Job if:
    if (job.if !== undefined) scanString(job.if);

    // outputs
    if (job.outputs !== undefined) {
      for (const v of Object.values(job.outputs)) scanString(v);
    }

    // with / secrets for reusable calls
    if (job.with !== undefined) {
      for (const v of Object.values(job.with)) scanString(String(v));
    }
    if (typeof job.secrets === "object" && job.secrets !== null) {
      for (const v of Object.values(job.secrets)) scanString(v);
    }

    // Steps
    for (const step of job.steps) {
      collectFromStep(step, secrets, envs);
    }
  }

  return { secrets: [...secrets].sort(), envs: [...envs].sort() };
}

/* -------------------------------------------------------------------------- */
/* Grade ordering                                                              */
/* -------------------------------------------------------------------------- */

const GRADE_ORDER = ["A", "B", "C", "D", "F"] as const;
type Grade = (typeof GRADE_ORDER)[number];

function isGrade(g: string): g is Grade {
  return (GRADE_ORDER as readonly string[]).includes(g);
}

/**
 * Compare two grade strings.
 * Returns negative if a is better (higher) than b, positive if worse.
 */
function gradeCompare(a: string, b: string): number {
  const ai = isGrade(a) ? GRADE_ORDER.indexOf(a) : GRADE_ORDER.length;
  const bi = isGrade(b) ? GRADE_ORDER.indexOf(b) : GRADE_ORDER.length;
  return ai - bi;
}

/* -------------------------------------------------------------------------- */
/* buildWorkflowSummary                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Parse and validate a single workflow file, returning its automation surface
 * summary.
 *
 * @param path - The canonical file path, e.g. `.github/workflows/ci.yml`.
 * @param yaml - The raw YAML source text.
 */
export function buildWorkflowSummary(path: string, yaml: string): WorkflowSummary {
  const parse = parseWorkflow(yaml, { path });
  const validation = validateWorkflow(parse);
  const ir = parse.ir;

  // Triggers and schedules
  const triggers: string[] = [];
  const schedules: string[] = [];
  for (const t of ir.on) {
    if (!triggers.includes(t.event)) triggers.push(t.event);
    if (t.schedule !== undefined) {
      for (const cron of t.schedule) schedules.push(cron);
    }
  }

  // Step counts
  let stepCount = 0;
  for (const job of ir.jobs) stepCount += job.steps.length;

  // Third-party actions and unpinned count
  const thirdPartyActions: ThirdPartyActionEntry[] = [];
  let unpinnedCount = 0;

  for (const job of ir.jobs) {
    for (const step of job.steps) {
      if (step.kind !== "uses") continue;
      const ref = step.ref;
      // Only remote actions
      if (ref.kind !== "remote") continue;

      const trust = trustOf(ref);
      const official = trust.official;

      // Third-party: not official
      if (!official) {
        thirdPartyActions.push({
          uses: step.uses,
          owner: ref.owner,
          repo: ref.repo,
          ref: ref.ref,
          refKind: ref.refKind,
          trust: trust.level,
          official,
        });
      }

      // Unpinned: refKind is tag or branch (not sha, not unknown), and not official
      if (
        !official &&
        (ref.refKind === "tag" || ref.refKind === "branch")
      ) {
        unpinnedCount++;
      }
    }
  }

  // Expression-level secrets and env references
  const { secrets: secretsReferenced, envs: envReferenced } =
    collectExpressionRefs(ir);

  return {
    path,
    name: ir.name,
    triggers,
    schedules,
    jobCount: ir.jobs.length,
    stepCount,
    thirdPartyActions,
    unpinnedCount,
    secretsReferenced,
    envReferenced,
    security: {
      grade: validation.security.grade,
      score: validation.security.score,
    },
    complexity: validation.complexity.score,
    errorCount: validation.counts.error,
    warningCount: validation.counts.warning,
  };
}

/* -------------------------------------------------------------------------- */
/* buildRepoAutomationMap                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Aggregate multiple workflow summaries into a full repository automation map.
 *
 * @param files - Array of `{ path, yaml }` objects for every workflow file.
 */
export function buildRepoAutomationMap(
  files: Array<{ path: string; yaml: string }>,
): RepoAutomationMap {
  const workflows: WorkflowSummary[] = files.map((f) =>
    buildWorkflowSummary(f.path, f.yaml),
  );

  // Action usage: count occurrences of each unique `uses:` value across all
  // jobs in all workflows.  We track the last-seen trust/official/pinned for
  // display (they are intrinsic to the action ref itself).
  const usageCounts = new Map<
    string,
    { count: number; trust: string; official: boolean; pinned: boolean }
  >();

  // Re-parse each file to collect all uses: entries for the action usage table.
  // We need to count ALL actions (official and third-party) — the summaries
  // only carry thirdPartyActions, so we re-parse to visit every uses: step.
  for (const file of files) {
    const parse = parseWorkflow(file.yaml, { path: file.path });
    for (const job of parse.ir.jobs) {
      for (const step of job.steps) {
        if (step.kind !== "uses") continue;
        const ref = step.ref;
        if (ref.kind !== "remote") continue;

        const trust = trustOf(ref);
        const pinned = ref.refKind === "sha";

        const existing = usageCounts.get(step.uses);
        if (existing !== undefined) {
          existing.count++;
        } else {
          usageCounts.set(step.uses, {
            count: 1,
            trust: trust.level,
            official: trust.official,
            pinned,
          });
        }
      }
    }
  }

  const actionUsage: ActionUsageEntry[] = [...usageCounts.entries()]
    .map(([uses, meta]) => ({ uses, ...meta }))
    .sort((a, b) => b.count - a.count || a.uses.localeCompare(b.uses));

  // Totals
  const allSecrets = new Set<string>();
  for (const w of workflows) {
    for (const s of w.secretsReferenced) allSecrets.add(s);
  }

  let worstGrade = "A";
  let bestGrade = "F";

  for (const w of workflows) {
    const g = w.security.grade;
    if (gradeCompare(g, worstGrade) > 0) worstGrade = g;
    if (gradeCompare(g, bestGrade) < 0) bestGrade = g;
  }

  // Handle edge case: no workflows
  if (workflows.length === 0) {
    worstGrade = "";
    bestGrade = "";
  }

  const totalJobs = workflows.reduce((s, w) => s + w.jobCount, 0);
  const totalUnpinned = workflows.reduce((s, w) => s + w.unpinnedCount, 0);
  const totalComplexity = workflows.reduce((s, w) => s + w.complexity, 0);
  const totalErrors = workflows.reduce((s, w) => s + w.errorCount, 0);
  const totalWarnings = workflows.reduce((s, w) => s + w.warningCount, 0);

  return {
    workflows,
    totals: {
      workflows: workflows.length,
      jobs: totalJobs,
      uniqueActions: usageCounts.size,
      unpinnedActions: totalUnpinned,
      worstGrade,
      bestGrade,
      ciComplexity: totalComplexity,
      errors: totalErrors,
      warnings: totalWarnings,
      secretsUsed: [...allSecrets].sort(),
    },
    actionUsage,
  };
}

