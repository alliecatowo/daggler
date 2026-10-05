import { describe, expect, it } from "vitest";
import { parseWorkflow, serialize } from "../src/index.js";

const SRC = `name: X
on:
  push:
    branches: [main]
concurrency:
  group: g-\${{ github.ref }}
  cancel-in-progress: true
defaults:
  run:
    shell: bash
    working-directory: app
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    concurrency:
      group: b
      cancel-in-progress: false
    defaults:
      run:
        shell: pwsh
    steps:
      - run: echo hi
  call:
    needs: build
    if: github.ref == 'refs/heads/main'
    uses: org/repo/.github/workflows/r.yml@v1
    permissions:
      contents: write
    with:
      a: 1
    secrets: inherit
`;

describe("serialize round trip", () => {
  const out = serialize(parseWorkflow(SRC, { path: "x.yml" }).ir);
  const again = parseWorkflow(out, { path: "x.yml" });
  const raw = again.ir.raw as any;

  it("keeps concurrency with GitHub's key name", () => {
    expect(raw.concurrency["cancel-in-progress"]).toBe(true);
    expect(out).not.toMatch(/cancelInProgress/);
    expect(raw.jobs.build.concurrency).toEqual({ group: "b", "cancel-in-progress": false });
  });
  it("keeps job and workflow defaults", () => {
    expect(raw.defaults.run).toEqual({ shell: "bash", "working-directory": "app" });
    expect(raw.jobs.build.defaults.run.shell).toBe("pwsh");
  });
  it("keeps needs/if/permissions on reusable-workflow call jobs", () => {
    expect(raw.jobs.call.needs).toEqual(["build"]);
    expect(raw.jobs.call.if).toBe("github.ref == 'refs/heads/main'");
    expect(raw.jobs.call.permissions).toEqual({ contents: "write" });
    expect(raw.jobs.call.secrets).toBe("inherit");
  });
  it("is stable on a second pass", () => {
    expect(serialize(again.ir)).toBe(out);
  });
});
