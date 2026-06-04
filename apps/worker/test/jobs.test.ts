/* ============================================================================
 * @daggler/worker — jobs handler tests.
 *
 * These tests exercise the REAL handlers (parse + validate) against the
 * bundled sample workflows. They verify that:
 *   - validateWorkflowJob surfaces errors on the "ci-release" sample
 *     (supply-chain / unpinned actions, etc.)
 *   - validateWorkflowJob finds 0 errors on the "minimal" (happy-path) sample
 *   - parseWorkflowJob correctly reports 4 jobs for "ci-release"
 * ============================================================================ */

import { describe, it, expect } from "vitest";
import { SAMPLE_BY_ID } from "@daggler/workflow-ir";
import { parseWorkflowJob, validateWorkflowJob } from "../src/jobs.js";

// Pull the samples once — they are static constants, no I/O.
const ciRelease = SAMPLE_BY_ID["ci-release"]!;
const minimal = SAMPLE_BY_ID["minimal"]!;

describe("validateWorkflowJob", () => {
  it("returns errors > 0 for ci-release (supply-chain / unpinned actions)", async () => {
    const result = await validateWorkflowJob({
      yaml: ciRelease.yaml,
      path: ciRelease.path,
    });
    expect(result.errors).toBeGreaterThan(0);
  });

  it("returns 0 errors for the minimal happy-path sample", async () => {
    const result = await validateWorkflowJob({
      yaml: minimal.yaml,
      path: minimal.path,
    });
    expect(result.errors).toBe(0);
  });

  it("returns a valid securityGrade for ci-release", async () => {
    const result = await validateWorkflowJob({
      yaml: ciRelease.yaml,
      path: ciRelease.path,
    });
    expect(["A", "B", "C", "D", "F"]).toContain(result.securityGrade);
  });
});

describe("parseWorkflowJob", () => {
  it("reports jobCount === 4 for ci-release (lint, test, build, deploy)", async () => {
    const result = await parseWorkflowJob({
      yaml: ciRelease.yaml,
      path: ciRelease.path,
    });
    expect(result.jobCount).toBe(4);
  });

  it("reports ok === true for valid YAML", async () => {
    const result = await parseWorkflowJob({
      yaml: ciRelease.yaml,
      path: ciRelease.path,
    });
    expect(result.ok).toBe(true);
  });

  it("reports jobCount === 1 for minimal sample", async () => {
    const result = await parseWorkflowJob({
      yaml: minimal.yaml,
      path: minimal.path,
    });
    expect(result.jobCount).toBe(1);
  });
});
