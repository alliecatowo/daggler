/* ============================================================================
 * @daggler/validators — actions layer (source: "actionlint")
 *
 * Validates GitHub Actions `uses:` steps against the curated ACTION_CATALOG.
 * Checks for:
 *   ACT001 — cache support advertised but `cache:` input not provided
 *   ACT002 — deprecated major version ref in use
 *   ACT003 — required action input not provided
 *   ACT004 — unknown input key passed to an official action
 *   ACT005 — job output expression references an undeclared step output
 *
 * Only processes steps where ref.kind === "remote". All array / object index
 * accesses are guarded against undefined (strict + noUncheckedIndexedAccess).
 * ========================================================================== */

import { jobPath, type ActionRef } from "@daggler/workflow-ir";
import type { RawFinding, ValidationLayer } from "../types.js";
import { eachUsesStep } from "../walk.js";
import { lookupActionMeta } from "../policies/catalog.js";

/** Pattern that matches `steps.<id>.outputs.<name>` in job output expressions. */
const STEP_OUTPUT_RE = /steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)/g;

export const checkActions: ValidationLayer = (ctx) => {
  const findings: RawFinding[] = [];

  // ── Per-step checks (ACT001–ACT004) ───────────────────────────────────────
  for (const { job, step } of eachUsesStep(ctx.ir)) {
    // Only analyse remote action references — local / docker are out of scope.
    if (step.ref.kind !== "remote") continue;

    const { owner, repo, ref: refTag } = step.ref;
    const meta = lookupActionMeta(owner, repo);
    const actionName = `${owner ?? ""}/${repo ?? ""}`;
    const stepPath = step.path;

    // ACT001 — action supports built-in dependency caching but `cache:` not set
    if (meta?.supportsCache === true) {
      const withKeys = Object.keys(step.with ?? {});
      if (!withKeys.includes("cache")) {
        findings.push({
          code: "ACT001",
          severity: "info",
          source: "actionlint",
          title: "Built-in cache not enabled",
          message:
            `${actionName} supports built-in dependency caching — add \`cache:\` to speed up this job.`,
          path: stepPath,
          docsUrl:
            "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows",
        });
      }
    }

    // ACT002 — step uses a deprecated major-version ref
    if (meta && refTag) {
      const deprecated = meta.deprecatedRefs ?? [];
      if (deprecated.includes(refTag)) {
        findings.push({
          code: "ACT002",
          severity: "warning",
          source: "actionlint",
          title: "Deprecated action version",
          message:
            `${actionName}@${refTag} is a deprecated major version; upgrade to ${meta.latestMajor ?? "the latest major"}.`,
          path: stepPath,
          docsUrl:
            "https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions",
        });
      }
    }

    // ACT003 — required input not provided
    if (meta) {
      const providedKeys = new Set(Object.keys(step.with ?? {}));
      for (const input of meta.inputs) {
        if (input.required === true && !providedKeys.has(input.name)) {
          findings.push({
            code: "ACT003",
            severity: "warning",
            source: "actionlint",
            title: "Required action input missing",
            message:
              `${actionName} requires input '${input.name}' which is not provided.`,
            path: stepPath,
          });
        }
      }
    }

    // ACT004 — unknown input key passed to an official action (conservative)
    if (meta?.official === true) {
      const knownInputNames = new Set(meta.inputs.map((i) => i.name));
      for (const key of Object.keys(step.with ?? {})) {
        if (!knownInputNames.has(key)) {
          findings.push({
            code: "ACT004",
            severity: "info",
            source: "actionlint",
            title: "Unknown action input",
            message:
              `'${key}' is not a known input of ${actionName}.`,
            path: stepPath,
            docsUrl:
              "https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idstepswith",
          });
        }
      }
    }
  }

  // ── Per-job output checks (ACT005) ────────────────────────────────────────
  //
  // Build a step-id → UsesStepIR index for each job to support O(1) lookup.
  for (const job of ctx.ir.jobs) {
    if (!job.outputs) continue;

    // Index steps in this job by their `id` field.
    const stepById = new Map<string, { uses: string; ref: ActionRef }>();
    for (const step of job.steps) {
      if (step.kind === "uses" && step.id) {
        stepById.set(step.id, { uses: step.uses, ref: step.ref });
      }
    }

    // Scan every job output expression for steps.<id>.outputs.<name>.
    for (const [_outputName, expression] of Object.entries(job.outputs)) {
      if (!expression) continue;

      // Reset lastIndex before each exec loop (global regex).
      STEP_OUTPUT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = STEP_OUTPUT_RE.exec(expression)) !== null) {
        const stepId = match[1];
        const outputName = match[2];
        if (!stepId || !outputName) continue;

        const stepInfo = stepById.get(stepId);
        if (!stepInfo) continue;

        // Only check remote actions against the catalog.
        if (stepInfo.ref.kind !== "remote") continue;

        const meta = lookupActionMeta(stepInfo.ref.owner, stepInfo.ref.repo);
        if (!meta) continue;

        if (!meta.outputs.includes(outputName)) {
          const actionName = `${stepInfo.ref.owner ?? ""}/${stepInfo.ref.repo ?? ""}`;
          findings.push({
            code: "ACT005",
            severity: "warning",
            source: "actionlint",
            title: "Undeclared step output referenced",
            message:
              `job '${job.id}' output reads steps.${stepId}.outputs.${outputName}, but ${actionName} does not declare a '${outputName}' output.`,
            path: jobPath(job.id),
            docsUrl:
              "https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/passing-information-between-jobs",
          });
        }
      }
    }
  }

  return findings;
};
