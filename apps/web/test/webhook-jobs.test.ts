import { describe, expect, it } from "vitest";
import { locateWorkflows, planWebhookJobs } from "../src/lib/webhook-jobs";

const YAML = "on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";

function reader(files: Record<string, string>) {
  return {
    async listWorkflowFiles() {
      return Object.keys(files);
    },
    async getFile(_r: unknown, path: string) {
      if (!(path in files)) throw new Error("NOT_FOUND");
      return { path, content: files[path]! };
    },
  };
}

const push = {
  after: "abc1234def",
  repository: { full_name: "o/r" },
  commits: [
    { added: [".github/workflows/ci.yml", "README.md"], modified: [] },
    { added: [], modified: [".github/workflows/ci.yml", ".github/workflows/sub/x.yml"] },
  ],
};

describe("planWebhookJobs", () => {
  it("push: one payload per changed workflow file with yaml and path", async () => {
    const plan = await planWebhookJobs(
      "push",
      ["sync.workflowFiles", "validate.workflow"],
      push,
      reader({ ".github/workflows/ci.yml": YAML }),
    );
    expect(plan).toEqual([
      { job: "validate.workflow", payload: { yaml: YAML, path: ".github/workflows/ci.yml" } },
    ]);
  });

  it("pull_request: lists workflows at the head sha", async () => {
    const pr = { pull_request: { head: { sha: "deadbeef1", repo: { full_name: "fork/r" } } } };
    const plan = await planWebhookJobs(
      "pull_request",
      ["validate.workflow", "parse.workflow"],
      pr,
      reader({ ".github/workflows/a.yml": YAML }),
    );
    expect(plan.map((p) => p.job)).toEqual(["validate.workflow", "parse.workflow"]);
    expect(plan[0]!.payload.path).toBe(".github/workflows/a.yml");
  });

  it("skips branch deletes, bad slugs and hostile refs", async () => {
    const r = reader({ ".github/workflows/ci.yml": YAML });
    expect(await planWebhookJobs("push", ["validate.workflow"], { ...push, after: "0000000" }, r)).toEqual([]);
    expect(
      await planWebhookJobs("push", ["validate.workflow"], { ...push, repository: { full_name: "../x/y" } }, r),
    ).toEqual([]);
    expect(await planWebhookJobs("push", ["validate.workflow"], { ...push, after: "--help" }, r)).toEqual([]);
    expect(await planWebhookJobs("push", ["validate.workflow"], null, r)).toEqual([]);
  });

  it("ignores stub-only job lists and unknown events", async () => {
    const r = reader({});
    expect(await planWebhookJobs("installation", ["sync.installation"], {}, r)).toEqual([]);
    expect(locateWorkflows("ping", {})).toBeUndefined();
  });
});
