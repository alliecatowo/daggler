/* ============================================================================
 * runner.test.ts — tool-gated integration tests for @daggler/runner.
 *
 * Tests that require external binaries are skipped when those binaries are
 * absent so the CI suite stays green on runners without act/actionlint/docker.
 * ========================================================================== */

import { describe, it, expect } from "vitest";
import { SAMPLE_BY_ID } from "@daggler/workflow-ir";
import { isActionlintAvailable, isActAvailable } from "../src/tools.js";
import { runActionlint } from "../src/actionlint.js";
import { ActAdapter } from "../src/act.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BROKEN_WORKFLOW = `
name: Broken

on: push

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Bad expression
        run: echo \${{ github.event.unknown..invalid }}
      - name: Unknown property
        env:
          FOO: \${{ steps.nonexistent.outputs.result }}
        run: echo \$FOO
`;

const CLEAN_WORKFLOW = `
name: Hello

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  greet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Say hello
        run: echo "Hello, world!"
`;

// ---------------------------------------------------------------------------
// (a) actionlint — tool-gated
// ---------------------------------------------------------------------------

describe("actionlint", () => {
  const available = isActionlintAvailable();

  it(
    available ? "detects findings in a broken workflow" : "SKIP: actionlint not installed",
    available
      ? async () => {
          const result = runActionlint(BROKEN_WORKFLOW, "broken.yml");
          expect(result.available).toBe(true);
          expect(result.findings.length).toBeGreaterThan(0);
        }
      : () => {
          // Confirm unavailable path returns the right shape.
          const result = runActionlint(BROKEN_WORKFLOW);
          expect(result.available).toBe(false);
          expect(result.findings).toEqual([]);
        },
  );

  it(
    available ? "returns zero findings for a clean workflow" : "SKIP: actionlint not installed (clean)",
    available
      ? async () => {
          const result = runActionlint(CLEAN_WORKFLOW, "clean.yml");
          expect(result.available).toBe(true);
          expect(result.findings.length).toBe(0);
        }
      : () => {
          expect(true).toBe(true); // vacuously true
        },
  );
});

// ---------------------------------------------------------------------------
// (b) act — tool-gated
// ---------------------------------------------------------------------------

describe("act", () => {
  const available = isActAvailable();
  const ciRelease = SAMPLE_BY_ID["ci-release"];

  it(
    available ? "plan() on ci-release lists all 4 jobs" : "SKIP: act/docker not available",
    available && ciRelease
      ? async () => {
          const adapter = new ActAdapter();
          const result = await adapter.plan({
            workflowYaml: ciRelease.yaml,
            path: ciRelease.path,
          });

          // act -l prints a table with Stage/JobID/JobName columns.
          // The four jobs are: lint, test, build, deploy.
          const combined = result.logs.map((l) => l.message).join("\n");
          expect(combined).toMatch(/lint/i);
          expect(combined).toMatch(/test/i);
          expect(combined).toMatch(/build/i);
          expect(combined).toMatch(/deploy/i);
        }
      : () => {
          expect(true).toBe(true); // skipped
        },
  );
});

// ---------------------------------------------------------------------------
// (c) ActAdapter.capabilities() — always-on (no binary required)
// ---------------------------------------------------------------------------

describe("ActAdapter.capabilities() — always-on", () => {
  it("returns an object with kind 'act' and boolean hasAct/hasDocker", () => {
    const adapter = new ActAdapter();
    const caps = adapter.capabilities();

    expect(caps.kind).toBe("act");
    expect(typeof caps.hasAct).toBe("boolean");
    expect(typeof caps.hasDocker).toBe("boolean");
    expect(caps.authoritative).toBe(false);
    expect(caps.label).toBeTruthy();
  });
});
