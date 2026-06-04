import { describe, expect, it } from "vitest";
import { parseWorkflow, SAMPLE_BY_ID } from "@daggler/workflow-ir";
import { validateWorkflow } from "../src/index.js";

function analyze(id: string) {
  const sample = SAMPLE_BY_ID[id]!;
  const result = validateWorkflow(parseWorkflow(sample.yaml, { path: sample.path }));
  return {
    result,
    codes: result.diagnostics.map((d) => d.code),
    byCode: (code: string) => result.diagnostics.filter((d) => d.code === code),
  };
}

describe("CI / Release — supply chain + structure", () => {
  const { result, codes, byCode } = analyze("ci-release");

  it("flags the unpinned third-party tag (docker/build-push-action@v5)", () => {
    expect(codes).toContain("POL002");
    const f = byCode("POL002")[0]!;
    expect(f.severity).toBe("error");
    expect(f.source).toBe("security");
    expect(f.path).toMatch(/^step:build#/);
    expect(f.fix?.pinSha).toBeTruthy();
  });

  it("flags the branch ref (aws-actions/...@main)", () => {
    expect(codes).toContain("POL007");
    expect(byCode("POL007")[0]!.path).toMatch(/^step:deploy#/);
  });

  it("does NOT raise 'no permissions' — the workflow declares them", () => {
    expect(codes).not.toContain("POL001");
  });

  it("does NOT false-positive POL009 — deploy has a real OIDC cloud step", () => {
    expect(codes).not.toContain("POL009");
  });

  it("suggests dependency caching on setup-node", () => {
    expect(codes).toContain("ACT001");
  });

  it("produces a less-than-perfect security grade", () => {
    expect(result.security.grade).not.toBe("A");
    expect(result.security.score).toBeLessThan(100);
  });
});

describe("PR Preview — privilege + injection", () => {
  const { codes } = analyze("pr-preview");

  it("flags pull_request_target with write permissions", () => {
    expect(codes).toContain("POL003");
  });

  it("flags a secret reachable from the untrusted event", () => {
    expect(codes).toContain("POL004");
  });

  it("flags shell interpolation of untrusted PR text", () => {
    expect(codes).toContain("POL008");
  });
});

describe("Triage Agent — agentic workflow injection", () => {
  const { codes, byCode } = analyze("triage-agent");

  it("flags untrusted issue body flowing into an agent prompt", () => {
    expect(codes).toContain("AGENT001");
    expect(byCode("AGENT001")[0]!.source).toBe("security");
  });

  it("flags a broadly-permitted agent (shell/write tools + token)", () => {
    expect(codes).toContain("AGENT002");
  });

  it("flags agent output piped into shell execution", () => {
    expect(codes).toContain("AGENT003");
  });
});

describe("Broken graph — semantics + expressions", () => {
  const { codes, byCode } = analyze("broken-graph");

  it("detects the needs cycle", () => {
    expect(codes).toContain("SEM001");
  });

  it("detects a job that needs a non-existent job", () => {
    expect(codes).toContain("SEM002");
    expect(byCode("SEM002").some((d) => d.message.includes("ghost"))).toBe(true);
  });

  it("detects matrix.* used in a job with no matrix", () => {
    expect(codes).toContain("EXPR001");
  });

  it("detects needs.<job> referenced without that need", () => {
    expect(codes).toContain("EXPR002");
  });

  it("flags the missing top-level permissions block", () => {
    expect(codes).toContain("POL001");
  });
});

describe("Minimal — the happy path", () => {
  const { result } = analyze("minimal");

  it("has no errors", () => {
    expect(result.counts.error).toBe(0);
  });

  it("earns a top security grade", () => {
    expect(result.security.grade).toBe("A");
  });
});

describe("result shape", () => {
  it("every diagnostic carries a resolved span when the node is mapped", () => {
    const { result } = analyze("ci-release");
    const jobOrStep = result.diagnostics.filter(
      (d) => d.path.startsWith("job:") || d.path.startsWith("step:"),
    );
    expect(jobOrStep.length).toBeGreaterThan(0);
    expect(jobOrStep.every((d) => d.span !== undefined)).toBe(true);
  });
});
