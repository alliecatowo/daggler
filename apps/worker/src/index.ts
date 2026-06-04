/* ============================================================================
 * @daggler/worker — entry point / dev runner.
 *
 * In PRODUCTION this file is replaced by a Graphile Worker bootstrap that calls
 * graphile-worker's run() with a task list built from JOB_REGISTRY, draining
 * the "daggler_jobs" Postgres queue. The worker process stays alive and picks
 * up jobs as they are enqueued by the web app or CLI.
 *
 * For local development / smoke-testing, main() demonstrates the real path by
 * running the "validate.workflow" job against the bundled "ci-release" sample
 * and printing the result to stdout.
 * ============================================================================ */

import { SAMPLE_BY_ID } from "@daggler/workflow-ir";
import { validateWorkflowJob } from "./jobs.js";
import { JOB_NAMES } from "./registry.js";

async function main(): Promise<void> {
  console.log("=== @daggler/worker (dev mode) ===");
  console.log(
    "In production, Graphile Worker drains JOB_REGISTRY from Postgres.",
  );
  console.log(`Registered jobs (${JOB_NAMES.length}):`, JOB_NAMES.join(", "));
  console.log();

  // --- Real path demo: validate the bundled "ci-release" sample ---
  const sample = SAMPLE_BY_ID["ci-release"];
  if (!sample) {
    console.error("ci-release sample not found in SAMPLE_BY_ID — check @daggler/workflow-ir.");
    process.exit(1);
  }

  console.log(`Running validateWorkflowJob on sample: "${sample.name}" (${sample.path})`);

  const result = await validateWorkflowJob({ yaml: sample.yaml, path: sample.path });

  console.log("Validation result:");
  console.log(`  errors:        ${result.errors}`);
  console.log(`  warnings:      ${result.warnings}`);
  console.log(`  infos:         ${result.infos}`);
  console.log(`  securityGrade: ${result.securityGrade}`);
  console.log();
  console.log("Done.");
}

main().catch((err: unknown) => {
  console.error("worker crashed:", err);
  process.exit(1);
});
