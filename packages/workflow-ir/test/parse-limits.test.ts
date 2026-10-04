import { describe, expect, it } from "vitest";
import { MAX_SOURCE_LENGTH, parseWorkflow } from "../src/index.js";

describe("parseWorkflow resource limits", () => {
  it("fails closed on a billion-laughs alias bomb instead of expanding it", () => {
    const lines = ["x0: &a0 [lol,lol,lol,lol,lol,lol,lol,lol,lol]"];
    for (let i = 1; i < 10; i++) {
      const prev = `*a${i - 1}`;
      lines.push(`x${i}: &a${i} [${Array(9).fill(prev).join(",")}]`);
    }
    const r = parseWorkflow(`on: push\n${lines.join("\n")}\njobs: {}\n`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === "parser/ALIAS_LIMIT")).toBe(true);
    expect(r.ir.jobs).toEqual([]);
  });

  it("still allows ordinary anchors and aliases", () => {
    const r = parseWorkflow(
      "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    env: &e {A: '1'}\n    steps: [{run: x}]\n  b:\n    runs-on: ubuntu-latest\n    env: *e\n    steps: [{run: y}]\n",
    );
    expect(r.ok).toBe(true);
    expect(r.ir.jobs[1]?.env).toEqual({ A: "1" });
  });

  it("rejects oversized sources with a diagnostic", () => {
    const r = parseWorkflow(`# ${"x".repeat(MAX_SOURCE_LENGTH)}\non: push\njobs: {}\n`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("parser/SOURCE_TOO_LARGE");
  });
});
