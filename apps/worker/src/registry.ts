/* ============================================================================
 * @daggler/worker — job registry.
 *
 * JOB_REGISTRY maps canonical job names (the identifiers Graphile Worker will
 * use as task identifiers in Postgres) to their typed async handler functions.
 *
 * In production, the worker process calls graphile-worker's `run()` with a
 * task list built from this registry. Until then, the registry serves as the
 * single source of truth for what jobs exist and what they do.
 * ============================================================================ */

import {
  parseWorkflowJob,
  validateWorkflowJob,
  syncInstallationJob,
  syncRepositoryJob,
  syncWorkflowFilesJob,
  indexActionJob,
  createWorkflowPrJob,
  importWorkflowRunJob,
  dispatchGithubRunJob,
} from "./jobs.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJobHandler = (payload: any) => Promise<any>;

/**
 * The canonical job registry.
 *
 * Keys are the Graphile Worker task identifiers; values are the typed handlers.
 * Both real handlers (parse, validate) and stubs (everything requiring GitHub /
 * Postgres) are registered here so the full surface area is visible in one place.
 */
export const JOB_REGISTRY: Record<string, AnyJobHandler> = {
  "parse.workflow": parseWorkflowJob,
  "validate.workflow": validateWorkflowJob,
  "sync.installation": syncInstallationJob,
  "sync.repository": syncRepositoryJob,
  "sync.workflowFiles": syncWorkflowFilesJob,
  "index.action": indexActionJob,
  "create.workflowPr": createWorkflowPrJob,
  "import.workflowRun": importWorkflowRunJob,
  "dispatch.githubRun": dispatchGithubRunJob,
} as const;

/** Ordered list of all registered job names (useful for introspection / logging). */
export const JOB_NAMES = Object.keys(JOB_REGISTRY) as (keyof typeof JOB_REGISTRY)[];
