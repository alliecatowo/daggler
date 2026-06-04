/**
 * @daggler/github — GitHub ports and adapters.
 *
 * Re-exports:
 *   - All port types (GitHubRepositoryPort, RepoRef, FileBlob, …)
 *   - InMemoryGitHubAdapter and its seed types (AdapterSeed, RepoSeed)
 */
export type {
  BranchRef,
  FileBlob,
  GitHubRepositoryPort,
  PullRequestRef,
  RepoRef,
  WorkflowRunConclusion,
  WorkflowRunRef,
  WorkflowRunStatus,
} from "./ports.js";

export type { AdapterSeed, RepoSeed } from "./in-memory.js";
export { InMemoryGitHubAdapter } from "./in-memory.js";

export { GhCliAdapter } from "./gh-cli.js";

export {
  verifyWebhookSignature,
  parseWebhookEvent,
  EVENT_JOB_MAP,
  dispatchWebhook,
} from "./webhook.js";
export type { ParsedWebhookEvent, WebhookDispatchResult } from "./webhook.js";

export {
  loadGitHubAppConfigFromEnv,
  exchangeOAuthCode,
  NotConfiguredError,
} from "./app-auth.js";
export type { GitHubAppConfig, OAuthTokenResponse } from "./app-auth.js";
