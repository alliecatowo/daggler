/**
 * Simulator proof: imports @daggler/simulate and @daggler/workflow-ir,
 * runs simulateEvent on ci-release for:
 *   1. {event:"push", ref:"refs/heads/main"}   — should trigger
 *   2. {event:"push", ref:"refs/heads/feature"} — should NOT trigger via push
 */

import { simulateEvent } from "./packages/simulate/src/index.js";
import { parseWorkflow, SAMPLE_BY_ID } from "./packages/workflow-ir/src/index.js";

const sample = SAMPLE_BY_ID["ci-release"];
if (!sample) {
  console.error("ERROR: ci-release sample not found");
  process.exit(1);
}

const { ir, ok, errors } = parseWorkflow(sample.yaml, { path: sample.path });
if (!ok) {
  console.error("ERROR: parseWorkflow failed:", errors);
  process.exit(1);
}

// Test 1: push to main — should trigger
const mainResult = simulateEvent(ir, { event: "push", ref: "refs/heads/main" });

console.log("=== Test 1: push to refs/heads/main ===");
console.log("  triggered:", mainResult.triggered);
console.log("  triggerReason:", mainResult.triggerReason);
console.log("  matchedTrigger:", mainResult.matchedTrigger);
console.log("  per-job decisions:");
for (const [jobId, dec] of Object.entries(mainResult.jobs)) {
  console.log(`    ${jobId}: ${dec.decision} — ${dec.reason}`);
}

// Test 2: push to feature — should NOT trigger via push (branches: [main] filter)
const featureResult = simulateEvent(ir, { event: "push", ref: "refs/heads/feature" });

console.log("");
console.log("=== Test 2: push to refs/heads/feature ===");
console.log("  triggered:", featureResult.triggered);
console.log("  triggerReason:", featureResult.triggerReason);
console.log("  per-job decisions:");
for (const [jobId, dec] of Object.entries(featureResult.jobs)) {
  console.log(`    ${jobId}: ${dec.decision} — ${dec.reason}`);
}

// Assertions
if (!mainResult.triggered) {
  console.error("\nFAIL: main branch push should trigger workflow");
  process.exit(1);
}

const allRun = Object.values(mainResult.jobs).every((d) => d.decision === "run");
if (!allRun) {
  console.error("\nFAIL: all jobs should be 'run' for triggered main push");
  process.exit(1);
}

if (featureResult.triggered) {
  console.error("\nFAIL: feature branch push should NOT trigger workflow (push trigger only allows main)");
  process.exit(1);
}

const allSkip = Object.values(featureResult.jobs).every((d) => d.decision === "skip");
if (!allSkip) {
  console.error("\nFAIL: all jobs should be 'skip' when workflow is not triggered");
  process.exit(1);
}

console.log("");
console.log("=== All assertions passed ===");
console.log("  - main push: triggered=true, all jobs=run");
console.log("  - feature push: triggered=false, all jobs=skip");
