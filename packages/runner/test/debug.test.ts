/* ============================================================================
 * debug.test.ts — pure unit tests for parseRunFailure / mapFailureToSource.
 *
 * NOT gated on any external binary. All inputs are synthetic strings that
 * resemble real `gh run view --log` / `--log-failed` output.
 * ========================================================================== */

import { describe, it, expect } from "vitest";
import { parseRunFailure, mapFailureToSource } from "../src/debug.js";
import { parseWorkflow } from "@daggler/workflow-ir";
import { SourceMap } from "@daggler/workflow-ir";

// ---------------------------------------------------------------------------
// Synthetic log fixtures
// ---------------------------------------------------------------------------

// Resembles the real failed run #26929420930:
//   CI failed at actions/setup-node: ".node-version does not exist"
// Format:  <job>\t<step>\t<timestamp> <message>
const REAL_STYLE_LOG = [
  "check\tSet up job\t2024-01-15T12:00:01.000Z Requested labels: ubuntu-latest",
  "check\tRun actions/checkout@v4\t2024-01-15T12:00:02.000Z Syncing repository: alliecatowo/daggler",
  "check\tRun actions/checkout@v4\t2024-01-15T12:00:03.000Z Getting Git version info",
  "check\tRun actions/setup-node@v4\t2024-01-15T12:00:04.000Z ##[group]Run actions/setup-node@v4",
  "check\tRun actions/setup-node@v4\t2024-01-15T12:00:05.000Z ##[error]The specified node version file at: /home/runner/work/daggler/daggler/.node-version does not exist",
  "check\tRun actions/setup-node@v4\t2024-01-15T12:00:06.000Z ##[endgroup]",
  "check\tComplete job\t2024-01-15T12:00:07.000Z Finishing: Complete job",
].join("\n");

// Simpler format with group headers (some gh versions emit this).
const GROUP_HEADER_LOG = [
  "build\tSet up job\t2024-01-01T00:00:01Z ##[group]Set up job",
  "build\tSet up job\t2024-01-01T00:00:02Z Starting setup",
  "build\tRun actions/setup-node@v4\t2024-01-01T00:00:03Z ##[group]Run actions/setup-node@v4",
  "build\tRun actions/setup-node@v4\t2024-01-01T00:00:04Z ##[error]Some error occurred",
].join("\n");

// Log with annotation-style errors (no ##[error] prefix).
const ANNOTATION_LOG = [
  "lint\tRun npm ci\t2024-01-01T00:00:01Z command not found: pnpm",
  "lint\tRun npm ci\t2024-01-01T00:00:02Z Process completed with exit code 127",
].join("\n");

// Log with no job tabs (bare log-failed style).
const BARE_ERROR_LOG = [
  "##[error]The specified node version file at: /.node-version does not exist",
  "Error: Process completed with exit code 1",
].join("\n");

// ---------------------------------------------------------------------------
// Sample workflow YAML for mapFailureToSource tests
// ---------------------------------------------------------------------------

const CI_YAML = `
name: CI
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
      - name: Install deps
        run: pnpm install --frozen-lockfile
      - name: Run tests
        run: pnpm test
`.trim();

// ---------------------------------------------------------------------------
// (1) parseRunFailure — core extraction
// ---------------------------------------------------------------------------

describe("parseRunFailure", () => {
  it("extracts failedStep containing 'setup-node' from real-style log", () => {
    const result = parseRunFailure(REAL_STYLE_LOG);

    expect(result.failedStep).toBeDefined();
    expect(result.failedStep!.toLowerCase()).toContain("setup-node");
  });

  it("extracts an errorLine containing 'does not exist' from real-style log", () => {
    const result = parseRunFailure(REAL_STYLE_LOG);

    expect(result.errorLines.length).toBeGreaterThan(0);
    const combined = result.errorLines.join(" ");
    expect(combined).toContain("does not exist");
  });

  it("extracts failedJob = 'check' from real-style log", () => {
    const result = parseRunFailure(REAL_STYLE_LOG);

    expect(result.failedJob).toBe("check");
  });

  it("extracts errorLine from bare ##[error] log (no tab columns)", () => {
    const result = parseRunFailure(BARE_ERROR_LOG);

    expect(result.errorLines.length).toBeGreaterThan(0);
    expect(result.errorLines[0]).toContain("does not exist");
  });

  it("captures annotation lines matching known error patterns", () => {
    const result = parseRunFailure(ANNOTATION_LOG);

    expect(result.annotations.length).toBeGreaterThan(0);
    const combined = result.annotations.join(" ");
    expect(combined.toLowerCase()).toMatch(/command not found/);
  });

  it("extracts failedStep from group-header style log", () => {
    const result = parseRunFailure(GROUP_HEADER_LOG);

    expect(result.failedJob).toBe("build");
    expect(result.failedStep).toBeDefined();
    expect(result.failedStep!.toLowerCase()).toContain("setup-node");
    expect(result.errorLines[0]).toBe("Some error occurred");
  });

  it("returns empty arrays and undefined when log has no errors", () => {
    const result = parseRunFailure("check\tSet up job\t2024-01-01T00:00:01Z All good");

    expect(result.failedJob).toBeUndefined();
    expect(result.failedStep).toBeUndefined();
    expect(result.errorLines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (2) mapFailureToSource — IR integration
// ---------------------------------------------------------------------------

describe("mapFailureToSource", () => {
  const parsed = parseWorkflow(CI_YAML, { path: "ci.yml" });
  const sourceMap = new SourceMap(parsed.sourceMap);

  it("resolves the setup-node step to the correct stepPath", () => {
    const failure = parseRunFailure(REAL_STYLE_LOG);
    const loc = mapFailureToSource(failure, parsed.ir, sourceMap);

    // Should find job 'check'.
    expect(loc.jobId).toBe("check");
    expect(loc.jobPath).toBe("job:check");

    // Should find step index 1 (actions/setup-node@v4 is the 2nd step, 0-based).
    expect(loc.stepIndex).toBe(1);
    expect(loc.stepPath).toBe("step:check#1");
  });

  it("summary contains the job name and 'setup-node'", () => {
    const failure = parseRunFailure(REAL_STYLE_LOG);
    const loc = mapFailureToSource(failure, parsed.ir, sourceMap);

    expect(loc.summary.toLowerCase()).toContain("check");
    expect(loc.summary.toLowerCase()).toContain("setup-node");
  });

  it("summary contains the filename ci.yml", () => {
    const failure = parseRunFailure(REAL_STYLE_LOG);
    const loc = mapFailureToSource(failure, parsed.ir, sourceMap);

    expect(loc.summary).toContain("ci.yml");
  });

  it("returns a span with a positive start line", () => {
    const failure = parseRunFailure(REAL_STYLE_LOG);
    const loc = mapFailureToSource(failure, parsed.ir, sourceMap);

    // Either step span or job span should be present.
    expect(loc.span).toBeDefined();
    expect(loc.span!.start.line).toBeGreaterThan(0);
  });

  it("gracefully handles unknown job name", () => {
    const failure: import("../src/debug.js").RunFailure = {
      failedJob: "nonexistent-job",
      failedStep: "Run actions/setup-node@v4",
      errorLines: ["some error"],
      annotations: [],
    };
    const loc = mapFailureToSource(failure, parsed.ir, sourceMap);

    expect(loc.jobId).toBeUndefined();
    expect(loc.summary).toContain("not found");
  });

  it("gracefully handles missing step", () => {
    const failure: import("../src/debug.js").RunFailure = {
      failedJob: "check",
      failedStep: "Run some-completely-unknown-action@v99",
      errorLines: ["some error"],
      annotations: [],
    };
    const loc = mapFailureToSource(failure, parsed.ir, sourceMap);

    expect(loc.jobId).toBe("check");
    expect(loc.stepIndex).toBeUndefined();
    expect(loc.summary).toContain("check");
  });
});
