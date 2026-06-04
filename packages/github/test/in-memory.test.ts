import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGitHubAdapter } from "../src/in-memory.js";
import type { RepoRef } from "../src/ports.js";

// ---------------------------------------------------------------------------
// Shared seed
// ---------------------------------------------------------------------------

const OWNER = "acme";
const REPO = "my-service";
const DEFAULT_BRANCH = "main";
const CI_PATH = ".github/workflows/ci.yml";
const CI_CONTENT = `name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;

const repo: RepoRef = { owner: OWNER, repo: REPO, defaultBranch: DEFAULT_BRANCH };

function makeAdapter(): InMemoryGitHubAdapter {
  return new InMemoryGitHubAdapter({
    [`${OWNER}/${REPO}`]: {
      defaultBranch: DEFAULT_BRANCH,
      files: {
        [CI_PATH]: CI_CONTENT,
        "README.md": "# my-service\n",
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InMemoryGitHubAdapter", () => {
  let adapter: InMemoryGitHubAdapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  // --- listRepos -----------------------------------------------------------

  describe("listRepos", () => {
    it("returns the seeded repository", async () => {
      const repos = await adapter.listRepos();
      expect(repos).toHaveLength(1);
      const r = repos[0];
      expect(r).toBeDefined();
      expect(r!.owner).toBe(OWNER);
      expect(r!.repo).toBe(REPO);
      expect(r!.defaultBranch).toBe(DEFAULT_BRANCH);
    });

    it("returns empty array when no repos are seeded", async () => {
      const empty = new InMemoryGitHubAdapter();
      expect(await empty.listRepos()).toEqual([]);
    });
  });

  // --- getFile -------------------------------------------------------------

  describe("getFile", () => {
    it("returns the file content and a non-empty sha", async () => {
      const blob = await adapter.getFile(repo, CI_PATH);
      expect(blob.path).toBe(CI_PATH);
      expect(blob.content).toBe(CI_CONTENT);
      expect(blob.sha).toMatch(/^sha-/);
    });

    it("throws NOT_FOUND for a missing file", async () => {
      await expect(adapter.getFile(repo, "does-not-exist.yml")).rejects.toThrow("NOT_FOUND:");
    });

    it("throws NOT_FOUND for a missing ref", async () => {
      await expect(adapter.getFile(repo, CI_PATH, "no-such-branch")).rejects.toThrow("NOT_FOUND:");
    });
  });

  // --- listWorkflowFiles ---------------------------------------------------

  describe("listWorkflowFiles", () => {
    it("returns only files under .github/workflows/", async () => {
      const files = await adapter.listWorkflowFiles(repo);
      expect(files).toContain(CI_PATH);
      // README.md must not appear
      expect(files.every((f) => f.startsWith(".github/workflows/"))).toBe(true);
    });

    it("returns [] when the workflows directory is empty", async () => {
      const a = new InMemoryGitHubAdapter({
        "acme/empty": { files: { "README.md": "hi" } },
      });
      const files = await a.listWorkflowFiles({ owner: "acme", repo: "empty" });
      expect(files).toEqual([]);
    });
  });

  // --- createBranch --------------------------------------------------------

  describe("createBranch", () => {
    it("creates a branch pointing at the supplied sha", async () => {
      // Get the default branch sha via a workaround: commit to get the tip sha.
      // Simpler: use the sha we know from a getFile call.
      const blob = await adapter.getFile(repo, CI_PATH);
      const newBranch = await adapter.createBranch(repo, "feature/my-change", blob.sha);
      expect(newBranch.name).toBe("feature/my-change");
      expect(newBranch.sha).toBe(blob.sha);
    });

    it("throws CONFLICT when the branch already exists", async () => {
      const blob = await adapter.getFile(repo, CI_PATH);
      await adapter.createBranch(repo, "dup-branch", blob.sha);
      await expect(adapter.createBranch(repo, "dup-branch", blob.sha)).rejects.toThrow("CONFLICT:");
    });
  });

  // --- commitFile ----------------------------------------------------------

  describe("commitFile", () => {
    it("writes new content and returns a new sha", async () => {
      const blob = await adapter.getFile(repo, CI_PATH);
      await adapter.createBranch(repo, "feature/edit", blob.sha);

      const updatedContent = CI_CONTENT + "\n# edited\n";
      const result = await adapter.commitFile(
        repo,
        "feature/edit",
        CI_PATH,
        updatedContent,
        "chore: update CI",
      );

      expect(result.content).toBe(updatedContent);
      expect(result.sha).not.toBe(blob.sha);
    });

    it("reflects the update via getFile", async () => {
      const blob = await adapter.getFile(repo, CI_PATH);
      await adapter.createBranch(repo, "feature/reflect", blob.sha);
      const newContent = "name: Updated\n";
      await adapter.commitFile(repo, "feature/reflect", CI_PATH, newContent, "update");
      // getFile on the default branch still sees the old content (branch isolation).
      const defaultBlob = await adapter.getFile(repo, CI_PATH, DEFAULT_BRANCH);
      expect(defaultBlob.content).toBe(CI_CONTENT);
      // The adapter is branch-agnostic for file reads (single file map), so a
      // read without a ref still sees the latest write across all branches.
      const latestBlob = await adapter.getFile(repo, CI_PATH);
      expect(latestBlob.content).toBe(newContent);
    });

    it("throws NOT_FOUND when committing to a non-existent branch", async () => {
      await expect(
        adapter.commitFile(repo, "ghost-branch", CI_PATH, "x", "msg"),
      ).rejects.toThrow("NOT_FOUND:");
    });

    it("can create a new file that didn't exist before", async () => {
      const blob = await adapter.getFile(repo, CI_PATH);
      await adapter.createBranch(repo, "feature/new-file", blob.sha);
      const result = await adapter.commitFile(
        repo,
        "feature/new-file",
        ".github/workflows/release.yml",
        "name: Release\n",
        "feat: add release workflow",
      );
      expect(result.path).toBe(".github/workflows/release.yml");
    });
  });

  // --- openPullRequest -----------------------------------------------------

  describe("openPullRequest", () => {
    it("returns an incrementing PR number and a plausible URL", async () => {
      const blob = await adapter.getFile(repo, CI_PATH);
      await adapter.createBranch(repo, "feature/pr-test", blob.sha);

      const pr = await adapter.openPullRequest(
        repo,
        "feature/pr-test",
        DEFAULT_BRANCH,
        "My PR",
        "## Summary\n- did stuff",
      );

      expect(pr.number).toBeGreaterThan(0);
      expect(pr.url).toContain(`${OWNER}/${REPO}/pull/${pr.number}`);
      expect(pr.headRef).toBe("feature/pr-test");
      expect(pr.baseRef).toBe(DEFAULT_BRANCH);
    });

    it("increments the PR number across calls", async () => {
      const blob = await adapter.getFile(repo, CI_PATH);
      await adapter.createBranch(repo, "feature/a", blob.sha);
      await adapter.createBranch(repo, "feature/b", blob.sha);

      const pr1 = await adapter.openPullRequest(repo, "feature/a", DEFAULT_BRANCH, "A", "");
      const pr2 = await adapter.openPullRequest(repo, "feature/b", DEFAULT_BRANCH, "B", "");

      expect(pr2.number).toBe(pr1.number + 1);
    });

    it("throws CONFLICT when an identical head→base PR exists", async () => {
      const blob = await adapter.getFile(repo, CI_PATH);
      await adapter.createBranch(repo, "feature/conflict", blob.sha);
      await adapter.openPullRequest(repo, "feature/conflict", DEFAULT_BRANCH, "First", "");
      await expect(
        adapter.openPullRequest(repo, "feature/conflict", DEFAULT_BRANCH, "Dupe", ""),
      ).rejects.toThrow("CONFLICT:");
    });

    it("throws NOT_FOUND when head ref does not exist", async () => {
      await expect(
        adapter.openPullRequest(repo, "ghost-head", DEFAULT_BRANCH, "PR", ""),
      ).rejects.toThrow("NOT_FOUND:");
    });
  });

  // --- Full round-trip -----------------------------------------------------

  describe("round-trip: createBranch → commitFile → openPullRequest", () => {
    it("works end-to-end", async () => {
      // 1. Get the tip sha of main to branch from.
      const ciBlob = await adapter.getFile(repo, CI_PATH);

      // 2. Create a feature branch.
      const branch = await adapter.createBranch(repo, "feature/round-trip", ciBlob.sha);
      expect(branch.name).toBe("feature/round-trip");

      // 3. Update the workflow file on that branch.
      const edited = CI_CONTENT + "\n  # round-trip edit\n";
      const committed = await adapter.commitFile(
        repo,
        "feature/round-trip",
        CI_PATH,
        edited,
        "chore: round-trip edit",
      );
      expect(committed.content).toBe(edited);
      expect(committed.sha).not.toBe(ciBlob.sha);

      // 4. Open a pull request.
      const pr = await adapter.openPullRequest(
        repo,
        "feature/round-trip",
        DEFAULT_BRANCH,
        "Round-trip PR",
        "Automated by Daggler.",
      );
      expect(pr.number).toBeGreaterThan(0);
      expect(pr.headRef).toBe("feature/round-trip");
      expect(pr.baseRef).toBe(DEFAULT_BRANCH);
      expect(pr.url).toMatch(/\/pull\/\d+$/);
    });
  });

  // --- listWorkflowRuns / dispatchWorkflow ---------------------------------

  describe("listWorkflowRuns", () => {
    it("returns [] before any runs are dispatched", async () => {
      expect(await adapter.listWorkflowRuns(repo)).toEqual([]);
    });

    it("records a run after dispatchWorkflow and lists it most-recent-first", async () => {
      await adapter.dispatchWorkflow(repo, CI_PATH, DEFAULT_BRANCH);
      await adapter.dispatchWorkflow(repo, CI_PATH, DEFAULT_BRANCH);

      const runs = await adapter.listWorkflowRuns(repo);
      expect(runs).toHaveLength(2);
      // Most recent first (highest id first).
      expect(runs[0]!.id).toBeGreaterThan(runs[1]!.id);
      expect(runs[0]!.event).toBe("workflow_dispatch");
      expect(runs[0]!.status).toBe("queued");
      expect(runs[0]!.conclusion).toBeNull();
    });
  });

  describe("dispatchWorkflow", () => {
    it("throws NOT_FOUND for a missing ref", async () => {
      await expect(
        adapter.dispatchWorkflow(repo, CI_PATH, "no-such-ref"),
      ).rejects.toThrow("NOT_FOUND:");
    });

    it("throws NOT_FOUND for a missing workflow file", async () => {
      await expect(
        adapter.dispatchWorkflow(repo, ".github/workflows/missing.yml", DEFAULT_BRANCH),
      ).rejects.toThrow("NOT_FOUND:");
    });
  });

  describe("resolveWorkflowRun (test helper)", () => {
    it("transitions a run to completed with the given conclusion", async () => {
      await adapter.dispatchWorkflow(repo, CI_PATH, DEFAULT_BRANCH);
      const [run] = await adapter.listWorkflowRuns(repo);
      expect(run).toBeDefined();

      adapter.resolveWorkflowRun(repo, run!.id, "success");
      const [updated] = await adapter.listWorkflowRuns(repo);
      expect(updated!.status).toBe("completed");
      expect(updated!.conclusion).toBe("success");
    });
  });

  // --- Error surface for unknown repo --------------------------------------

  describe("error handling for unknown repo", () => {
    it("throws NOT_FOUND when accessing a repo not in the adapter", async () => {
      const ghost: RepoRef = { owner: "ghost", repo: "repo" };
      await expect(adapter.getFile(ghost, "any.txt")).rejects.toThrow("NOT_FOUND:");
      await expect(adapter.listWorkflowFiles(ghost)).rejects.toThrow("NOT_FOUND:");
      await expect(adapter.createBranch(ghost, "b", "sha-x")).rejects.toThrow("NOT_FOUND:");
      await expect(adapter.listWorkflowRuns(ghost)).rejects.toThrow("NOT_FOUND:");
    });
  });
});
