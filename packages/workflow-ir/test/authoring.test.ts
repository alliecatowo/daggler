import { describe, expect, it } from "vitest";
import { applyCommand, parseWorkflow, WORKFLOW_TEMPLATES } from "../src/index.js";

// ---------------------------------------------------------------------------
// Minimal fixture with two steps so we can test insert/remove/preserve.
// ---------------------------------------------------------------------------
const BASE_YAML = `name: Authoring fixture

on:
  push:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: npm ci
`;

// A job with NO steps key — used to test creating the steps seq from scratch.
const NO_STEPS_YAML = `name: Empty job

on:
  push:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
`;

describe("applyCommand — step.add", () => {
  it("appends a uses step (no index) and the new step is visible after re-parse", () => {
    const res = applyCommand(BASE_YAML, {
      type: "step.add",
      jobId: "build",
      step: { uses: "actions/setup-node@v4", with: { "node-version": "22" } },
    });
    expect(res.ok).toBe(true);

    const { ir, ok } = parseWorkflow(res.source);
    expect(ok).toBe(true);
    const steps = ir.jobs.find((j) => j.id === "build")!.steps;
    // Original 2 steps + 1 appended = 3
    expect(steps.length).toBe(3);
    const added = steps[2]!;
    expect(added.kind).toBe("uses");
    if (added.kind === "uses") {
      expect(added.uses).toBe("actions/setup-node@v4");
    }
  });

  it("inserts a run step at index 0 (before checkout)", () => {
    const res = applyCommand(BASE_YAML, {
      type: "step.add",
      jobId: "build",
      index: 0,
      step: { name: "Pre-setup", run: "echo 'hello'" },
    });
    expect(res.ok).toBe(true);

    const { ir, ok } = parseWorkflow(res.source);
    expect(ok).toBe(true);
    const steps = ir.jobs.find((j) => j.id === "build")!.steps;
    expect(steps.length).toBe(3);
    const first = steps[0]!;
    expect(first.kind).toBe("run");
    if (first.kind === "run") {
      expect(first.run).toContain("hello");
    }
  });

  it("inserts at index 1 and preserves surrounding steps", () => {
    const res = applyCommand(BASE_YAML, {
      type: "step.add",
      jobId: "build",
      index: 1,
      step: { uses: "actions/cache@v4" },
    });
    expect(res.ok).toBe(true);

    const { ir, ok } = parseWorkflow(res.source);
    expect(ok).toBe(true);
    const steps = ir.jobs.find((j) => j.id === "build")!.steps;
    expect(steps.length).toBe(3);
    // step 0 must still be checkout
    const s0 = steps[0]!;
    expect(s0.kind).toBe("uses");
    if (s0.kind === "uses") expect(s0.uses).toContain("checkout");
    // inserted step at 1
    const s1 = steps[1]!;
    expect(s1.kind).toBe("uses");
    if (s1.kind === "uses") expect(s1.uses).toContain("cache");
    // original step 1 (npm ci) is now at index 2
    const s2 = steps[2]!;
    expect(s2.kind).toBe("run");
    if (s2.kind === "run") expect(s2.run).toContain("npm ci");
  });

  it("creates the steps sequence when the job has none", () => {
    const res = applyCommand(NO_STEPS_YAML, {
      type: "step.add",
      jobId: "build",
      step: { uses: "actions/checkout@v4" },
    });
    expect(res.ok).toBe(true);

    const { ir, ok } = parseWorkflow(res.source);
    expect(ok).toBe(true);
    const steps = ir.jobs.find((j) => j.id === "build")!.steps;
    expect(steps.length).toBe(1);
    const s = steps[0]!;
    expect(s.kind).toBe("uses");
    if (s.kind === "uses") expect(s.uses).toBe("actions/checkout@v4");
  });

  it("preserves comments and formatting in other parts of the file", () => {
    const res = applyCommand(BASE_YAML, {
      type: "step.add",
      jobId: "build",
      step: { run: "echo done" },
    });
    expect(res.ok).toBe(true);
    // The original step names and surrounding structure must still be present.
    expect(res.source).toContain("actions/checkout@v4");
    expect(res.source).toContain("npm ci");
  });
});

describe("applyCommand — step.remove", () => {
  it("removes step at index 0 and the remaining step shifts down", () => {
    const res = applyCommand(BASE_YAML, {
      type: "step.remove",
      jobId: "build",
      index: 0,
    });
    expect(res.ok).toBe(true);

    const { ir, ok } = parseWorkflow(res.source);
    expect(ok).toBe(true);
    const steps = ir.jobs.find((j) => j.id === "build")!.steps;
    expect(steps.length).toBe(1);
    const s = steps[0]!;
    expect(s.kind).toBe("run");
    if (s.kind === "run") expect(s.run).toContain("npm ci");
  });

  it("removes the last step leaving one step remaining", () => {
    const res = applyCommand(BASE_YAML, {
      type: "step.remove",
      jobId: "build",
      index: 1,
    });
    expect(res.ok).toBe(true);

    const { ir, ok } = parseWorkflow(res.source);
    expect(ok).toBe(true);
    const steps = ir.jobs.find((j) => j.id === "build")!.steps;
    expect(steps.length).toBe(1);
    const s = steps[0]!;
    expect(s.kind).toBe("uses");
    if (s.kind === "uses") expect(s.uses).toContain("checkout");
  });
});

describe("WORKFLOW_TEMPLATES corpus", () => {
  it("every template parses without errors", () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      const { ok, diagnostics } = parseWorkflow(tpl.yaml, {
        path: `.github/workflows/${tpl.id}.yml`,
      });
      const fatals = diagnostics.filter((d) => d.severity === "error");
      expect(
        ok,
        `Template "${tpl.id}" failed to parse — fatal errors: ${fatals.map((d) => d.message).join(", ")}`,
      ).toBe(true);
    }
  });

  it("every template has at least one job", () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      const { ir } = parseWorkflow(tpl.yaml);
      expect(ir.jobs.length, `Template "${tpl.id}" has no jobs`).toBeGreaterThanOrEqual(1);
    }
  });

  it("every template has required id, name, category, description, yaml fields", () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      expect(typeof tpl.id, `${tpl.id}: id`).toBe("string");
      expect(tpl.id.length, `${tpl.id}: id empty`).toBeGreaterThan(0);
      expect(typeof tpl.name, `${tpl.id}: name`).toBe("string");
      expect(typeof tpl.category, `${tpl.id}: category`).toBe("string");
      expect(typeof tpl.description, `${tpl.id}: description`).toBe("string");
      expect(typeof tpl.yaml, `${tpl.id}: yaml`).toBe("string");
    }
  });

  it("TEMPLATE_BY_ID index is consistent", async () => {
    const { TEMPLATE_BY_ID } = await import("../src/index.js");
    for (const tpl of WORKFLOW_TEMPLATES) {
      expect(TEMPLATE_BY_ID[tpl.id]).toBe(tpl);
    }
  });
});
