/* ============================================================================
 * @daggler/db — Drizzle ORM Postgres Schema
 *
 * Covers Daggler's full relational model:
 *   - Identity & OAuth accounts (users, accounts)
 *   - Multi-tenant workspaces (workspaces, workspaceMembers)
 *   - GitHub App integration (githubInstallations, repositories)
 *   - Workflow source & authoring (workflowFiles, workflowRevisions, workflowDrafts)
 *   - Visual layout (workflowLayouts)
 *   - Validation engine output (validationRuns, diagnostics)
 *   - Actions marketplace catalog (actionSources, actionVersions)
 *   - Self-hosted runner management (runnerConnections)
 *   - Execution tracking (executionRuns, executionJobs, executionSteps, executionLogs)
 *   - Policy management (policyPacks, policyRules, repositoryPolicySettings)
 *   - Reusable workflow templates (workflowTemplates)
 *
 * Column naming: snake_case as the first arg to every helper (the DB column
 * name), then Drizzle generates a camelCase JS key automatically.
 *
 * All timestamps are WITH TIME ZONE. All UUIDs use gen_random_uuid() via
 * .defaultRandom(). JSON blobs use jsonb for indexability.
 * ========================================================================== */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ============================================================================
 * ENUMS
 * ========================================================================== */

/**
 * Workspace membership roles, ordered from most to least privileged.
 * - owner   : created the workspace; can delete it and manage billing
 * - admin   : can manage members and integrations
 * - editor  : can push workflow edits and trigger runs
 * - viewer  : read-only access
 */
export const workspaceMemberRoleEnum = pgEnum("workspace_member_role", [
  "owner",
  "admin",
  "editor",
  "viewer",
]);

/**
 * Diagnostic severity levels aligned with Daggler's validation layer contract
 * (types.ts: Severity = "error" | "warning" | "info"). "critical" is a
 * database-only escalation for policy violations that block merges.
 */
export const diagnosticSeverityEnum = pgEnum("diagnostic_severity", [
  "critical",
  "error",
  "warning",
  "info",
]);

/**
 * Origin of a diagnostic — mirrors DiagnosticSource from @daggler/workflow-ir.
 */
export const diagnosticSourceEnum = pgEnum("diagnostic_source", [
  "parser",
  "actionlint",
  "semantic",
  "policy",
  "security",
]);

/**
 * Execution run lifecycle states.
 */
export const executionStatusEnum = pgEnum("execution_status", [
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
  "skipped",
  "timed_out",
]);

/**
 * Where a run is dispatched — mirrors RunMode from the editor store.
 * - static : client-side graph simulation (no real runner)
 * - local  : daggler-runner sidecar on the user's machine
 * - github : forwarded to GitHub Actions via the App
 */
export const runModeEnum = pgEnum("run_mode", ["static", "local", "github"]);

/**
 * How an action version pin is expressed in the workflow source.
 * Mirrors ActionRef.refKind from @daggler/workflow-ir.
 */
export const actionRefKindEnum = pgEnum("action_ref_kind", [
  "sha",
  "tag",
  "branch",
  "unknown",
]);

/**
 * Runner connection states for self-hosted runners.
 */
export const runnerStatusEnum = pgEnum("runner_status", [
  "online",
  "offline",
  "busy",
  "draining",
]);

/**
 * OAuth provider identifier — extensible for future providers.
 */
export const oauthProviderEnum = pgEnum("oauth_provider", [
  "github",
  "gitlab",
  "google",
]);

/* ============================================================================
 * IDENTITY
 * ========================================================================== */

/**
 * Platform users. Created on first OAuth sign-in.
 * Email is nullable because some providers withhold it.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: varchar("name", { length: 255 }),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
]);

/**
 * OAuth accounts linked to a user. A single user may have multiple providers.
 * providerAccountId is the provider's own opaque user identifier.
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: oauthProviderEnum("provider").notNull(),
  providerAccountId: varchar("provider_account_id", { length: 255 }).notNull(),
  /** OAuth access token — store encrypted at rest in production. */
  accessToken: text("access_token"),
  /** OAuth refresh token — store encrypted at rest in production. */
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  /** Raw token scope string from the provider. */
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("accounts_provider_account_idx").on(t.provider, t.providerAccountId),
  index("accounts_user_idx").on(t.userId),
]);

/* ============================================================================
 * WORKSPACES
 * ========================================================================== */

/**
 * A workspace groups repositories and members under a shared billing context.
 * slug is the URL-safe handle, e.g. "acme-corp".
 */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  avatarUrl: text("avatar_url"),
  /** Stripe customer id or equivalent billing identifier. */
  billingCustomerId: varchar("billing_customer_id", { length: 255 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workspaces_slug_idx").on(t.slug),
]);

/**
 * Workspace membership, with composite primary key (workspaceId, userId).
 */
export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: workspaceMemberRoleEnum("role").notNull().default("viewer"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
  index("workspace_members_user_idx").on(t.userId),
]);

/* ============================================================================
 * GITHUB INTEGRATION
 * ========================================================================== */

/**
 * A GitHub App installation, scoped to an org or personal account.
 * One installation may cover many repositories.
 */
export const githubInstallations = pgTable("github_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** Numeric GitHub installation ID from the App webhook payload. */
  githubInstallationId: integer("github_installation_id").notNull(),
  /** "Organization" or "User" — matches GitHub's account_type field. */
  accountType: varchar("account_type", { length: 32 }).notNull(),
  /** GitHub org/user login, e.g. "acme-corp". */
  accountLogin: varchar("account_login", { length: 255 }).notNull(),
  /** Numeric GitHub account ID. */
  accountId: integer("account_id").notNull(),
  /** Raw installation object from GitHub for debugging and re-sync. */
  rawJson: jsonb("raw_json"),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("github_installations_github_id_idx").on(t.githubInstallationId),
  index("github_installations_workspace_idx").on(t.workspaceId),
]);

/**
 * A GitHub repository tracked by a Daggler workspace.
 * fullName is "owner/repo", e.g. "acme-corp/api".
 */
export const repositories = pgTable("repositories", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  installationId: uuid("installation_id")
    .notNull()
    .references(() => githubInstallations.id, { onDelete: "cascade" }),
  /** Numeric GitHub repository ID — stable across renames. */
  githubRepoId: integer("github_repo_id").notNull(),
  fullName: varchar("full_name", { length: 510 }).notNull(),
  defaultBranch: varchar("default_branch", { length: 255 }).notNull().default("main"),
  isPrivate: boolean("is_private").notNull().default(false),
  /** Raw repository object from GitHub for metadata (topics, language, etc.). */
  rawJson: jsonb("raw_json"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("repositories_github_repo_id_idx").on(t.githubRepoId),
  index("repositories_workspace_idx").on(t.workspaceId),
]);

/* ============================================================================
 * WORKFLOW SOURCE & AUTHORING
 * ========================================================================== */

/**
 * A workflow file tracked within a repository.
 * path is relative to the repo root, e.g. ".github/workflows/ci.yml".
 * The unique index on (repo_id, path) reflects the design constraint that a
 * file path is unique within a repository.
 */
export const workflowFiles = pgTable("workflow_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  path: varchar("path", { length: 1024 }).notNull(),
  /** Human-readable name derived from the workflow's `name:` key or the filename. */
  displayName: varchar("display_name", { length: 255 }),
  /** Short user-assigned tag/label shown in the sidebar. */
  tag: varchar("tag", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workflow_files_repo_path_idx").on(t.repositoryId, t.path),
  index("workflow_files_repo_idx").on(t.repositoryId),
]);

/**
 * Immutable committed revisions of a workflow file (one row per git commit
 * that touched the file). Provides historical analysis and diffing.
 */
export const workflowRevisions = pgTable("workflow_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => workflowFiles.id, { onDelete: "cascade" }),
  /** Full 40-char git commit SHA. */
  commitSha: varchar("commit_sha", { length: 40 }).notNull(),
  /** Branch or tag ref this revision was fetched from. */
  ref: varchar("ref", { length: 255 }),
  /** The raw YAML source at this commit. */
  yamlSource: text("yaml_source").notNull(),
  /**
   * Serialized WorkflowIR produced by the parser at index time.
   * Stored as JSONB so the server can query into the IR without re-parsing.
   */
  irJson: jsonb("ir_json"),
  /**
   * Serialized WorkflowGraph (jobs + edges) for fast graph rendering.
   */
  graphJson: jsonb("graph_json"),
  /** Author login from the git commit. */
  authorLogin: varchar("author_login", { length: 255 }),
  /** ISO-8601 commit timestamp as authored (may differ from createdAt). */
  committedAt: timestamp("committed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workflow_revisions_file_commit_idx").on(t.fileId, t.commitSha),
  index("workflow_revisions_file_idx").on(t.fileId),
]);

/**
 * In-progress draft edits for a workflow file, one per (file, user) pair.
 * Persists the unsaved YAML and any partial IR so the editor can restore state
 * after a page reload without losing work.
 */
export const workflowDrafts = pgTable("workflow_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => workflowFiles.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** The current draft YAML. */
  yamlSource: text("yaml_source").notNull(),
  /** The base revision SHA this draft was forked from, for 3-way merge. */
  baseCommitSha: varchar("base_commit_sha", { length: 40 }),
  /** Whether this draft has unsaved changes relative to the HEAD revision. */
  isDirty: boolean("is_dirty").notNull().default(true),
  /** Serialized undo/redo command stack (EditorCommand[][]). */
  historyJson: jsonb("history_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workflow_drafts_file_user_idx").on(t.fileId, t.userId),
  index("workflow_drafts_user_idx").on(t.userId),
]);

/* ============================================================================
 * VISUAL LAYOUT
 * ========================================================================== */

/**
 * Persisted canvas layout for the graph view of a workflow file.
 * One row per (file, user) — layout is personal, not shared.
 * nodesJson stores { [jobId]: { x, y, width?, height?, collapsed? } }.
 */
export const workflowLayouts = pgTable("workflow_layouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => workflowFiles.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Per-job position and display overrides.
   * Shape: Record<jobId, { x: number; y: number; collapsed?: boolean }>.
   */
  nodesJson: jsonb("nodes_json").notNull().default({}),
  /** Viewport pan/zoom state: { x, y, zoom }. */
  viewportJson: jsonb("viewport_json"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workflow_layouts_file_user_idx").on(t.fileId, t.userId),
]);

/* ============================================================================
 * VALIDATION ENGINE OUTPUT
 * ========================================================================== */

/**
 * A full validation run against a specific revision or draft YAML snapshot.
 * The run stores aggregate counts and the security posture score so dashboards
 * can query across files without loading every diagnostic.
 */
export const validationRuns = pgTable("validation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => workflowFiles.id, { onDelete: "cascade" }),
  /** NULL when run against a draft (no committed SHA yet). */
  revisionId: uuid("revision_id")
    .references(() => workflowRevisions.id, { onDelete: "set null" }),
  triggeredBy: uuid("triggered_by")
    .references(() => users.id, { onDelete: "set null" }),
  /** Aggregate counts from ValidationResult.counts. */
  countError: integer("count_error").notNull().default(0),
  countWarning: integer("count_warning").notNull().default(0),
  countInfo: integer("count_info").notNull().default(0),
  /** PostureScore.score (0–100). */
  securityScore: integer("security_score"),
  /** PostureScore.grade: A|B|C|D|F. */
  securityGrade: varchar("security_grade", { length: 1 }),
  /** Full PostureScore.factors array serialized. */
  securityFactorsJson: jsonb("security_factors_json"),
  /** ValidationResult.complexity blob. */
  complexityJson: jsonb("complexity_json"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("validation_runs_file_idx").on(t.fileId),
  index("validation_runs_revision_idx").on(t.revisionId),
]);

/**
 * Individual diagnostic findings produced by a validation run.
 * Matches the Diagnostic interface from @daggler/validators.
 * span* columns flatten the SourceSpan for fast range queries.
 */
export const diagnostics = pgTable("diagnostics", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => validationRuns.id, { onDelete: "cascade" }),
  /** Stable finding id computed by the validator (code + path + ordinal). */
  findingId: varchar("finding_id", { length: 255 }).notNull(),
  /** Rule code, e.g. POL002, SEM014, AL2001. */
  code: varchar("code", { length: 64 }).notNull(),
  severity: diagnosticSeverityEnum("severity").notNull(),
  source: diagnosticSourceEnum("source").notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  message: text("message").notNull(),
  /** Canonical node path, e.g. "step:build#3". */
  path: varchar("path", { length: 1024 }).notNull(),
  /** Flattened SourceSpan fields (may be NULL if no span could be resolved). */
  spanStartLine: integer("span_start_line"),
  spanStartCol: integer("span_start_col"),
  spanStartOffset: integer("span_start_offset"),
  spanEndLine: integer("span_end_line"),
  spanEndCol: integer("span_end_col"),
  spanEndOffset: integer("span_end_offset"),
  /** Serialized QuickFix (label + commands + pinSha). */
  fixJson: jsonb("fix_json"),
  docsUrl: text("docs_url"),
}, (t) => [
  index("diagnostics_run_idx").on(t.runId),
  index("diagnostics_code_idx").on(t.code),
  index("diagnostics_severity_idx").on(t.severity),
]);

/* ============================================================================
 * ACTIONS CATALOG
 * ========================================================================== */

/**
 * A published GitHub Action source (owner/repo pair).
 * One row per action, regardless of version.
 */
export const actionSources = pgTable("action_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner: varchar("owner", { length: 255 }).notNull(),
  repo: varchar("repo", { length: 255 }).notNull(),
  /** Subpath within the repo if the action lives in a subdirectory. */
  subpath: varchar("subpath", { length: 1024 }),
  description: text("description"),
  /** Total download/usage count from the GitHub marketplace, if available. */
  usageCount: integer("usage_count"),
  /** Whether this action is marked as a GitHub verified creator. */
  isVerified: boolean("is_verified").notNull().default(false),
  /** Full action.yml/action.yaml parsed payload for input schema display. */
  metaJson: jsonb("meta_json"),
  lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("action_sources_owner_repo_subpath_idx").on(t.owner, t.repo, t.subpath),
]);

/**
 * A specific published version (tag or SHA) of an action.
 * sha is the full 40-char commit SHA for pin-to-SHA quick-fixes.
 */
export const actionVersions = pgTable("action_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => actionSources.id, { onDelete: "cascade" }),
  /** The tag string, e.g. "v4", "v4.0.0". */
  tag: varchar("tag", { length: 255 }).notNull(),
  /** Full 40-char SHA this tag resolves to. */
  sha: varchar("sha", { length: 40 }).notNull(),
  refKind: actionRefKindEnum("ref_kind").notNull().default("tag"),
  /** Parsed release notes / changelog snippet. */
  releaseNotes: text("release_notes"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("action_versions_source_tag_idx").on(t.sourceId, t.tag),
  index("action_versions_source_idx").on(t.sourceId),
]);

/* ============================================================================
 * RUNNER CONNECTIONS
 * ========================================================================== */

/**
 * Self-hosted runner daemon connections registered with Daggler.
 * A runner is scoped to a workspace and may optionally be further restricted
 * to a single repository.
 */
export const runnerConnections = pgTable("runner_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  repositoryId: uuid("repository_id")
    .references(() => repositories.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  /** Opaque token used by the runner agent to authenticate incoming connections. */
  registrationToken: varchar("registration_token", { length: 255 }).notNull(),
  status: runnerStatusEnum("status").notNull().default("offline"),
  /** Labels used to match `runs-on:` values, stored as a jsonb string array. */
  labelsJson: jsonb("labels_json").notNull().default([]),
  /** Runner agent version string, e.g. "2.314.1". */
  agentVersion: varchar("agent_version", { length: 64 }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("runner_connections_token_idx").on(t.registrationToken),
  index("runner_connections_workspace_idx").on(t.workspaceId),
]);

/* ============================================================================
 * EXECUTION TRACKING
 * ========================================================================== */

/**
 * A top-level execution run — corresponds to a single workflow dispatch.
 * Initiated either by the static simulator, the local runner, or GitHub.
 */
export const executionRuns = pgTable("execution_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => workflowFiles.id, { onDelete: "cascade" }),
  /** The revision that was executed (NULL for draft/unsaved runs). */
  revisionId: uuid("revision_id")
    .references(() => workflowRevisions.id, { onDelete: "set null" }),
  initiatedBy: uuid("initiated_by")
    .references(() => users.id, { onDelete: "set null" }),
  /** Runner that handled this run (NULL for static/github modes). */
  runnerId: uuid("runner_id")
    .references(() => runnerConnections.id, { onDelete: "set null" }),
  mode: runModeEnum("mode").notNull(),
  status: executionStatusEnum("status").notNull().default("queued"),
  /** GitHub Actions run id when mode = "github". */
  githubRunId: integer("github_run_id"),
  /** Trigger event that started the run, e.g. "push", "workflow_dispatch". */
  triggerEvent: varchar("trigger_event", { length: 128 }),
  /** Arbitrary inputs/env passed at dispatch time. */
  inputsJson: jsonb("inputs_json"),
  /** Serialized run-level conclusion metadata. */
  conclusionJson: jsonb("conclusion_json"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("execution_runs_file_idx").on(t.fileId),
  index("execution_runs_status_idx").on(t.status),
]);

/**
 * Individual job execution within a run. jobKey is the YAML job id ("build").
 */
export const executionJobs = pgTable("execution_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => executionRuns.id, { onDelete: "cascade" }),
  /** YAML job identifier, e.g. "build", "test". */
  jobKey: varchar("job_key", { length: 255 }).notNull(),
  /** Display name from `name:` or the job key. */
  name: varchar("name", { length: 512 }),
  status: executionStatusEnum("status").notNull().default("queued"),
  /** Which runner labels matched this job's runs-on value. */
  runsOn: jsonb("runs_on_json"),
  /** Matrix combination for this job instance, e.g. { node: "20", os: "ubuntu-latest" }. */
  matrixJson: jsonb("matrix_json"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("execution_jobs_run_idx").on(t.runId),
  index("execution_jobs_status_idx").on(t.status),
]);

/**
 * Individual step execution within a job run.
 */
export const executionSteps = pgTable("execution_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobExecutionId: uuid("job_execution_id")
    .notNull()
    .references(() => executionJobs.id, { onDelete: "cascade" }),
  /** 0-based step index within the job. */
  stepIndex: integer("step_index").notNull(),
  /** Step id from the YAML `id:` field, if set. */
  stepId: varchar("step_id", { length: 255 }),
  /** Step display name. */
  name: varchar("name", { length: 512 }),
  /** The `uses:` value for action steps, or NULL for run steps. */
  uses: varchar("uses", { length: 512 }),
  status: executionStatusEnum("status").notNull().default("queued"),
  /** Process exit code for run steps. */
  exitCode: integer("exit_code"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("execution_steps_job_idx").on(t.jobExecutionId),
  uniqueIndex("execution_steps_job_index_idx").on(t.jobExecutionId, t.stepIndex),
]);

/**
 * Streaming log lines from step or job execution.
 * lineNumber is 1-based within the step's output stream.
 */
export const executionLogs = pgTable("execution_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  stepExecutionId: uuid("step_execution_id")
    .notNull()
    .references(() => executionSteps.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),
  /** "stdout" | "stderr" | "system" */
  stream: varchar("stream", { length: 16 }).notNull().default("stdout"),
  text: text("text").notNull(),
  /** ISO-8601 timestamp embedded in the runner output line, if parsed. */
  loggedAt: timestamp("logged_at", { withTimezone: true }),
}, (t) => [
  index("execution_logs_step_idx").on(t.stepExecutionId),
  uniqueIndex("execution_logs_step_line_idx").on(t.stepExecutionId, t.lineNumber),
]);

/* ============================================================================
 * POLICY MANAGEMENT
 * ========================================================================== */

/**
 * User-defined or built-in policy packs.
 * Built-in packs (oss-maintainer, enterprise-least-privilege, etc.) are seeded
 * at deploy time; isBuiltin flags them as non-deletable.
 */
export const policyPacks = pgTable("policy_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** Stable slug matching PolicyPackId from @daggler/validators, or custom slugs. */
  slug: varchar("slug", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("policy_packs_workspace_slug_idx").on(t.workspaceId, t.slug),
]);

/**
 * Individual policy rules within a pack.
 * Built-in rules are seeded from the validators package at deploy time.
 * Custom rules store a serialized evaluate function body (server-side sandbox).
 */
export const policyRules = pgTable("policy_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  packId: uuid("pack_id")
    .notNull()
    .references(() => policyPacks.id, { onDelete: "cascade" }),
  /** Rule code aligned with Diagnostic.code, e.g. "POL002". */
  code: varchar("code", { length: 64 }).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  description: text("description"),
  severity: diagnosticSeverityEnum("severity").notNull(),
  source: diagnosticSourceEnum("source").notNull(),
  /** "workflow" | "job" | "step" — which IR node type the rule applies to. */
  appliesTo: varchar("applies_to", { length: 32 }).notNull(),
  docsUrl: text("docs_url"),
  exampleBad: text("example_bad"),
  exampleGood: text("example_good"),
  /** Sandboxed JS source for custom rules; NULL for built-in rules (evaluated in-process). */
  evaluateFnSource: text("evaluate_fn_source"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("policy_rules_pack_code_idx").on(t.packId, t.code),
  index("policy_rules_pack_idx").on(t.packId),
]);

/**
 * Policy pack assignments to specific repositories.
 * Controls which packs are active for a repo and whether violations block PRs.
 */
export const repositoryPolicySettings = pgTable("repository_policy_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  packId: uuid("pack_id")
    .notNull()
    .references(() => policyPacks.id, { onDelete: "cascade" }),
  /** When true, critical/error findings from this pack block PR merges. */
  blockMergeOnFailure: boolean("block_merge_on_failure").notNull().default(false),
  /** Minimum severity that triggers a blocking check. */
  blockingSeverity: diagnosticSeverityEnum("blocking_severity").default("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("repo_policy_settings_repo_pack_idx").on(t.repositoryId, t.packId),
  index("repo_policy_settings_repo_idx").on(t.repositoryId),
]);

/* ============================================================================
 * WORKFLOW TEMPLATES
 * ========================================================================== */

/**
 * Reusable workflow templates — starter YAMLs for common CI/CD patterns.
 * Built-in templates are seeded by the platform; workspaceId is NULL for them.
 * Workspace-scoped templates are private to the workspace.
 */
export const workflowTemplates = pgTable("workflow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** NULL = platform built-in; non-NULL = workspace-private template. */
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" }),
  slug: varchar("slug", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  /** Display category shown in the template picker, e.g. "CI", "Security". */
  category: varchar("category", { length: 128 }),
  /** The YAML starter content, may include {{PLACEHOLDER}} tokens. */
  yamlTemplate: text("yaml_template").notNull(),
  /**
   * Variable substitution schema used by the template wizard.
   * Shape: Array<{ key: string; label: string; default?: string; required?: boolean }>.
   */
  variablesJson: jsonb("variables_json"),
  /** Tags for search, e.g. ["node", "docker", "release"]. */
  tagsJson: jsonb("tags_json"),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  /** Usage count for surfacing popular templates at the top of the picker. */
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workflow_templates_workspace_slug_idx").on(t.workspaceId, t.slug),
  index("workflow_templates_category_idx").on(t.category),
]);
