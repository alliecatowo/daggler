/* ============================================================================
 * @daggler/worker — typed job handlers.
 *
 * DESIGN CONTRACT
 * ---------------
 * JobHandler<TPayload, TResult> is the uniform signature every Graphile Worker
 * task will implement. Handlers that can run fully in-process (parse, validate)
 * call the real engine. Handlers that require an external resource (GitHub API,
 * Postgres, a real runner) are honest STUBS: they throw a clear not-connected
 * error and are annotated with a comment describing what they will do once the
 * resource is available.
 *
 * Nothing in this file fakes results. "not implemented" means not implemented.
 * ============================================================================ */

import { parseWorkflow } from "@daggler/workflow-ir";
import { validateWorkflow } from "@daggler/validators";

// ---------------------------------------------------------------------------
// Core type
// ---------------------------------------------------------------------------

/** The uniform async signature every job handler implements. */
export type JobHandler<TPayload, TResult> = (
  payload: TPayload,
) => Promise<TResult>;

// ---------------------------------------------------------------------------
// Shared payload shapes
// ---------------------------------------------------------------------------

export interface WorkflowFilePayload {
  /** Raw YAML source text of the workflow. */
  yaml: string;
  /** Repository-relative path, e.g. ".github/workflows/ci.yml". */
  path: string;
}

// ---------------------------------------------------------------------------
// REAL handlers — backed by @daggler/workflow-ir and @daggler/validators
// ---------------------------------------------------------------------------

export interface ParseWorkflowResult {
  ok: boolean;
  jobCount: number;
  diagnosticsCount: number;
}

/**
 * Parse a workflow YAML file into a WorkflowIR and return lightweight metrics.
 * This runs fully in-process using @daggler/workflow-ir — no external deps.
 */
export const parseWorkflowJob: JobHandler<
  WorkflowFilePayload,
  ParseWorkflowResult
> = async ({ yaml, path }) => {
  const result = parseWorkflow(yaml, { path });
  return {
    ok: result.ok,
    jobCount: result.ir.jobs.length,
    diagnosticsCount: result.diagnostics.length,
  };
};

export interface ValidateWorkflowResult {
  errors: number;
  warnings: number;
  infos: number;
  securityGrade: "A" | "B" | "C" | "D" | "F";
}

/**
 * Parse + validate a workflow YAML file and return diagnostic summary.
 * This runs fully in-process using @daggler/workflow-ir + @daggler/validators.
 */
export const validateWorkflowJob: JobHandler<
  WorkflowFilePayload,
  ValidateWorkflowResult
> = async ({ yaml, path }) => {
  const parseResult = parseWorkflow(yaml, { path });
  const validation = validateWorkflow(parseResult);
  return {
    errors: validation.counts.error,
    warnings: validation.counts.warning,
    infos: validation.counts.info,
    securityGrade: validation.security.grade,
  };
};

// ---------------------------------------------------------------------------
// STUB handlers — require GitHub / Postgres / runner connections.
// Each throws a clear not-connected error until the adapter is wired.
// ---------------------------------------------------------------------------

export interface SyncInstallationPayload {
  installationId: number;
}

export interface SyncInstallationResult {
  status: "not-implemented";
}

/**
 * STUB: Will enumerate all repositories for a GitHub App installation,
 * upsert repository rows in Postgres, and enqueue syncRepositoryJob for each.
 * Requires: GitHub App credentials + Postgres connection.
 */
export const syncInstallationJob: JobHandler<
  SyncInstallationPayload,
  SyncInstallationResult
> = async (_payload) => {
  throw new Error(
    "syncInstallationJob: not connected — GitHub App credentials and Postgres are required.",
  );
};

export interface SyncRepositoryPayload {
  installationId: number;
  owner: string;
  repo: string;
}

export interface SyncRepositoryResult {
  status: "not-implemented";
}

/**
 * STUB: Will fetch repository metadata from GitHub REST API, upsert a repo row,
 * and enqueue syncWorkflowFilesJob to index all workflow files.
 * Requires: GitHub App installation token + Postgres connection.
 */
export const syncRepositoryJob: JobHandler<
  SyncRepositoryPayload,
  SyncRepositoryResult
> = async (_payload) => {
  throw new Error(
    "syncRepositoryJob: not connected — GitHub App installation token and Postgres are required.",
  );
};

export interface SyncWorkflowFilesPayload {
  installationId: number;
  owner: string;
  repo: string;
  ref: string;
}

export interface SyncWorkflowFilesResult {
  status: "not-implemented";
}

/**
 * STUB: Will fetch all .github/workflows/*.yml files from a repository tree via
 * GitHub Contents API, store raw YAML in Postgres, then enqueue parseWorkflowJob
 * and validateWorkflowJob for each file.
 * Requires: GitHub App installation token + Postgres connection.
 */
export const syncWorkflowFilesJob: JobHandler<
  SyncWorkflowFilesPayload,
  SyncWorkflowFilesResult
> = async (_payload) => {
  throw new Error(
    "syncWorkflowFilesJob: not connected — GitHub App installation token and Postgres are required.",
  );
};

export interface IndexActionPayload {
  /** Full action reference, e.g. "actions/checkout@v4". */
  actionRef: string;
}

export interface IndexActionResult {
  status: "not-implemented";
}

/**
 * STUB: Will resolve the action ref to a pinned SHA via the GitHub API,
 * fetch action.yml metadata, and upsert an entry in the actions catalog table.
 * Requires: GitHub API token + Postgres connection.
 */
export const indexActionJob: JobHandler<
  IndexActionPayload,
  IndexActionResult
> = async (_payload) => {
  throw new Error(
    "indexActionJob: not connected — GitHub API token and Postgres are required.",
  );
};

export interface CreateWorkflowPrPayload {
  installationId: number;
  owner: string;
  repo: string;
  /** Updated workflow YAML content. */
  yaml: string;
  workflowPath: string;
  /** PR title and body. */
  title: string;
  body: string;
}

export interface CreateWorkflowPrResult {
  status: "not-implemented";
}

/**
 * STUB: Will create a new branch with the updated workflow YAML, then open a
 * pull request using the GitHub REST API with the supplied title and body.
 * Requires: GitHub App installation token with contents:write + pull-requests:write.
 */
export const createWorkflowPrJob: JobHandler<
  CreateWorkflowPrPayload,
  CreateWorkflowPrResult
> = async (_payload) => {
  throw new Error(
    "createWorkflowPrJob: not connected — GitHub App installation token with PR write scope is required.",
  );
};

export interface ImportWorkflowRunPayload {
  installationId: number;
  owner: string;
  repo: string;
  runId: number;
}

export interface ImportWorkflowRunResult {
  status: "not-implemented";
}

/**
 * STUB: Will fetch workflow run details (jobs, steps, timings, conclusion) via
 * the GitHub Actions REST API and persist them to Postgres for analytics.
 * Requires: GitHub App installation token + Postgres connection.
 */
export const importWorkflowRunJob: JobHandler<
  ImportWorkflowRunPayload,
  ImportWorkflowRunResult
> = async (_payload) => {
  throw new Error(
    "importWorkflowRunJob: not connected — GitHub App installation token and Postgres are required.",
  );
};

export interface DispatchGithubRunPayload {
  installationId: number;
  owner: string;
  repo: string;
  workflowId: string | number;
  ref: string;
  inputs?: Record<string, string>;
}

export interface DispatchGithubRunResult {
  status: "not-implemented";
}

/**
 * STUB: Will trigger a workflow_dispatch event on GitHub using the Actions REST
 * API, optionally passing workflow inputs, and return the new run ID once
 * GitHub enqueues it.
 * Requires: GitHub App installation token with actions:write.
 */
export const dispatchGithubRunJob: JobHandler<
  DispatchGithubRunPayload,
  DispatchGithubRunResult
> = async (_payload) => {
  throw new Error(
    "dispatchGithubRunJob: not connected — GitHub App installation token with actions:write is required.",
  );
};
