import { describe, expect, it } from "vitest";
import { parseWorkflow } from "@daggler/workflow-ir";
import { untrustedFieldsIn, validateWorkflow } from "../src/index.js";

describe("untrustedFieldsIn", () => {
  it.each([
    ["github.event.issue.title", "github.event.issue.title"],
    ["GitHub.Event.Issue.Title", "github.event.issue.title"],
    ["github['event']['issue']['title']", "github.event.issue.title"],
    ['github["event"].issue["title"]', "github.event.issue.title"],
    ["github . event . issue . body", "github.event.issue.body"],
    ["github.event.head_commit.message", "github.event.head_commit.message"],
    ["github.event.commits[0].message", "github.event.commits.*.message"],
    ["github.event.commits[*].author.email", "github.event.commits.*.author.email"],
    ["toJSON(github.event.pull_request.head.ref)", "github.event.pull_request.head.ref"],
    ["github.event.workflow_run.head_branch", "github.event.workflow_run.head_branch"],
    ["github.event.review_comment.body", "github.event.review_comment.body"],
    ["github.event.pages[0].page_name", "github.event.pages.*.page_name"],
    ["github.head_ref", "github.head_ref"],
  ])("detects %s", (body, field) => {
    expect(untrustedFieldsIn(body)).toContain(field);
  });

  it.each([
    "github.event.issue.number",
    "github.event.pull_request.number",
    "github.sha",
    "env.github_head_ref_copy",
    "steps.x.outputs.github.event.issue.title",
    "github.event.commits[0].id",
    "inputs.name",
  ])("ignores %s", (body) => {
    expect(untrustedFieldsIn(body)).toEqual([]);
  });
});

function codes(yaml: string) {
  return validateWorkflow(parseWorkflow(yaml, { path: ".github/workflows/t.yml" }))
    .diagnostics.filter((d) => d.code === "POL008")
    .map((d) => d.message);
}

describe("POL008", () => {
  it("catches bracket syntax in run", () => {
    const y = `on: pull_request\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "\${{ github['event']['pull_request']['title'] }}"\n`;
    expect(codes(y).length).toBe(1);
  });
  it("catches untrusted input in actions/github-script", () => {
    const y = `on: issues\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea\n        with:\n          script: |\n            console.log("\${{ github.event.issue.title }}")\n`;
    const m = codes(y);
    expect(m.length).toBe(1);
    expect(m[0]).toMatch(/github-script/);
  });
  it("does not flag trusted values in github-script, or env-passed values", () => {
    const y = `on: issues\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea\n        env:\n          T: \${{ github.event.issue.title }}\n        with:\n          script: |\n            console.log(process.env.T, \${{ github.event.issue.number }})\n`;
    expect(codes(y)).toEqual([]);
  });
});
