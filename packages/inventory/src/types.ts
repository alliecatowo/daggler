/* ============================================================================
 * @daggler/inventory — type contract.
 *
 * WorkflowSummary: per-file automation surface (triggers, security, actions…).
 * RepoAutomationMap: aggregated view across the whole repo.
 * ========================================================================== */

/** One entry in the third-party actions list of a WorkflowSummary. */
export interface ThirdPartyActionEntry {
  /** Raw `uses:` string, e.g. `docker/build-push-action@v5`. */
  uses: string;
  owner?: string;
  repo?: string;
  ref?: string;
  refKind?: string;
  trust: "high" | "medium" | "low";
  official: boolean;
}

/**
 * A summary of one workflow file's automation surface.
 *
 * Field semantics:
 * - `triggers`          – deduplicated event names (push, pull_request, …)
 * - `schedules`         – cron strings from `on.schedule`
 * - `thirdPartyActions` – `uses:` steps whose owner is not in OFFICIAL_OWNERS
 * - `unpinnedCount`     – actions where refKind is tag or branch and not official
 * - `secretsReferenced` – `secrets.X` names found in any expression across the IR
 * - `envReferenced`     – `env.X` names found in any expression across the IR
 * - `security`          – grade/score from validateWorkflow
 * - `complexity`        – complexity.score from validateWorkflow
 * - `errorCount`        – diagnostic error count
 * - `warningCount`      – diagnostic warning count
 */
export interface WorkflowSummary {
  path: string;
  name?: string;
  triggers: string[];
  schedules: string[];
  jobCount: number;
  stepCount: number;
  thirdPartyActions: ThirdPartyActionEntry[];
  unpinnedCount: number;
  secretsReferenced: string[];
  envReferenced: string[];
  security: { grade: string; score: number };
  complexity: number;
  errorCount: number;
  warningCount: number;
}

/** Aggregated entry in the cross-workflow action-usage table. */
export interface ActionUsageEntry {
  uses: string;
  count: number;
  trust: string;
  official: boolean;
  pinned: boolean;
}

/**
 * The full automation surface map for a repository.
 *
 * - `totals.worstGrade` / `bestGrade` — across all workflow security grades
 * - `totals.ciComplexity`             — sum of complexity scores
 * - `totals.secretsUsed`              — deduplicated across all workflows
 * - `actionUsage`                     — unique `uses:` values with occurrence counts
 */
export interface RepoAutomationMap {
  workflows: WorkflowSummary[];
  totals: {
    workflows: number;
    jobs: number;
    uniqueActions: number;
    unpinnedActions: number;
    worstGrade: string;
    bestGrade: string;
    ciComplexity: number;
    errors: number;
    warnings: number;
    secretsUsed: string[];
  };
  actionUsage: ActionUsageEntry[];
}
