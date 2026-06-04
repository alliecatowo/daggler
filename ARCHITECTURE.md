# Daggler Architecture

## Design principles

**Modular monolith with hexagonal ports.** All domain logic lives in a small set of packages with a clear dependency order. External concerns (GitHub API, local runner, Postgres, the browser) are kept behind typed port interfaces. Swapping an adapter never touches domain code.

**IR as source of truth; YAML is a projection.** The canonical representation of a workflow is the `WorkflowIR`. Raw YAML is parsed into the IR on read and serialized back on write, but edits are applied as structured `EditorCommand` patches against the original YAML string — not against the IR — so comments, whitespace, and formatting survive every round-trip.

**Honest stubs, never fake results.** Where a feature requires external infrastructure that is not yet connected (a real runner, a GitHub App, a live Postgres connection), the relevant adapter reports its capabilities accurately and throws a clear `NotConnectedError`. Nothing in the codebase silently pretends to run workflows.

---

## Package dependency graph

```
                        ┌──────────────────────┐
                        │   @daggler/workflow-ir│  (semantic core)
                        │  parse · IR · graph  │
                        │  serialize · patches │
                        └────────────┬─────────┘
                                     │  imports
                        ┌────────────▼─────────┐
                        │  @daggler/validators  │  (static analysis)
                        │  5 layers · policies │
                        │  action catalog       │
                        └────┬────────┬────────┘
                             │        │
              ┌──────────────▼──┐  ┌──▼────────────────────────┐
              │@daggler/runner- │  │      @daggler/github       │
              │protocol         │  │  GitHubRepositoryPort      │
              │AnalyzerAdapter  │  │  InMemoryGitHubAdapter     │
              │ActAdapter       │  └──────────────────────────┬─┘
              │GitHubDispatch   │                             │
              │Adapter          │                             │
              └────────┬────────┘                            │
                       │                                     │
        ┌──────────────▼──────────────────────────────────▼─┐
        │                  @daggler/db                        │
        │  Drizzle ORM Postgres schema (self-host only)       │
        └─────────────────────────────────────────────────────┘
                       │                       │
        ┌──────────────▼──┐        ┌───────────▼───────────┐
        │   apps/worker   │        │       apps/web         │
        │  Graphile Worker│        │  Next.js 15 editor     │
        │  job registry   │        │  (engine runs in       │
        └─────────────────┘        │   the browser)         │
                                   └───────────────────────┘
        ┌─────────────────────────────────────────────────────┐
        │                    apps/cli                          │
        │          daggler lint (Node ESM, tsup build)         │
        └─────────────────────────────────────────────────────┘
```

`apps/web` and `apps/cli` both import `@daggler/workflow-ir` and `@daggler/validators` directly. The entire analysis pipeline is isomorphic: it runs in the browser, in the CLI, and in the worker without modification.

---

## Packages

### `@daggler/workflow-ir` — semantic core

Transforms raw GitHub Actions YAML into a typed intermediate representation and back.

**Parse.** `parseWorkflow(yaml, opts)` uses a YAML parser to produce a `WorkflowIR` containing typed jobs (`JobIR`), steps (`StepIR`), triggers (`TriggerIR`), permissions, strategy/matrix, concurrency, outputs, and environment references. The parser records a `SourceMap` — a mapping from every canonical node path (e.g. `"step:build#2"`) to its byte offset, line, and column in the original YAML. Parse diagnostics (syntax errors, unrecognizable keys) are attached to the `ParseResult`.

**Graph.** `buildGraph(ir)` projects the IR into a `WorkflowGraph`: nodes (one per job), edges (one per `needs` relationship), pre-computed topological depths for layout, and cycle/unreachable detection (`hasCycle`, `cycleNodes`, `unreachable`).

**Serialize.** `serialize(ir)` / `denormalize(ir)` convert an IR back to a YAML string for export.

**Patches.** `applyCommand(yaml, command)` takes the original YAML string and a structured `EditorCommand` (e.g. rename a job, change `runs-on`, set a `uses` ref) and produces a new YAML string using targeted substring replacement. Comments and formatting outside the patched region are preserved. `pinActionToSha(yaml, jobId, stepIndex, sha)` replaces a mutable tag with a verified 40-character SHA.

Key exports: `parseWorkflow`, `buildGraph`, `serialize`, `applyCommand`, `pinActionToSha`, `SourceMap`, `SAMPLE_WORKFLOWS`, `SAMPLE_BY_ID`, plus all IR types and path helpers.

---

### `@daggler/validators` — five validation layers + policy engine

`validateWorkflow(parseResult)` orchestrates all layers over a single `ParseResult` and returns a `ValidationResult`:

```
ParseResult
    │
    ├─ Layer 0: parser      — syntax/parse diagnostics from @daggler/workflow-ir
    ├─ Layer 1: schema      — structural shape (missing runs-on, empty steps, no jobs)
    ├─ Layer 2: expressions — ${{ }} context availability (matrix, needs, steps, inputs)
    ├─ Layer 3: graph       — needs cycles, dangling references, unreachable jobs, matrix explosion
    ├─ Layer 4: actions     — ACTION_CATALOG checks (cache hints, deprecated versions, unknown inputs)
    └─ Policy engine        — 13 security/policy rules (POL001–POL010, AGENT001–AGENT003)
```

Each layer is a pure function `(ValidationContext) => RawFinding[]`. The orchestrator de-duplicates findings, resolves source spans from the `SourceMap`, assigns stable ids (`code:path:ordinal`), sorts by severity then source weight, and computes:

- **Diagnostic counts** — error / warning / info / total.
- **Security posture score** — starts at 100; `security`-source errors deduct 18 points, warnings deduct 8; `policy`-source errors deduct 12, warnings deduct 6. Graded A (≥90) through F (<40). Named factors (e.g. "Unpinned third-party actions") are derived from which rule codes fired.
- **Complexity metric** — `jobs × 3 + steps + maxMatrixSize × 2 + needsEdges`.

**Policy engine.** `POLICY_RULES` is an array of `PolicyRule` objects. Each rule is self-contained: it declares its code, severity, source tag (`"security"` or `"policy"`), which node type it applies to, documentation URL, example bad/good YAML, and an `evaluate(ctx)` function. Rules are evaluated inside a try/catch so a misbehaving rule cannot crash validation.

**Policy packs.** Six built-in packs group rules by use-case:

| Pack id | Purpose |
|---|---|
| `oss-maintainer` | Open-source repos accepting external PRs |
| `enterprise-least-privilege` | Minimal GITHUB_TOKEN scopes |
| `release-hardening` | Locked-down release/publish workflows |
| `ai-agent-safety` | Prompt-injection guards for agentic workflows |
| `docker-publishing` | Container build/push best practices |
| `cloud-deploy` | Secure cloud deployment patterns |

**Action catalog.** `ACTION_CATALOG` and `KNOWN_SHAS` contain curated metadata for common actions (`actions/checkout`, `actions/setup-node`, `docker/build-push-action`, `aws-actions/configure-aws-credentials`, etc.) including real API-resolved commit SHAs that the patch engine uses for pin-to-SHA quick-fixes.

---

### `@daggler/runner-protocol` — the confidence ladder

The single seam between Daggler's analysis core and any execution backend is the `RunnerPort` interface:

```typescript
interface RunnerPort {
  capabilities(): RunnerCapabilities;
  startRun(req: RunnerRunRequest): Promise<RunnerRunResult>;
}
```

`RunnerCapabilities` declares the adapter's rung (`"analyzer" | "act" | "github"`), which infrastructure it has (git, Docker, act), and whether its results are authoritative.

Three adapters ship, forming the confidence ladder:

| Rung | Id | Adapter | Status |
|---|---|---|---|
| 1 | `static` | `AnalyzerAdapter` | **Fully implemented.** Calls `parseWorkflow` + `validateWorkflow` in-process; converts every `Diagnostic` into a `RunnerLogEvent`. No external deps. Always available. |
| 2 | `local` | `ActAdapter` | **Typed stub.** Reports it requires the `daggler bridge` with nektos/act. `startRun` throws `NotConnectedError` until wired. |
| 3 | `github` | `GitHubDispatchAdapter` | **Typed stub.** Reports it requires a connected GitHub App. `startRun` throws `NotConnectedError` until wired. |

`CONFIDENCE_LADDER` is the exported ordered array of `ConfidenceLadderRung` objects. Consumers walk up from rung 0 and pick the highest rung whose adapter does not throw on `startRun`.

`NotConnectedError` is the typed sentinel that distinguishes "infrastructure not wired" from other failures.

---

### `@daggler/github` — GitHub repository port

`GitHubRepositoryPort` is the hexagonal boundary for any GitHub backend:

```typescript
interface GitHubRepositoryPort {
  listRepos(): Promise<RepoRef[]>;
  getFile(repo, path, ref?): Promise<FileBlob>;
  listWorkflowFiles(repo, ref?): Promise<string[]>;
  createBranch(repo, name, fromSha): Promise<BranchRef>;
  commitFile(repo, branch, path, content, message): Promise<FileBlob>;
  openPullRequest(repo, headRef, baseRef, title, body): Promise<PullRequestRef>;
  listWorkflowRuns(repo): Promise<WorkflowRunRef[]>;
  dispatchWorkflow(repo, path, ref, inputs?): Promise<void>;
}
```

Error contract: methods throw `Error` with prefixed messages (`NOT_CONNECTED:`, `NOT_FOUND:`, `CONFLICT:`) so callers can react without string-matching the full message.

`InMemoryGitHubAdapter` is a full, faithful in-memory implementation: state lives in plain `Map`s, SHAs are deterministic fakes (`sha-<counter>`), PRs are auto-numbered. Used for unit tests and local demo mode. It also exposes `resolveWorkflowRun(repo, runId, conclusion)` as a test-utility helper.

A real Octokit-backed adapter is the natural next step; it will satisfy the same port without touching any domain code.

---

### `@daggler/db` — Drizzle ORM Postgres schema

The full relational model for self-hosted deployments, expressed with Drizzle ORM targeting Postgres. All UUIDs use `gen_random_uuid()`, all timestamps are `WITH TIME ZONE`, all JSON blobs use `jsonb` for indexability.

Tables by domain area:

| Area | Tables |
|---|---|
| Identity & OAuth | `users`, `accounts` |
| Multi-tenant workspaces | `workspaces`, `workspaceMembers` |
| GitHub App integration | `githubInstallations`, `repositories` |
| Workflow authoring | `workflowFiles`, `workflowRevisions`, `workflowDrafts` |
| Visual layout | `workflowLayouts` |
| Validation output | `validationRuns`, `diagnostics` |
| Actions catalog | `actionSources`, `actionVersions` |
| Runner connections | `runnerConnections` |
| Execution tracking | `executionRuns`, `executionJobs`, `executionSteps`, `executionLogs` |
| Policy management | `policyPacks`, `policyRules`, `repositoryPolicySettings` |
| Workflow templates | `workflowTemplates` |

`workflowRevisions` stores the serialized `WorkflowIR` and `WorkflowGraph` as JSONB so the server can query into the IR without re-parsing. `workflowDrafts` persists unsaved YAML and the serialized undo/redo command stack so the editor can restore state after a page reload. `executionRuns` records the `run_mode` enum (`static | local | github`) that mirrors the confidence ladder rungs.

---

### `apps/worker` — Graphile Worker job registry

The worker process drains a Postgres-backed job queue using Graphile Worker. `JOB_REGISTRY` maps canonical task identifiers to typed handler functions:

| Job id | Status | What it does |
|---|---|---|
| `parse.workflow` | **Real** | Calls `parseWorkflow`, returns job count + diagnostic count |
| `validate.workflow` | **Real** | Calls `parseWorkflow` + `validateWorkflow`, returns diagnostic summary |
| `sync.installation` | Stub | Will enumerate repos for a GitHub App installation |
| `sync.repository` | Stub | Will fetch repo metadata, enqueue `sync.workflowFiles` |
| `sync.workflowFiles` | Stub | Will fetch `.github/workflows/` tree, enqueue parse + validate jobs |
| `index.action` | Stub | Will resolve action ref to SHA, upsert actions catalog |
| `create.workflowPr` | Stub | Will create a branch + PR with updated workflow YAML |
| `import.workflowRun` | Stub | Will import workflow run details (jobs, steps, timings) from GitHub |
| `dispatch.githubRun` | Stub | Will fire `workflow_dispatch` via GitHub Actions REST API |

Stub handlers throw a clear not-connected error describing exactly which credentials are required. In dev mode, `src/index.ts` runs `validate.workflow` against the bundled `"ci-release"` sample as a smoke test.

---

### `apps/web` — Next.js 15 browser editor

The browser-side engine (`src/lib/engine.ts`) runs the full pipeline — `parseWorkflow` → `buildGraph` → `validateWorkflow` — on every keystroke. No validation server is needed. `analyze(source, path)` returns a single `Analysis` object containing the IR, graph, source map, validation result, a path-indexed diagnostic map (`diagByPath`), and a per-job worst-severity index (`jobSeverity`) used to draw graph badges.

Key UI panels: graph canvas (SVG DAG with bezier `needs` edges), Monaco YAML editor, typed inspector (job/step properties, permissions, action metadata), diagnostics panel, confidence ladder (top bar), and a command palette.

---

### `apps/cli` — daggler terminal linter

Built with tsup into a self-contained Node ESM bundle. Commands:

```
daggler lint [paths...] [--json] [--quiet] [--no-color]
daggler help | --help | -h
daggler --version
```

Scans `.github/workflows/` by default; falls back to bundled sample workflows when that directory does not exist. With `--json`, emits a structured JSON array (one object per file with `security`, `counts`, and `diagnostics`). Exit code 1 when any errors are found.

The CLI uses `picocolors` for terminal output. Color is automatically disabled with `--no-color`. Diagnostics print with severity glyphs, source-mapped line/column locations, and a per-file security grade line.

---

## Request flow: editing a workflow in the web editor

```
1. User types YAML into Monaco editor
       │
       ▼
2. apps/web/src/lib/engine.ts: analyze(source, path)
   │  parseWorkflow(source)        → ParseResult + SourceMap
   │  buildGraph(ir)               → WorkflowGraph (nodes, edges, depths)
   │  validateWorkflow(parseResult)→ ValidationResult
   │                                   - Layer 0: parser diagnostics
   │                                   - Layer 1: schema checks
   │                                   - Layer 2: expression checks
   │                                   - Layer 3: graph semantics
   │                                   - Layer 4: action catalog
   │                                   - Policy engine (13 rules)
   │                               → security posture score + grade
   │                               → complexity metric
   └──→ Analysis { ir, graph, sourceMap, validation, diagByPath, jobSeverity }
              │
              ▼
3. React state update
   ├─ Graph canvas redraws SVG nodes + edges, applies severity badge colors
   ├─ Monaco editor receives diagnostic markers with line/col spans from SourceMap
   ├─ Diagnostics panel lists findings sorted by severity → source weight → line
   └─ Confidence ladder shows static analysis result summary

4. User clicks "Pin to SHA" quick-fix on a POL002 finding
       │
       ▼
5. applyCommand(yaml, { type: "pin-to-sha", jobId, stepIndex, sha })
   │  Targeted substring patch against the raw YAML string
   └──→ new YAML string (comments and unrelated formatting preserved)

6. Monaco editor source updated → step 1 repeats
```

---

## The confidence ladder in detail

The ladder lets users understand exactly how authoritative a result is before acting on it.

**Static (rung 1 — always available).** `AnalyzerAdapter` runs `parseWorkflow` + `validateWorkflow` synchronously in-process. Results are deterministic, fast enough to compute on every keystroke, and require no external infrastructure. This is where all validation logic actually lives.

**Local (rung 2 — requires daggler bridge).** `ActAdapter` is the typed adapter that will connect to a local `daggler bridge` process running nektos/act with Docker. Until the bridge is running, `startRun` throws `NotConnectedError`. The CLI command is `npx daggler bridge`.

**GitHub (rung 3 — requires GitHub App).** `GitHubDispatchAdapter` is the typed adapter that will forward `workflow_dispatch` events to real GitHub-hosted runners via a connected GitHub App. Results from this rung are authoritative ground truth. Until a GitHub App is installed and connected, `startRun` throws `NotConnectedError`.

The UI walks up the ladder at run-time, picks the highest rung that does not throw, and surfaces its `RunnerCapabilities` in the top bar so users always know what they are looking at.
