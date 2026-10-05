/* ============================================================================
 * Turn a verified GitHub webhook delivery into job invocations whose payloads
 * match what the worker handlers actually take ({ yaml, path }).
 *
 * A webhook body carries no file contents, so workflow YAML is fetched through
 * an injected reader (the GitHub port). Pure of I/O apart from that reader, so
 * it is unit-testable.
 * ========================================================================== */

import {
  assertRef,
  assertRepoPath,
  assertRepoRef,
  type RepoRef,
} from "@daggler/github";

/** Subset of GitHubRepositoryPort the planner needs. */
export interface WorkflowReader {
  listWorkflowFiles(repo: RepoRef, ref?: string): Promise<string[]>;
  getFile(
    repo: RepoRef,
    path: string,
    ref?: string,
  ): Promise<{ path: string; content: string }>;
}

export interface JobInvocation {
  job: string;
  payload: { yaml: string; path: string };
}

export const MAX_FILES_PER_DELIVERY = 20;
const MAX_YAML_BYTES = 512 * 1024;
/** Jobs that run fully in-process; the rest are stubs needing Postgres/App auth. */
export const REAL_JOBS: ReadonlySet<string> = new Set([
  "validate.workflow",
  "parse.workflow",
]);

const WORKFLOW_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/;

function obj(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === "object"
    ? (v as Record<string, unknown>)
    : undefined;
}

function splitSlug(full: unknown): RepoRef | undefined {
  if (typeof full !== "string") return undefined;
  const [owner, repo, ...rest] = full.split("/");
  if (!owner || !repo || rest.length > 0) return undefined;
  return { owner, repo };
}

/** Which repo/ref/files a delivery refers to (files undefined = list the dir). */
export function locateWorkflows(
  event: string,
  payload: unknown,
): { repo: RepoRef; ref: string; paths?: string[] } | undefined {
  const p = obj(payload);
  if (!p) return undefined;

  if (event === "push") {
    const repo = splitSlug(obj(p["repository"])?.["full_name"]);
    const ref = typeof p["after"] === "string" ? p["after"] : undefined;
    if (!repo || !ref || /^0+$/.test(ref)) return undefined; // branch delete
    const paths = new Set<string>();
    const commits = Array.isArray(p["commits"]) ? p["commits"] : [];
    for (const c of commits) {
      const co = obj(c);
      for (const key of ["added", "modified"] as const) {
        const list = co?.[key];
        if (Array.isArray(list)) {
          for (const f of list) {
            if (typeof f === "string" && WORKFLOW_RE.test(f)) paths.add(f);
          }
        }
      }
    }
    return { repo, ref, paths: [...paths] };
  }

  if (event === "pull_request") {
    const head = obj(obj(p["pull_request"])?.["head"]);
    const repo = splitSlug(obj(head?.["repo"])?.["full_name"]);
    const ref = typeof head?.["sha"] === "string" ? head["sha"] : undefined;
    if (!repo || !ref) return undefined;
    return { repo, ref };
  }
  return undefined;
}

/**
 * Build the list of (job, {yaml, path}) invocations for a delivery.
 * Never throws for malformed input: unsafe or unreadable files are skipped.
 */
export async function planWebhookJobs(
  event: string,
  jobNames: readonly string[],
  payload: unknown,
  reader: WorkflowReader,
): Promise<JobInvocation[]> {
  const jobs = jobNames.filter((j) => REAL_JOBS.has(j));
  if (jobs.length === 0) return [];
  const where = locateWorkflows(event, payload);
  if (!where) return [];

  try {
    assertRepoRef(where.repo);
    assertRef(where.ref);
  } catch {
    return [];
  }

  let paths = where.paths;
  if (!paths) {
    try {
      paths = await reader.listWorkflowFiles(where.repo, where.ref);
    } catch {
      return [];
    }
  }
  paths = paths.slice(0, MAX_FILES_PER_DELIVERY);

  const out: JobInvocation[] = [];
  for (const path of paths) {
    try {
      assertRepoPath(path);
      const file = await reader.getFile(where.repo, path, where.ref);
      if (Buffer.byteLength(file.content, "utf8") > MAX_YAML_BYTES) continue;
      for (const job of jobs) {
        out.push({ job, payload: { yaml: file.content, path } });
      }
    } catch {
      /* deleted/unreadable file: nothing to validate */
    }
  }
  return out;
}
