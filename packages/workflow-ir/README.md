# @daggler/workflow-ir

The semantic core of Daggler. Parses native GitHub Actions YAML into a typed IR,
projects it into a renderable graph, serializes it back to YAML, and applies
source-preserving structured edits.

## Installation

```
pnpm add @daggler/workflow-ir
```

## Quick example

```ts
import { parseWorkflow, buildGraph, serialize, applyCommand } from "@daggler/workflow-ir";

// 1. Parse YAML into IR + source map
const result = parseWorkflow(yamlText, { path: ".github/workflows/ci.yml" });
console.log(result.ok);           // true when no fatal YAML errors
console.log(result.ir.jobs);      // JobIR[]
console.log(result.diagnostics);  // ParseDiagnostic[] from the parser

// 2. Build the dependency graph
const graph = buildGraph(result.ir);
console.log(graph.hasCycle);      // boolean
console.log(graph.jobs);          // JobGraphNode[] with depth/row layout

// 3. Apply a structured edit (preserves comments and formatting elsewhere)
const patch = applyCommand(yamlText, { type: "job.rename", jobId: "build", name: "Build & Test" });
if (patch.ok) console.log(patch.source); // modified YAML string

// 4. Round-trip serialize back to YAML
const yaml = serialize(result.ir);
```

## Public API

### `parseWorkflow(source, options?): ParseResult`

Parses a GitHub Actions YAML string. Always returns a `ParseResult` — on YAML
errors the IR is a best-effort partial object and `ok` is `false`.

```ts
interface ParseOptions {
  /** File path recorded on the IR, e.g. `.github/workflows/ci.yml`. */
  path?: string;
}

interface ParseResult {
  ir: WorkflowIR;
  sourceMap: SourceMapData;   // serializable spans record + source text
  diagnostics: ParseDiagnostic[];
  ok: boolean;
}
```

### `buildGraph(ir: WorkflowIR): WorkflowGraph`

Projects the IR into a DAG suited for canvas rendering and structural analysis.
Runs longest-path layering (column = `depth`), detects cycles via DFS coloring,
and identifies jobs that can never run.

```ts
interface WorkflowGraph {
  jobs: JobGraphNode[];       // depth/row layout already computed
  triggers: TriggerGraphNode[];
  edges: GraphEdge[];         // kind: "needs" | "trigger"
  hasCycle: boolean;
  cycleNodes: string[];       // job ids on any cycle
  unreachable: string[];      // job ids that can never run
  maxDepth: number;
}
```

### `serialize(ir: WorkflowIR): string`

Denormalizes the IR back to a plain GitHub Actions object and stringifies it
with the `yaml` library. Use for templates and new-workflow exports. For
in-place edits to existing YAML, prefer `applyCommand`.

### `denormalize(ir: WorkflowIR): Record<string, unknown>`

The plain-JS denormalization step that `serialize` wraps. Useful when you need
the raw object before stringifying.

### `applyCommand(source, command): PatchResult`

Applies a single structured edit to YAML source text via the `yaml` Document
CST API. Comments and formatting in unaffected parts of the file are preserved.
Returns the new source string and an `ok` flag.

```ts
type EditorCommand =
  | { type: "workflow.rename"; name: string }
  | { type: "job.rename"; jobId: string; name: string }
  | { type: "job.runsOn"; jobId: string; runsOn: string }
  | { type: "job.addNeed"; jobId: string; need: string }
  | { type: "job.removeNeed"; jobId: string; need: string }
  | { type: "step.setName"; jobId: string; index: number; name: string }
  | { type: "step.setUses"; jobId: string; index: number; uses: string }
  | { type: "step.setRun"; jobId: string; index: number; run: string }
  | { type: "step.setWith"; jobId: string; index: number; key: string; value: string }
  | { type: "permissions.set"; scope: "workflow" | { jobId: string }; key: string; level: "read" | "write" | "none" };

interface PatchResult { source: string; ok: boolean; error?: string; }
```

### `pinActionToSha(source, jobId, stepIndex, sha, versionComment?): PatchResult`

Replaces a `uses:` step's `@tag` or `@branch` with a pinned SHA, appending
the original ref as a trailing comment. Used by the "Pin to SHA" quick-fix.

### `SourceMap`

A runtime wrapper around `SourceMapData` with two lookup directions:

```ts
class SourceMap {
  spanForPath(path: string): SourceSpan | undefined;
  pathAtLine(line: number): string | undefined;   // most-specific node for a 1-based line
  pathsAtLine(line: number): string[];
}
```

### `makePositioner(source: string): (offset: number) => Position`

Builds an offset-to-line/col converter for a source string (positions are
1-based line/col + 0-based absolute offset).

## Node-path scheme

Every IR object is identified by a stable string key used across the IR,
graph, source map, and diagnostics:

| Path | What it identifies |
|---|---|
| `workflow` | The whole file |
| `workflow:name` | The `name:` field |
| `workflow:on` | The `on:` block |
| `workflow:permissions` | Top-level permissions |
| `workflow:concurrency` | Top-level concurrency |
| `workflow:env` | Top-level env |
| `workflow:jobs` | The `jobs:` map |
| `trigger:<event>` | A single trigger, e.g. `trigger:push` |
| `job:<id>` | A job, e.g. `job:build` |
| `job:<id>:needs` | A job's needs list |
| `job:<id>:permissions` | A job's permissions block |
| `step:<jobId>#<index>` | A step (0-based index), e.g. `step:build#3` |

Path helper functions are exported: `jobPath`, `jobField`, `stepPath`,
`triggerPath`, `workflowField`, `parsePath`, `jobIdOfPath`, `prettyPath`.

## Sample workflows

```ts
import { SAMPLE_WORKFLOWS, SAMPLE_BY_ID } from "@daggler/workflow-ir";

// SAMPLE_WORKFLOWS: SampleWorkflow[]  (5 entries)
// SAMPLE_BY_ID: Record<string, SampleWorkflow>

for (const sample of SAMPLE_WORKFLOWS) {
  console.log(sample.id, sample.tag, sample.description);
  // e.g. "ci-release", "pipeline", "A four-stage pipeline…"
}
```

The five bundled samples are: `ci-release`, `pr-preview`, `triage-agent`,
`broken-graph`, and `minimal`. Each is crafted to exercise specific
diagnostics and is the demo corpus shown when no `.github/workflows`
directory is found.
