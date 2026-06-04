# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-03

### Added

#### `@daggler/workflow-ir`
- `parseWorkflow` — parses GitHub Actions YAML into a typed `WorkflowIR` with jobs, steps, triggers, permissions, strategy/matrix, concurrency, and outputs.
- `SourceMap` — maps every canonical IR node path to its byte offset, line, and column in the original YAML source.
- `buildGraph` — projects the IR into a `WorkflowGraph` with topological depths, cycle detection (`hasCycle`, `cycleNodes`), and unreachable-job detection.
- `serialize` / `denormalize` — round-trip an IR back to a YAML string.
- `applyCommand` — applies structured `EditorCommand` patches to the raw YAML string, preserving comments and formatting.
- `pinActionToSha` — replaces a mutable action tag with a verified full 40-character SHA.
- `SAMPLE_WORKFLOWS` / `SAMPLE_BY_ID` — bundled sample workflows for demo and test use.
- Node-path helpers: `jobPath`, `stepPath`, `workflowField`, `jobIdOfPath`.
- 17 passing tests covering parse structure, graph build, source map spans, serialize round-trip, and patch application.

#### `@daggler/validators`
- `validateWorkflow` — orchestrates all five validation layers and the policy engine over a `ParseResult`.
- **Layer 0 (parser)** — surfaces syntax errors and warnings from the IR parser.
- **Layer 1 (schema)** — checks required fields, empty step lists, missing `runs-on`, no jobs, no triggers (SCHEMA001–SCHEMA005).
- **Layer 2 (expressions)** — validates `${{ }}` context availability: `matrix` without a matrix strategy, `needs.<name>` not in needs array, `steps.<id>` referencing a non-existent step, `inputs` without dispatch/call triggers (EXPR001–EXPR004).
- **Layer 3 (graph semantics)** — detects needs cycles, dangling references, unreachable jobs, and matrix combinations exceeding 50 (SEM001–SEM003, SEM005).
- **Layer 4 (actions)** — validates `uses:` steps against the curated `ACTION_CATALOG`: cache-not-enabled hints, deprecated major versions, missing required inputs, unknown inputs for official actions, undeclared step outputs (ACT001–ACT005).
- **Policy engine** — 13 pure security and policy rules (POL001–POL010, AGENT001–AGENT003) covering: no permissions block, unpinned third-party actions, privileged token on untrusted event, secret reachable from untrusted event, broad `contents:write` on PR workflows, deploy without environment gate, branch-pinned action ref, shell injection from untrusted input, OIDC permission without cloud step, workflow self-modification, agentic prompt injection, over-permitted AI agents, and agent output execution.
- **Six built-in policy packs** — `oss-maintainer`, `enterprise-least-privilege`, `release-hardening`, `ai-agent-safety`, `docker-publishing`, `cloud-deploy`.
- **Security posture score** — 0–100 score with A–F grade and named contributing factors.
- **Complexity metric** — computed from job count, step count, max matrix size, and `needs` edges.
- `ACTION_CATALOG` and `KNOWN_SHAS` — curated metadata and real API-resolved commit SHAs for common actions.
- 20 passing tests covering all 13 policy/security rules, schema checks, expression validation, and the security posture score.

#### `@daggler/runner-protocol`
- `RunnerPort` interface — the hexagonal port every execution backend must satisfy.
- `RunnerCapabilities` — typed descriptor of what an adapter can actually do.
- `NotConnectedError` — typed sentinel for infrastructure-not-wired failures.
- `AnalyzerAdapter` — rung 1 of the confidence ladder; fully implemented using `@daggler/validators`. No external dependencies.
- `ActAdapter` — rung 2 stub; reports it requires the `daggler bridge` with nektos/act; throws `NotConnectedError` until wired.
- `GitHubDispatchAdapter` — rung 3 stub; reports it requires a connected GitHub App; throws `NotConnectedError` until wired.
- `CONFIDENCE_LADDER` — exported ordered array of `ConfidenceLadderRung` factory objects.

#### `@daggler/github`
- `GitHubRepositoryPort` — hexagonal port interface for any GitHub backend with typed value types (`RepoRef`, `FileBlob`, `BranchRef`, `PullRequestRef`, `WorkflowRunRef`).
- `InMemoryGitHubAdapter` — full in-memory implementation of the port; branch-isolated file snapshots, auto-incrementing PR numbers, deterministic fake SHAs. Used in tests and local demo mode.
- Structured error contract: `NOT_CONNECTED:`, `NOT_FOUND:`, `CONFLICT:` prefixed messages.

#### `@daggler/db`
- Drizzle ORM Postgres schema covering the complete self-hosted data model: 20 tables across identity/OAuth, multi-tenant workspaces, GitHub App installations, repository tracking, workflow files/revisions/drafts, visual canvas layouts, validation runs and individual diagnostics, actions marketplace catalog, self-hosted runner registrations, execution tracking (runs/jobs/steps/logs), policy pack management, and reusable workflow templates.
- PostgreSQL enums aligned with domain types: `workspace_member_role`, `diagnostic_severity`, `diagnostic_source`, `execution_status`, `run_mode`, `action_ref_kind`, `runner_status`, `oauth_provider`.

#### `apps/worker`
- `JOB_REGISTRY` — canonical Graphile Worker task registry with nine job types.
- `parse.workflow` and `validate.workflow` — fully implemented in-process handlers backed by `@daggler/workflow-ir` and `@daggler/validators`.
- Seven additional stub handlers (`sync.installation`, `sync.repository`, `sync.workflowFiles`, `index.action`, `create.workflowPr`, `import.workflowRun`, `dispatch.githubRun`) with clear not-connected errors and inline documentation of required credentials.
- Dev-mode entry point that smoke-tests `validate.workflow` against the bundled `"ci-release"` sample.

#### `apps/web`
- Next.js 15 + React 19 browser editor.
- Client-side engine (`src/lib/engine.ts`): `analyze(source, path)` runs the full parse → graph → validate pipeline in the browser on every keystroke; produces a path-indexed diagnostic map and per-job worst-severity index.
- Graph canvas (SVG DAG with bezier `needs` edges), Monaco YAML editor, typed inspector panel, diagnostics panel, confidence ladder top bar, command palette, and sidebar.

#### `apps/cli`
- `daggler lint [paths...] [--json] [--quiet] [--no-color]` — terminal linter backed by the real analysis engine.
- Scans `.github/workflows/` by default; falls back to bundled sample workflows when that directory is absent.
- `--json` mode emits a structured JSON array with per-file security scores and full diagnostic lists.
- `--quiet` suppresses warnings and infos, printing only errors.
- Exit code 1 when any error-severity findings are present.
- `daggler help` and `daggler --version`.
