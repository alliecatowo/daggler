import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/index.js";

const SRC = `on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo 1
  b:
    runs-on: ubuntu-latest
    steps:
      - run: echo 2
`;

describe("applyCommand target validation", () => {
  it("rejects unknown jobs without touching the source", () => {
    for (const cmd of [
      { type: "job.rename", jobId: "nope", name: "x" },
      { type: "job.runsOn", jobId: "nope", runsOn: "x" },
      { type: "job.addNeed", jobId: "a", need: "nope" },
      { type: "step.setRun", jobId: "nope", index: 0, run: "x" },
      { type: "permissions.set", scope: { jobId: "nope" }, key: "contents", level: "read" },
    ] as any[]) {
      const r = applyCommand(SRC, cmd);
      expect(r.ok, cmd.type).toBe(false);
      expect(r.source).toBe(SRC);
    }
  });
  it("rejects out-of-range steps and self-needs", () => {
    expect(applyCommand(SRC, { type: "step.setRun", jobId: "a", index: 5, run: "x" } as any).ok).toBe(false);
    expect(applyCommand(SRC, { type: "step.remove", jobId: "a", index: -1 } as any).ok).toBe(false);
    expect(applyCommand(SRC, { type: "job.addNeed", jobId: "a", need: "a" } as any).ok).toBe(false);
  });
  it("still applies valid commands", () => {
    const r = applyCommand(SRC, { type: "job.addNeed", jobId: "b", need: "a" } as any);
    expect(r.ok).toBe(true);
    expect(r.source).toContain("needs:");
    expect(applyCommand(SRC, { type: "step.setRun", jobId: "a", index: 0, run: "echo z" } as any).ok).toBe(true);
  });
});
