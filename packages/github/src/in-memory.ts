/**
 * InMemoryGitHubAdapter — a faithful in-memory implementation of
 * GitHubRepositoryPort, useful for unit tests and local demo mode.
 *
 * - No network access, no Octokit, no credentials required.
 * - All state lives in plain Maps; mutations are reflected immediately.
 * - SHAs are deterministic fakes: sha-<counter> strings. They are unique
 *   per operation but are NOT real git hashes.
 * - PR numbers are auto-incrementing per adapter instance.
 */

import type {
  BranchRef,
  FileBlob,
  GitHubRepositoryPort,
  PullRequestRef,
  RepoRef,
  WorkflowRunRef,
} from "./ports.js";

// ---------------------------------------------------------------------------
// Seed types
// ---------------------------------------------------------------------------

/** Shape of one repository in the seed data passed to the constructor. */
export interface RepoSeed {
  /** Default branch name. Defaults to "main" when omitted. */
  defaultBranch?: string;
  /**
   * Initial file tree: keys are repo-relative paths, values are file content.
   * e.g. { ".github/workflows/ci.yml": "name: CI\n..." }
   */
  files: Record<string, string>;
}

/** Seed map: keys are "owner/repo" full names. */
export type AdapterSeed = Record<string, RepoSeed>;

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface StoredFile {
  content: string;
  sha: string;
}

interface RepoState {
  owner: string;
  repo: string;
  defaultBranch: string;
  /**
   * Global file map: always reflects the latest write across all branches.
   * Used when getFile is called without an explicit ref.
   */
  files: Map<string, StoredFile>;
  /**
   * Per-branch file snapshots: branch-name → (path → StoredFile).
   * Populated when a branch is created (copy of the global file map at that
   * point) and updated when commitFile is called on that branch.
   * Used when getFile is called with an explicit ref.
   */
  branchFiles: Map<string, Map<string, StoredFile>>;
  /** branch-name → commit SHA */
  branches: Map<string, string>;
  pullRequests: PullRequestRef[];
  workflowRuns: WorkflowRunRef[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKFLOWS_PREFIX = ".github/workflows/";

let _globalCounter = 0;
function nextSha(): string {
  _globalCounter += 1;
  return `sha-${_globalCounter.toString().padStart(6, "0")}`;
}

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class InMemoryGitHubAdapter implements GitHubRepositoryPort {
  /** "owner/repo" → RepoState */
  private readonly repos: Map<string, RepoState> = new Map();
  private _nextPrNumber = 1;
  private _nextRunId = 1;

  constructor(seed: AdapterSeed = {}) {
    for (const [fullName, repoSeed] of Object.entries(seed)) {
      const slashIdx = fullName.indexOf("/");
      if (slashIdx === -1) {
        throw new Error(
          `InMemoryGitHubAdapter: seed key "${fullName}" must be in "owner/repo" format`,
        );
      }
      const owner = fullName.slice(0, slashIdx);
      const repo = fullName.slice(slashIdx + 1);
      const defaultBranch = repoSeed.defaultBranch ?? "main";

      const files = new Map<string, StoredFile>();
      for (const [path, content] of Object.entries(repoSeed.files)) {
        files.set(path, { content, sha: nextSha() });
      }

      // The default branch tip SHA — use a stable fake derived from the seed.
      const defaultBranchSha = nextSha();
      const branches = new Map<string, string>([[defaultBranch, defaultBranchSha]]);

      // Snapshot the initial file tree for the default branch.
      const defaultBranchSnapshot = new Map<string, StoredFile>(files);
      const branchFiles = new Map<string, Map<string, StoredFile>>([
        [defaultBranch, defaultBranchSnapshot],
      ]);

      this.repos.set(fullName, {
        owner,
        repo,
        defaultBranch,
        files,
        branchFiles,
        branches,
        pullRequests: [],
        workflowRuns: [],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private getRepoState(repo: RepoRef): RepoState {
    const state = this.repos.get(repoKey(repo));
    if (state === undefined) {
      throw new Error(`NOT_FOUND: repository "${repoKey(repo)}" does not exist in this adapter`);
    }
    return state;
  }

  private resolveRef(state: RepoState, ref: string | undefined): string {
    const effectiveRef = ref ?? state.defaultBranch;
    const sha = state.branches.get(effectiveRef);
    if (sha === undefined) {
      throw new Error(
        `NOT_FOUND: ref "${effectiveRef}" does not exist in repository "${state.owner}/${state.repo}"`,
      );
    }
    return sha;
  }

  // -------------------------------------------------------------------------
  // GitHubRepositoryPort implementation
  // -------------------------------------------------------------------------

  async listRepos(): Promise<RepoRef[]> {
    const result: RepoRef[] = [];
    for (const state of this.repos.values()) {
      result.push({
        owner: state.owner,
        repo: state.repo,
        defaultBranch: state.defaultBranch,
      });
    }
    return result;
  }

  async getFile(repo: RepoRef, path: string, ref?: string): Promise<FileBlob> {
    const state = this.getRepoState(repo);
    // Validate that the ref exists (throws NOT_FOUND if not).
    this.resolveRef(state, ref);

    // When an explicit ref is provided, use the branch-isolated file snapshot.
    // When no ref is provided, fall back to the global file map (latest write
    // across all branches — the adapter is intentionally branch-agnostic for
    // unref'd reads, as noted in the class-level comment).
    const fileMap =
      ref !== undefined
        ? (state.branchFiles.get(ref) ?? state.files)
        : state.files;

    const stored = fileMap.get(path);
    if (stored === undefined) {
      throw new Error(
        `NOT_FOUND: file "${path}" does not exist in "${repoKey(repo)}" at ref "${ref ?? state.defaultBranch}"`,
      );
    }
    return { path, content: stored.content, sha: stored.sha };
  }

  async listWorkflowFiles(repo: RepoRef, ref?: string): Promise<string[]> {
    const state = this.getRepoState(repo);
    // Validate ref exists.
    this.resolveRef(state, ref);

    // Use branch-isolated snapshot when an explicit ref is provided.
    const fileMap =
      ref !== undefined
        ? (state.branchFiles.get(ref) ?? state.files)
        : state.files;

    const results: string[] = [];
    for (const path of fileMap.keys()) {
      if (path.startsWith(WORKFLOWS_PREFIX) && path.endsWith(".yml")) {
        results.push(path);
      }
      // Also capture .yaml extensions.
      if (path.startsWith(WORKFLOWS_PREFIX) && path.endsWith(".yaml")) {
        results.push(path);
      }
    }
    return results.sort();
  }

  async createBranch(repo: RepoRef, name: string, fromSha: string): Promise<BranchRef> {
    const state = this.getRepoState(repo);

    if (state.branches.has(name)) {
      throw new Error(
        `CONFLICT: branch "${name}" already exists in "${repoKey(repo)}"`,
      );
    }

    // Verify fromSha is a known branch tip or loosely accepted as an opaque SHA.
    // In a real adapter we'd validate against the git graph; here we trust the caller
    // but ensure the provided sha is non-empty.
    if (!fromSha || fromSha.trim() === "") {
      throw new Error(`NOT_FOUND: fromSha must be a non-empty SHA string`);
    }

    state.branches.set(name, fromSha);

    // Snapshot the current global file map for this new branch, so that
    // getFile(repo, path, newBranchName) reflects the files at branch-creation time.
    state.branchFiles.set(name, new Map<string, StoredFile>(state.files));

    return { name, sha: fromSha };
  }

  async commitFile(
    repo: RepoRef,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<FileBlob> {
    const state = this.getRepoState(repo);

    if (!state.branches.has(branch)) {
      throw new Error(
        `NOT_FOUND: branch "${branch}" does not exist in "${repoKey(repo)}"`,
      );
    }

    // message is accepted but not stored in this fake (no commit log).
    void message;

    const newSha = nextSha();
    const newCommitSha = nextSha();

    const storedFile: StoredFile = { content, sha: newSha };

    // Update the global (latest-write) file map.
    state.files.set(path, storedFile);

    // Update the branch-isolated snapshot for this branch.
    let branchSnapshot = state.branchFiles.get(branch);
    if (branchSnapshot === undefined) {
      branchSnapshot = new Map<string, StoredFile>(state.files);
      state.branchFiles.set(branch, branchSnapshot);
    }
    branchSnapshot.set(path, storedFile);

    // Advance the branch tip to the new commit.
    state.branches.set(branch, newCommitSha);

    return { path, content, sha: newSha };
  }

  async openPullRequest(
    repo: RepoRef,
    headRef: string,
    baseRef: string,
    title: string,
    body: string,
  ): Promise<PullRequestRef> {
    const state = this.getRepoState(repo);

    if (!state.branches.has(headRef)) {
      throw new Error(
        `NOT_FOUND: head ref "${headRef}" does not exist in "${repoKey(repo)}"`,
      );
    }
    if (!state.branches.has(baseRef)) {
      throw new Error(
        `NOT_FOUND: base ref "${baseRef}" does not exist in "${repoKey(repo)}"`,
      );
    }

    // Check for an existing open PR with the same head → base pair.
    const duplicate = state.pullRequests.find(
      (pr) => pr.headRef === headRef && pr.baseRef === baseRef,
    );
    if (duplicate !== undefined) {
      throw new Error(
        `CONFLICT: a pull request from "${headRef}" into "${baseRef}" already exists (#${duplicate.number})`,
      );
    }

    // title and body are accepted but only the ref info is stored in this fake.
    void title;
    void body;

    const number = this._nextPrNumber++;
    const pr: PullRequestRef = {
      number,
      url: `https://github.com/${repoKey(repo)}/pull/${number}`,
      headRef,
      baseRef,
    };
    state.pullRequests.push(pr);
    return pr;
  }

  async listWorkflowRuns(repo: RepoRef): Promise<WorkflowRunRef[]> {
    const state = this.getRepoState(repo);
    // Return a shallow copy, most recent first (last-in = highest id).
    return [...state.workflowRuns].reverse();
  }

  async dispatchWorkflow(
    repo: RepoRef,
    path: string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<void> {
    const state = this.getRepoState(repo);

    if (!state.branches.has(ref)) {
      throw new Error(
        `NOT_FOUND: ref "${ref}" does not exist in "${repoKey(repo)}"`,
      );
    }
    if (!state.files.has(path)) {
      throw new Error(
        `NOT_FOUND: workflow file "${path}" does not exist in "${repoKey(repo)}"`,
      );
    }

    // inputs is accepted; record a synthetic run so tests can inspect it.
    void inputs;

    const branchSha = state.branches.get(ref);
    // branchSha is guaranteed defined because we checked branches.has(ref) above.
    const headSha = branchSha!;

    const run: WorkflowRunRef = {
      id: this._nextRunId++,
      status: "queued",
      conclusion: null,
      headSha,
      event: "workflow_dispatch",
    };
    state.workflowRuns.push(run);
  }

  // -------------------------------------------------------------------------
  // Test-utility helpers (not part of the port interface)
  // -------------------------------------------------------------------------

  /**
   * Directly advance a workflow run's status/conclusion.
   * Useful in tests to simulate a run completing without sleeping.
   */
  resolveWorkflowRun(
    repo: RepoRef,
    runId: number,
    conclusion: WorkflowRunRef["conclusion"],
  ): void {
    const state = this.getRepoState(repo);
    const run = state.workflowRuns.find((r) => r.id === runId);
    if (run === undefined) {
      throw new Error(`NOT_FOUND: workflow run ${runId} in "${repoKey(repo)}"`);
    }
    run.status = "completed";
    run.conclusion = conclusion;
  }
}
