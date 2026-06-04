/**
 * GitHub port interfaces for Daggler.
 *
 * Design note: these are typed adapter boundaries. Where genuine static
 * analysis is possible, implement it for real. Where network access or
 * a real GitHub token is required, a concrete adapter must throw a clear
 * not-connected error rather than faking results.
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** Identifies a GitHub repository. */
export interface RepoRef {
  /** GitHub owner (user or org). */
  owner: string;
  /** Repository name (without owner). */
  repo: string;
  /** Default branch name (e.g. "main"). May be undefined when not yet fetched. */
  defaultBranch?: string;
}

/** A file retrieved from (or written to) a repository. */
export interface FileBlob {
  /** Repository-relative file path, e.g. ".github/workflows/ci.yml". */
  path: string;
  /** Raw file content (UTF-8 string). */
  content: string;
  /**
   * The git blob SHA for this version of the file.
   * Use this as an optimistic-lock when updating the file.
   */
  sha: string;
}

/** A git branch and the commit SHA it currently points to. */
export interface BranchRef {
  /** Branch name. */
  name: string;
  /** The git commit SHA at the tip of this branch. */
  sha: string;
}

/** A GitHub pull request. */
export interface PullRequestRef {
  /** PR number within the repository. */
  number: number;
  /** HTML URL of the pull request, e.g. https://github.com/owner/repo/pull/1 */
  url: string;
  /** The source branch (head). */
  headRef: string;
  /** The target branch (base). */
  baseRef: string;
}

/**
 * Status values mirror the GitHub API.
 * "queued" | "in_progress" | "completed"
 */
export type WorkflowRunStatus = "queued" | "in_progress" | "completed";

/**
 * Conclusion values mirror the GitHub API.
 * null when the run has not completed.
 */
export type WorkflowRunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | null;

/** A single GitHub Actions workflow run. */
export interface WorkflowRunRef {
  /** Numeric run ID assigned by GitHub. */
  id: number;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion;
  /** The git commit SHA that triggered the run. */
  headSha: string;
  /** The event that triggered the run (e.g. "push", "pull_request", "workflow_dispatch"). */
  event: string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

/**
 * GitHubRepositoryPort — the single seam between Daggler's domain logic
 * and any GitHub backend (real Octokit, a local fake, a test spy, etc.).
 *
 * All methods are async even when a concrete adapter might resolve
 * synchronously, so callers never need to change when the adapter is swapped.
 *
 * Error contract: methods throw a plain `Error` whose `.message` begins with
 * one of the following prefixes so callers can react without string-matching
 * the full message:
 *   - "NOT_CONNECTED:"  — adapter has no credentials / not wired to GitHub.
 *   - "NOT_FOUND:"      — the requested resource does not exist.
 *   - "CONFLICT:"       — e.g. a branch already exists.
 */
export interface GitHubRepositoryPort {
  /**
   * List repositories accessible to the authenticated identity.
   * Returns [] when none are available.
   */
  listRepos(): Promise<RepoRef[]>;

  /**
   * Retrieve a single file from a repository.
   * @param repo   - The target repository.
   * @param path   - Repository-relative path.
   * @param ref    - Branch name, tag, or commit SHA. Defaults to the repo's
   *                 default branch when omitted.
   * @throws "NOT_FOUND:" when the file or ref does not exist.
   */
  getFile(repo: RepoRef, path: string, ref?: string): Promise<FileBlob>;

  /**
   * List every file that lives under `.github/workflows/` in the repo.
   * Returns paths relative to the repo root (e.g. ".github/workflows/ci.yml").
   * Returns [] when the directory does not exist.
   * @param ref - Defaults to the repo's default branch.
   */
  listWorkflowFiles(repo: RepoRef, ref?: string): Promise<string[]>;

  /**
   * Create a new branch pointing at `fromSha`.
   * @throws "CONFLICT:" when the branch already exists.
   */
  createBranch(repo: RepoRef, name: string, fromSha: string): Promise<BranchRef>;

  /**
   * Write (create or update) a file on an existing branch.
   * Returns the resulting FileBlob with the new sha.
   * @throws "NOT_FOUND:" when the branch does not exist.
   */
  commitFile(
    repo: RepoRef,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<FileBlob>;

  /**
   * Open a pull request from `headRef` into `baseRef`.
   * @throws "NOT_FOUND:" when either ref does not exist.
   * @throws "CONFLICT:" when an open PR for that head → base pair already exists.
   */
  openPullRequest(
    repo: RepoRef,
    headRef: string,
    baseRef: string,
    title: string,
    body: string,
  ): Promise<PullRequestRef>;

  /**
   * List all workflow runs for the repository, most recent first.
   * Returns [] when no runs exist.
   */
  listWorkflowRuns(repo: RepoRef): Promise<WorkflowRunRef[]>;

  /**
   * Trigger a `workflow_dispatch` event for a workflow file.
   * @param path   - The workflow file path (e.g. ".github/workflows/ci.yml").
   * @param ref    - The branch or tag to dispatch on.
   * @param inputs - Optional key/value pairs matching the workflow's inputs.
   * @throws "NOT_FOUND:" when the workflow file or ref does not exist.
   */
  dispatchWorkflow(
    repo: RepoRef,
    path: string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<void>;
}
