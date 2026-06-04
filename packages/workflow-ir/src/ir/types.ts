/* ============================================================================
 * Daggler — WorkflowIR type contract
 *
 * The IR is the source of truth for Daggler's semantic understanding of a
 * GitHub Actions workflow. Native YAML is parsed *into* this shape; the graph
 * and all validators read *from* it. Every IR object can be traced back to the
 * exact YAML source span via the SourceMap, keyed by a canonical node path.
 *
 * Canonical node-path scheme (stable string keys used across IR, graph, YAML
 * cross-highlighting, and diagnostics — mirrors the design's model.js):
 *
 *   workflow                      the whole file
 *   workflow:name                 the `name:` line
 *   workflow:on                   the `on:` block
 *   workflow:permissions          top-level permissions
 *   workflow:concurrency          top-level concurrency
 *   workflow:env                  top-level env
 *   workflow:jobs                 the `jobs:` map
 *   trigger:<event>               a single trigger, e.g. trigger:push
 *   job:<id>                      a job, e.g. job:build
 *   job:<id>:needs                a job's needs list
 *   job:<id>:permissions          a job's permissions
 *   step:<jobId>#<index>          a step, 0-based, e.g. step:build#3
 * ========================================================================== */

/** A 1-based line/column position plus the absolute character offset. */
export interface Position {
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  col: number;
  /** 0-based absolute character offset into the source. */
  offset: number;
}

/** A source range tying an IR object to its YAML text, keyed by node path. */
export interface SourceSpan {
  /** Canonical node path (see scheme above). */
  path: string;
  start: Position;
  end: Position;
}

export type Severity = "error" | "warning" | "info";

/** Origin of a diagnostic — one of Daggler's five validation layers. */
export type DiagnosticSource =
  | "parser"
  | "actionlint"
  | "semantic"
  | "policy"
  | "security";

/* ---- expressions ---------------------------------------------------------- */

/**
 * A value that may be a literal or contain `${{ }}` expressions. We keep the
 * raw text and a parsed-out list of expression bodies for the context/expression
 * validator, rather than fully evaluating GitHub's expression grammar in v1.
 */
export interface ExpressionIR {
  /** The raw source text, e.g. `${{ matrix.node }}` or `ubuntu-latest`. */
  raw: string;
  /** True if the text contains at least one `${{ … }}`. */
  hasExpression: boolean;
  /** Bodies of each `${{ … }}` found, trimmed, e.g. `matrix.node`. */
  expressions: string[];
}

/* ---- permissions ---------------------------------------------------------- */

export type PermissionLevel = "read" | "write" | "none";

export type PermissionScope =
  | "actions"
  | "attestations"
  | "checks"
  | "contents"
  | "deployments"
  | "discussions"
  | "id-token"
  | "issues"
  | "models"
  | "packages"
  | "pages"
  | "pull-requests"
  | "repository-projects"
  | "security-events"
  | "statuses";

/**
 * Normalized permissions. GitHub allows `read-all`, `write-all`, `{}` (drop all
 * to none), or a scope→level map. We capture all three forms losslessly.
 */
export interface PermissionIR {
  /** `read-all` / `write-all`. */
  all?: "read" | "write";
  /** `permissions: {}` — explicitly drop everything to none. */
  none?: boolean;
  /** Explicit scope → level entries. */
  scopes?: Partial<Record<PermissionScope, PermissionLevel>>;
}

/* ---- triggers ------------------------------------------------------------- */

export interface DispatchInput {
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  type?: "string" | "boolean" | "choice" | "number" | "environment";
  options?: string[];
}

export interface CallSecret {
  description?: string;
  required?: boolean;
}

/** A single normalized trigger. `on` is always normalized into a list of these. */
export interface TriggerIR {
  /** Event name: push, pull_request, workflow_dispatch, schedule, … */
  event: string;
  branches?: string[];
  branchesIgnore?: string[];
  tags?: string[];
  tagsIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
  /** Activity types, e.g. for pull_request: opened, synchronize, … */
  types?: string[];
  /** schedule: list of cron strings. */
  schedule?: string[];
  /** workflow_dispatch / workflow_call declared inputs. */
  inputs?: Record<string, DispatchInput>;
  /** workflow_call declared secrets. */
  secrets?: Record<string, CallSecret>;
  /** workflow_call declared outputs (value expressions). */
  outputs?: Record<string, string>;
  /** Anything we did not model, preserved verbatim. */
  raw?: unknown;
}

/* ---- jobs / steps --------------------------------------------------------- */

export interface ConcurrencyIR {
  group: string;
  cancelInProgress?: boolean;
}

export interface DefaultsIR {
  shell?: string;
  workingDirectory?: string;
}

export interface MatrixIR {
  /** Standard matrix dimensions, e.g. { node: ["18","20","22"] }. */
  dimensions: Record<string, Array<string | number | boolean>>;
  include?: Array<Record<string, string | number | boolean>>;
  exclude?: Array<Record<string, string | number | boolean>>;
  /** True when the whole matrix is sourced from a `${{ }}` expression. */
  fromExpression?: boolean;
  /** Total expansion count (product of dimensions, before include/exclude). */
  size: number;
}

export interface StrategyIR {
  matrix?: MatrixIR;
  failFast?: boolean;
  maxParallel?: number;
}

export interface EnvironmentIR {
  name: string;
  url?: string;
}

/** A parsed `owner/repo[/subpath]@ref` (or local/docker) action reference. */
export interface ActionRef {
  raw: string;
  kind: "remote" | "local" | "docker" | "unknown";
  owner?: string;
  repo?: string;
  subpath?: string;
  ref?: string;
  /** How the ref pins: full 40-char sha, a tag like v4, or a branch. */
  refKind?: "sha" | "tag" | "branch" | "unknown";
}

export interface ReusableWorkflowCallIR {
  raw: string;
  kind: "remote" | "local" | "unknown";
  owner?: string;
  repo?: string;
  path?: string;
  ref?: string;
  refKind?: "sha" | "tag" | "branch" | "unknown";
}

interface StepBase {
  /** Canonical path, e.g. step:build#3. */
  path: string;
  /** 0-based index within the job's step list. */
  index: number;
  id?: string;
  name?: string;
  if?: string;
  env?: Record<string, string>;
  continueOnError?: boolean;
  timeoutMinutes?: number;
}

export interface UsesStepIR extends StepBase {
  kind: "uses";
  uses: string;
  ref: ActionRef;
  with?: Record<string, string | number | boolean>;
}

export interface RunStepIR extends StepBase {
  kind: "run";
  run: string;
  shell?: string;
  workingDirectory?: string;
}

/** Anything the parser could not classify into uses/run, preserved verbatim. */
export interface RawStepIR extends StepBase {
  kind: "raw";
  raw: unknown;
}

export type StepIR = UsesStepIR | RunStepIR | RawStepIR;

export interface JobIR {
  /** Job key, e.g. `build`. */
  id: string;
  /** Canonical path, always `job:<id>`. */
  path: string;
  name?: string;
  /** `runs-on`. May be a string, list, or contain expressions. */
  runsOn?: string | string[];
  needs: string[];
  if?: string;
  permissions?: PermissionIR;
  env?: Record<string, string>;
  defaults?: DefaultsIR;
  strategy?: StrategyIR;
  concurrency?: ConcurrencyIR;
  environment?: EnvironmentIR;
  timeoutMinutes?: number;
  continueOnError?: boolean;
  /** Job outputs: name → value expression. */
  outputs?: Record<string, string>;
  steps: StepIR[];
  /** Set when this job is a reusable-workflow call (`uses:` at job level). */
  uses?: ReusableWorkflowCallIR;
  /** Inputs passed to a called reusable workflow. */
  with?: Record<string, string | number | boolean>;
  /** Secrets passed to a called reusable workflow. */
  secrets?: Record<string, string> | "inherit";
  kind: "normal" | "reusable";
  raw?: unknown;
}

export interface WorkflowIR {
  name?: string;
  runName?: string;
  /** File path, e.g. `.github/workflows/ci.yml`. */
  path: string;
  on: TriggerIR[];
  permissions?: PermissionIR;
  env?: Record<string, string>;
  defaults?: DefaultsIR;
  concurrency?: ConcurrencyIR;
  jobs: JobIR[];
  /** The original parsed JS object (post-YAML), for raw inspection. */
  raw: unknown;
}

/* ---- parse result --------------------------------------------------------- */

export interface ParseDiagnostic {
  code: string;
  message: string;
  severity: Severity;
  span?: SourceSpan;
}

export interface ParseResult {
  /** May be a best-effort partial IR even when there are syntax errors. */
  ir: WorkflowIR;
  /** Path → source span, for cross-highlighting. */
  sourceMap: SourceMapData;
  /** Syntax / structural problems found while parsing. */
  diagnostics: ParseDiagnostic[];
  /** True if the YAML parsed without fatal errors. */
  ok: boolean;
}

/** Serializable source-map payload: a path→span record plus the source text. */
export interface SourceMapData {
  spans: Record<string, SourceSpan>;
  /** The exact source text the spans index into. */
  source: string;
}
