import { describe, expect, it } from "vitest";
import { parseWorkflow } from "@daggler/workflow-ir";
import { validateWorkflow } from "../src/index.js";

describe("POL009", () => {
  it("is not raised for reusable-workflow call jobs", () => {
    const y = `on: push\njobs:\n  call:\n    permissions:\n      id-token: write\n      contents: read\n    uses: ./.github/workflows/deploy.yml\n`;
    const codes = validateWorkflow(parseWorkflow(y, { path: ".github/workflows/a.yml" })).diagnostics.map((d) => d.code);
    expect(codes).not.toContain("POL009");
  });
  it("still fires for a normal job with id-token and no cloud step", () => {
    const y = `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n    steps:\n      - run: echo\n`;
    const codes = validateWorkflow(parseWorkflow(y, { path: ".github/workflows/a.yml" })).diagnostics.map((d) => d.code);
    expect(codes).toContain("POL009");
  });
});
