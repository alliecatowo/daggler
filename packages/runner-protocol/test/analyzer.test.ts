/* ============================================================================
 * AnalyzerAdapter + NotConnectedError tests.
 * ========================================================================== */

import { describe, expect, it } from "vitest";
import { SAMPLE_BY_ID } from "@daggler/workflow-ir";
import {
  ActAdapter,
  AnalyzerAdapter,
  NotConnectedError,
} from "../src/index.js";

describe("AnalyzerAdapter", () => {
  const adapter = new AnalyzerAdapter();

  it("reports static-analysis capabilities", () => {
    const caps = adapter.capabilities();
    expect(caps.kind).toBe("analyzer");
    expect(caps.authoritative).toBe(false);
    expect(caps.hasAct).toBe(false);
    expect(caps.hasDocker).toBe(false);
    expect(caps.hasGit).toBe(false);
  });

  it('resolves "failure" for the ci-release sample (has POL002/POL007 errors)', async () => {
    const sample = SAMPLE_BY_ID["ci-release"];
    expect(sample).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = await adapter.startRun({
      workflowYaml: sample!.yaml,
      path: sample!.path,
    });

    expect(result.status).toBe("failure");
    expect(result.logs.length).toBeGreaterThan(0);

    // At least one log entry should be an error
    const errors = result.logs.filter((l) => l.level === "error");
    expect(errors.length).toBeGreaterThan(0);

    // Summary should mention errors and a security grade
    expect(result.summary).toMatch(/error/i);
    expect(result.summary).toMatch(/grade/i);
  });

  it('resolves "success" for the minimal sample (clean workflow)', async () => {
    const sample = SAMPLE_BY_ID["minimal"];
    expect(sample).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = await adapter.startRun({
      workflowYaml: sample!.yaml,
      path: sample!.path,
    });

    expect(result.status).toBe("success");
    expect(result.summary).toMatch(/0 errors?/i);
  });

  it("assigns monotonically increasing seq values to log events", async () => {
    const sample = SAMPLE_BY_ID["ci-release"];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = await adapter.startRun({ workflowYaml: sample!.yaml });

    const seqs = result.logs.map((l) => l.seq);
    for (let i = 0; i < seqs.length; i++) {
      expect(seqs[i]).toBe(i);
    }
  });

  it("populates nodePath on log events from diagnostic paths", async () => {
    const sample = SAMPLE_BY_ID["ci-release"];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = await adapter.startRun({ workflowYaml: sample!.yaml });

    // At least some events should carry a nodePath
    const withPath = result.logs.filter((l) => l.nodePath !== undefined);
    expect(withPath.length).toBeGreaterThan(0);
  });
});

describe("ActAdapter", () => {
  const adapter = new ActAdapter();

  it("reports act capabilities (hasAct false until bridge is connected)", () => {
    const caps = adapter.capabilities();
    expect(caps.kind).toBe("act");
    expect(caps.authoritative).toBe(false);
    // hasAct is false because the bridge is not yet connected
    expect(caps.hasAct).toBe(false);
  });

  it("rejects startRun with NotConnectedError", async () => {
    await expect(
      adapter.startRun({ workflowYaml: "name: test\non: push\njobs: {}" }),
    ).rejects.toThrow(NotConnectedError);
  });

  it("NotConnectedError message mentions the daggler bridge", async () => {
    try {
      await adapter.startRun({ workflowYaml: "name: test\non: push\njobs: {}" });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NotConnectedError);
      expect((err as NotConnectedError).message).toMatch(/daggler bridge/i);
    }
  });
});

describe("NotConnectedError", () => {
  it("is instanceof Error", () => {
    const err = new NotConnectedError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotConnectedError);
    expect(err.name).toBe("NotConnectedError");
    expect(err.message).toBe("test");
  });
});
