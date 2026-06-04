import { describe, expect, it } from "vitest";
import { SAMPLE_WORKFLOWS } from "@daggler/workflow-ir";
import {
  buildRepoAutomationMap,
  buildWorkflowSummary,
} from "../src/index.js";

// Build the repo map once — it is pure and deterministic.
const files = SAMPLE_WORKFLOWS.map((s) => ({ path: s.path, yaml: s.yaml }));
const map = buildRepoAutomationMap(files);

// Helper: look up a summary by path
function summaryFor(path: string) {
  const s = map.workflows.find((w) => w.path === path);
  if (s === undefined) throw new Error(`No summary for path: ${path}`);
  return s;
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                      */
/* -------------------------------------------------------------------------- */

describe("RepoAutomationMap — totals", () => {
  it("counts all five sample workflows", () => {
    expect(map.totals.workflows).toBe(5);
  });

  it("totals.workflows matches workflows array length", () => {
    expect(map.workflows).toHaveLength(map.totals.workflows);
  });

  it("totals.jobs is a positive integer", () => {
    expect(map.totals.jobs).toBeGreaterThan(0);
  });

  it("totals.worstGrade is F (pr-preview and triage-agent samples have F)", () => {
    expect(map.totals.worstGrade).toBe("F");
  });

  it("totals.bestGrade is A (the minimal sample earns A)", () => {
    expect(map.totals.bestGrade).toBe("A");
  });

  it("totals.errors is positive (multiple workflows have errors)", () => {
    expect(map.totals.errors).toBeGreaterThan(0);
  });

  it("totals.unpinnedActions is positive", () => {
    expect(map.totals.unpinnedActions).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* CI / Release workflow                                                        */
/* -------------------------------------------------------------------------- */

describe("ci-release summary", () => {
  const s = summaryFor(".github/workflows/ci.yml");

  it("reports the correct name", () => {
    expect(s.name).toBe("CI / Release");
  });

  it("lists push, pull_request, and workflow_dispatch as triggers", () => {
    expect(s.triggers).toContain("push");
    expect(s.triggers).toContain("pull_request");
    expect(s.triggers).toContain("workflow_dispatch");
  });

  it("has no schedules", () => {
    expect(s.schedules).toHaveLength(0);
  });

  it("has 4 jobs", () => {
    expect(s.jobCount).toBe(4);
  });

  it("lists docker/build-push-action as a third-party action", () => {
    const entry = s.thirdPartyActions.find(
      (a) => a.uses === "docker/build-push-action@v5",
    );
    expect(entry).toBeDefined();
    expect(entry!.owner).toBe("docker");
    expect(entry!.repo).toBe("build-push-action");
    expect(entry!.official).toBe(false);
  });

  it("lists aws-actions/configure-aws-credentials as a third-party action", () => {
    const entry = s.thirdPartyActions.find((a) =>
      a.uses.startsWith("aws-actions/configure-aws-credentials"),
    );
    expect(entry).toBeDefined();
  });

  it("has unpinnedCount > 0 (docker@v5 tag + aws-actions@main branch)", () => {
    expect(s.unpinnedCount).toBeGreaterThan(0);
  });

  it("references DEPLOY_ROLE secret", () => {
    expect(s.secretsReferenced).toContain("DEPLOY_ROLE");
  });

  it("has a security grade that is not A (unpinned third-party actions)", () => {
    expect(s.security.grade).not.toBe("A");
  });

  it("reports errorCount > 0 (POL002/POL007 are errors)", () => {
    expect(s.errorCount).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* PR Preview workflow                                                          */
/* -------------------------------------------------------------------------- */

describe("pr-preview summary", () => {
  const s = summaryFor(".github/workflows/pr-preview.yml");

  it("has pull_request_target as trigger", () => {
    expect(s.triggers).toContain("pull_request_target");
  });

  it("lists some-org/deploy-preview as a third-party action", () => {
    const entry = s.thirdPartyActions.find((a) =>
      a.uses.startsWith("some-org/deploy-preview"),
    );
    expect(entry).toBeDefined();
    expect(entry!.official).toBe(false);
  });

  it("references DEPLOY_TOKEN secret", () => {
    expect(s.secretsReferenced).toContain("DEPLOY_TOKEN");
  });

  it("earns grade F (privilege + injection hazards)", () => {
    expect(s.security.grade).toBe("F");
  });
});

/* -------------------------------------------------------------------------- */
/* Triage Agent workflow                                                        */
/* -------------------------------------------------------------------------- */

describe("triage-agent summary", () => {
  const s = summaryFor(".github/workflows/triage-agent.yml");

  it("has issues and issue_comment as triggers", () => {
    expect(s.triggers).toContain("issues");
    expect(s.triggers).toContain("issue_comment");
  });

  it("lists example/ai-agent-action as a third-party action", () => {
    const entry = s.thirdPartyActions.find((a) =>
      a.uses.startsWith("example/ai-agent-action"),
    );
    expect(entry).toBeDefined();
  });

  it("references GITHUB_TOKEN secret", () => {
    expect(s.secretsReferenced).toContain("GITHUB_TOKEN");
  });

  it("earns grade F (agentic injection)", () => {
    expect(s.security.grade).toBe("F");
  });
});

/* -------------------------------------------------------------------------- */
/* Minimal workflow                                                             */
/* -------------------------------------------------------------------------- */

describe("minimal (Hello) summary", () => {
  const s = summaryFor(".github/workflows/hello.yml");

  it("earns grade A", () => {
    expect(s.security.grade).toBe("A");
  });

  it("has no third-party actions", () => {
    expect(s.thirdPartyActions).toHaveLength(0);
  });

  it("has zero errors", () => {
    expect(s.errorCount).toBe(0);
  });

  it("has workflow_dispatch trigger", () => {
    expect(s.triggers).toContain("workflow_dispatch");
  });

  it("has no schedules", () => {
    expect(s.schedules).toHaveLength(0);
  });

  it("has no secrets referenced", () => {
    expect(s.secretsReferenced).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Action usage table                                                           */
/* -------------------------------------------------------------------------- */

describe("actionUsage table", () => {
  it("includes actions/checkout with count > 1", () => {
    const entry = map.actionUsage.find((a) => a.uses.startsWith("actions/checkout"));
    expect(entry).toBeDefined();
    expect(entry!.count).toBeGreaterThan(1);
    expect(entry!.official).toBe(true);
  });

  it("marks actions/checkout as not SHA-pinned (tag ref)", () => {
    const entry = map.actionUsage.find((a) => a.uses.startsWith("actions/checkout"));
    expect(entry).toBeDefined();
    // @v4 is a tag, not a sha
    expect(entry!.pinned).toBe(false);
  });

  it("contains docker/build-push-action in the usage table", () => {
    const entry = map.actionUsage.find((a) =>
      a.uses.startsWith("docker/build-push-action"),
    );
    expect(entry).toBeDefined();
    expect(entry!.official).toBe(false);
  });

  it("uniqueActions total equals actionUsage array length", () => {
    expect(map.totals.uniqueActions).toBe(map.actionUsage.length);
  });
});

/* -------------------------------------------------------------------------- */
/* buildWorkflowSummary — direct API                                           */
/* -------------------------------------------------------------------------- */

describe("buildWorkflowSummary — direct", () => {
  const sample = SAMPLE_WORKFLOWS.find((s) => s.id === "minimal")!;
  const summary = buildWorkflowSummary(sample.path, sample.yaml);

  it("returns the correct path", () => {
    expect(summary.path).toBe(sample.path);
  });

  it("returns the correct name", () => {
    expect(summary.name).toBe("Hello");
  });

  it("complexity is a non-negative number", () => {
    expect(summary.complexity).toBeGreaterThanOrEqual(0);
  });
});
