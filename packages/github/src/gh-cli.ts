/**
 * GhCliAdapter — a GitHubRepositoryPort implementation backed by the gh CLI.
 *
 * All operations spawn child processes that call `gh` or `gh api`.
 * If the gh CLI is not installed, or the user is not authenticated,
 * every method throws "NOT_CONNECTED: gh CLI is not available or not authenticated".
 *
 * Node builtins only — this file must NOT import any npm package so it stays
 * usable in pure-Node consumers without breaking the package's isomorphic build
 * for callers that only use InMemoryGitHubAdapter.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  BranchRef,
  FileBlob,
  GitHubRepositoryPort,
  PullRequestRef,
  RepoRef,
  WorkflowRunConclusion,
  WorkflowRunRef,
  WorkflowRunStatus,
} from "./ports.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

/** Default timeout for gh subprocess calls (10 seconds). */
const DEFAULT_TIMEOUT_MS = 10_000;

interface SpawnResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a gh command and return trimmed stdout.
 * Throws with the stderr message on non-zero exit.
 */
async function run(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SpawnResult> {
  try {
    const { stdout, stderr } = await execFileAsync("gh", args, {
      timeout: timeoutMs,
      env: { ...process.env },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: unknown) {
    // execFile wraps exit-code errors; re-throw with the stderr payload.
    const e = err as { stderr?: string; message?: string };
    const detail = (e.stderr ?? e.message ?? String(err)).trim();
    throw new Error(detail || `gh ${args[0] ?? ""} failed`);
  }
}

/**
 * Map `noent`-style gh API error messages to the "NOT_FOUND:" prefix
 * expected by GitHubRepositoryPort callers.
 */
function mapGhError(err: unknown, context: string): never {
  const msg = err instanceof Error ? err.message : String(err);
  // GitHub API 404 errors surfaced by `gh api`
  if (
    msg.includes("404") ||
    msg.includes("Not Found") ||
    msg.includes("not found") ||
    msg.includes("No such")
  ) {
    throw new Error(`NOT_FOUND: ${context} — ${msg}`);
  }
  // CONFLICT detection (422 / "already exists")
  if (
    msg.includes("422") ||
    msg.includes("already exists") ||
    msg.includes("Reference already exists")
  ) {
    throw new Error(`CONFLICT: ${context} — ${msg}`);
  }
  throw new Error(`${context} — ${msg}`);
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set<WorkflowRunStatus>([
  "queued",
  "in_progress",
  "completed",
]);

function normalizeStatus(raw: string): WorkflowRunStatus {
  if (VALID_STATUSES.has(raw as WorkflowRunStatus)) {
    return raw as WorkflowRunStatus;
  }
  // gh sometimes returns "waiting" or "pending" — map those to "queued".
  return "queued";
}

const VALID_CONCLUSIONS = new Set<string>([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
]);

function normalizeConclusion(raw: string | null): WorkflowRunConclusion {
  if (raw === null || raw === "" || raw === undefined) return null;
  if (VALID_CONCLUSIONS.has(raw)) return raw as WorkflowRunConclusion;
  return null;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class GhCliAdapter implements GitHubRepositoryPort {
  /**
   * Returns true when the gh CLI is on $PATH AND `gh auth status` exits 0.
   * Safe to call multiple times; each call shells out.
   */
  static async isAvailable(): Promise<boolean> {
    try {
      await run(["auth", "status"]);
      return true;
    } catch {
      return false;
    }
  }

  /** Shared guard — throws NOT_CONNECTED if gh is unavailable. */
  private async requireGh(): Promise<void> {
    const ok = await GhCliAdapter.isAvailable();
    if (!ok) {
      throw new Error(
        "NOT_CONNECTED: gh CLI is not available or not authenticated. " +
          "Install gh (https://cli.github.com) and run `gh auth login`.",
      );
    }
  }

  // -------------------------------------------------------------------------
  // GitHubRepositoryPort
  // -------------------------------------------------------------------------

  /**
   * List repositories accessible to the authenticated identity.
   * Uses `gh repo list --json nameWithOwner,defaultBranchRef --limit 100`.
   */
  async listRepos(): Promise<RepoRef[]> {
    await this.requireGh();
    try {
      const { stdout } = await run([
        "repo",
        "list",
        "--json",
        "nameWithOwner,defaultBranchRef",
        "--limit",
        "100",
      ]);
      if (!stdout) return [];

      const raw = JSON.parse(stdout) as Array<{
        nameWithOwner: string;
        defaultBranchRef?: { name?: string } | null;
      }>;

      return raw.map((r) => {
        const slash = r.nameWithOwner.indexOf("/");
        const owner = r.nameWithOwner.slice(0, slash);
        const repo = r.nameWithOwner.slice(slash + 1);
        const defaultBranch = r.defaultBranchRef?.name ?? undefined;
        return { owner, repo, defaultBranch };
      });
    } catch (err) {
      mapGhError(err, "listRepos");
    }
  }

  /**
   * Retrieve a single file from a repository.
   * Uses `gh api repos/{owner}/{repo}/contents/{path}?ref=...`
   * then base64-decodes the content field.
   */
  async getFile(repo: RepoRef, path: string, ref?: string): Promise<FileBlob> {
    await this.requireGh();

    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const endpoint = `repos/${repo.owner}/${repo.repo}/contents/${path}${refParam}`;

    try {
      // Fetch both content (base64) and sha in one call.
      const { stdout } = await run([
        "api",
        endpoint,
        "--jq",
        "[.content, .sha, .encoding]",
      ]);

      const parsed = JSON.parse(stdout) as [string, string, string];
      const [rawContent, sha, encoding] = parsed;

      if (encoding !== "base64" && encoding !== undefined) {
        throw new Error(`Unexpected encoding "${encoding}" for file "${path}"`);
      }

      // GitHub returns base64 with newlines every 60 chars — strip them.
      const cleaned = (rawContent ?? "").replace(/\n/g, "");
      const content = Buffer.from(cleaned, "base64").toString("utf-8");

      return { path, content, sha: sha ?? "" };
    } catch (err) {
      mapGhError(err, `getFile ${repo.owner}/${repo.repo}:${path}`);
    }
  }

  /**
   * List files under `.github/workflows/` using the GitHub contents API.
   * Filters to *.yml and *.yaml entries. Returns [] when the directory does
   * not exist (404).
   */
  async listWorkflowFiles(repo: RepoRef, ref?: string): Promise<string[]> {
    await this.requireGh();

    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const endpoint = `repos/${repo.owner}/${repo.repo}/contents/.github/workflows${refParam}`;

    try {
      const { stdout } = await run([
        "api",
        endpoint,
        "--jq",
        '[.[] | select(.type == "file") | .path]',
      ]);

      if (!stdout || stdout === "null") return [];

      const paths = JSON.parse(stdout) as string[];
      return paths
        .filter((p) => p.endsWith(".yml") || p.endsWith(".yaml"))
        .sort();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A 404 on the workflows directory means there are no workflow files.
      if (
        msg.includes("NOT_FOUND") ||
        msg.includes("404") ||
        msg.includes("Not Found") ||
        msg.includes("not found")
      ) {
        return [];
      }
      mapGhError(err, `listWorkflowFiles ${repo.owner}/${repo.repo}`);
    }
  }

  /**
   * Create a new branch pointing at `fromSha` using the git/refs API.
   * Uses `gh api --method POST repos/{o}/{r}/git/refs`.
   */
  async createBranch(
    repo: RepoRef,
    name: string,
    fromSha: string,
  ): Promise<BranchRef> {
    await this.requireGh();

    const endpoint = `repos/${repo.owner}/${repo.repo}/git/refs`;

    try {
      const { stdout } = await run([
        "api",
        "--method",
        "POST",
        endpoint,
        "-f",
        `ref=refs/heads/${name}`,
        "-f",
        `sha=${fromSha}`,
        "--jq",
        "[.ref, .object.sha]",
      ]);

      const parsed = JSON.parse(stdout) as [string, string];
      const sha = parsed[1] ?? fromSha;
      return { name, sha };
    } catch (err) {
      mapGhError(err, `createBranch ${repo.owner}/${repo.repo} "${name}"`);
    }
  }

  /**
   * Write (create or update) a file on a branch.
   * Uses `gh api --method PUT repos/{o}/{r}/contents/{path}` with base64-encoded content.
   * Fetches the current file SHA first to provide the required optimistic-lock.
   */
  async commitFile(
    repo: RepoRef,
    branch: string,
    path: string,
    content: string,
    message: string,
  ): Promise<FileBlob> {
    await this.requireGh();

    const endpoint = `repos/${repo.owner}/${repo.repo}/contents/${path}`;
    const encoded = Buffer.from(content, "utf-8").toString("base64");

    // We need the current file's SHA to update it (GitHub requires optimistic lock).
    // If the file doesn't exist yet, omit the sha field.
    let existingSha: string | undefined;
    try {
      const existing = await this.getFile(repo, path, branch);
      existingSha = existing.sha;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.startsWith("NOT_FOUND:")) {
        throw err;
      }
      // file doesn't exist yet — that's fine, we're creating it
    }

    const args: string[] = [
      "api",
      "--method",
      "PUT",
      endpoint,
      "-f",
      `message=${message}`,
      "-f",
      `content=${encoded}`,
      "-f",
      `branch=${branch}`,
    ];
    if (existingSha !== undefined) {
      args.push("-f", `sha=${existingSha}`);
    }
    args.push("--jq", "[.content.sha, .content.path]");

    try {
      const { stdout } = await run(args);
      const parsed = JSON.parse(stdout) as [string, string];
      const newSha = parsed[0] ?? "";
      const resultPath = parsed[1] ?? path;
      return { path: resultPath, content, sha: newSha };
    } catch (err) {
      mapGhError(
        err,
        `commitFile ${repo.owner}/${repo.repo}:${path} on branch "${branch}"`,
      );
    }
  }

  /**
   * Open a pull request using `gh pr create`.
   */
  async openPullRequest(
    repo: RepoRef,
    headRef: string,
    baseRef: string,
    title: string,
    body: string,
  ): Promise<PullRequestRef> {
    await this.requireGh();

    try {
      const { stdout } = await run([
        "pr",
        "create",
        "--repo",
        `${repo.owner}/${repo.repo}`,
        "--head",
        headRef,
        "--base",
        baseRef,
        "--title",
        title,
        "--body",
        body,
        "--json",
        "number,url,headRefName,baseRefName",
      ]);

      const pr = JSON.parse(stdout) as {
        number: number;
        url: string;
        headRefName: string;
        baseRefName: string;
      };

      return {
        number: pr.number,
        url: pr.url,
        headRef: pr.headRefName,
        baseRef: pr.baseRefName,
      };
    } catch (err) {
      mapGhError(
        err,
        `openPullRequest ${repo.owner}/${repo.repo} "${headRef}" -> "${baseRef}"`,
      );
    }
  }

  /**
   * List workflow runs for a repository using `gh run list`.
   * Returns at most 20 runs, most recent first.
   */
  async listWorkflowRuns(repo: RepoRef): Promise<WorkflowRunRef[]> {
    await this.requireGh();

    try {
      const { stdout } = await run([
        "run",
        "list",
        "--repo",
        `${repo.owner}/${repo.repo}`,
        "--limit",
        "20",
        "--json",
        "databaseId,status,conclusion,headSha,event",
      ]);

      if (!stdout || stdout === "null") return [];

      const raw = JSON.parse(stdout) as Array<{
        databaseId: number;
        status: string;
        conclusion: string | null;
        headSha: string;
        event: string;
      }>;

      return raw.map((r) => ({
        id: r.databaseId,
        status: normalizeStatus(r.status),
        conclusion: normalizeConclusion(r.conclusion),
        headSha: r.headSha,
        event: r.event,
      }));
    } catch (err) {
      mapGhError(err, `listWorkflowRuns ${repo.owner}/${repo.repo}`);
    }
  }

  /**
   * Trigger a workflow_dispatch event using `gh workflow run`.
   * The `path` argument may be the full repo-relative path (e.g.
   * ".github/workflows/ci.yml") or just the filename ("ci.yml").
   */
  async dispatchWorkflow(
    repo: RepoRef,
    path: string,
    ref: string,
    inputs?: Record<string, string>,
  ): Promise<void> {
    await this.requireGh();

    // gh workflow run accepts the filename (e.g. "ci.yml") or the workflow name.
    // The path is stored as ".github/workflows/ci.yml" — extract just the filename.
    const filename = path.split("/").pop() ?? path;

    const args: string[] = [
      "workflow",
      "run",
      filename,
      "--repo",
      `${repo.owner}/${repo.repo}`,
      "--ref",
      ref,
    ];

    if (inputs !== undefined && Object.keys(inputs).length > 0) {
      for (const [key, value] of Object.entries(inputs)) {
        args.push("-f", `${key}=${value}`);
      }
    }

    try {
      await run(args);
    } catch (err) {
      mapGhError(
        err,
        `dispatchWorkflow ${repo.owner}/${repo.repo} "${path}" @ "${ref}"`,
      );
    }
  }
}
