# @daggler/validators

Five-layer semantic validation for GitHub Actions workflows. Runs the full
pipeline (schema, expressions, graph semantics, actions catalog, and policy/
security rules) over a parsed `ParseResult` and returns diagnostics, severity
counts, a security posture score, and a complexity metric.

## Installation

```
pnpm add @daggler/validators
```

## Quick example

```ts
import { parseWorkflow } from "@daggler/workflow-ir";
import { validateWorkflow } from "@daggler/validators";

const parsed = parseWorkflow(yamlText, { path: ".github/workflows/ci.yml" });
const result = validateWorkflow(parsed);

console.log(result.counts);          // { error: 2, warning: 3, info: 1, total: 6 }
console.log(result.security.grade);  // "B"
console.log(result.diagnostics);     // Diagnostic[] sorted by severity then source
```

## `validateWorkflow(parse, opts?): ValidationResult`

```ts
interface ValidateOptions {
  /** Limit findings to a single canonical node-path subtree. */
  onlyPath?: string;
}

interface ValidationResult {
  diagnostics: Diagnostic[];
  counts: { error: number; warning: number; info: number; total: number };
  security: PostureScore;
  complexity: { score: number; jobs: number; steps: number; maxMatrix: number };
}

interface PostureScore {
  score: number;          // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  factors: string[];      // human summary of what dragged the score down
}
```

Diagnostics are deduplicated, enriched with YAML source spans from the
`SourceMap`, assigned stable ids of the form `CODE:path:ordinal`, and sorted
by severity (error > warning > info) then source weight (security first).

```ts
interface Diagnostic {
  id: string;             // e.g. "POL002:step:build#2:0"
  code: string;
  severity: "error" | "warning" | "info";
  source: "parser" | "actionlint" | "semantic" | "policy" | "security";
  title: string;
  message: string;
  path: string;           // canonical node path
  span?: SourceSpan;      // line/col range resolved from the source map
  fix?: QuickFix;
  docsUrl?: string;
}
```

## The five validation layers

Layers run in this order. Each is a pure function `(ctx: ValidationContext) => RawFinding[]`.

| # | Layer | Source tag | Code family | What it checks |
|---|---|---|---|---|
| 0 | Parser | `parser` | `parser/*` | YAML syntax errors and warnings surfaced by the YAML library |
| 1 | Schema | `semantic` | `SCHEMA` | Structural shape: missing `runs-on`, empty step lists, no jobs, no triggers |
| 2 | Expressions | `semantic` | `EXPR` | `${{ }}` context validity: `matrix`, `needs`, `steps`, `inputs` references |
| 3 | Graph semantics | `semantic` | `SEM` | DAG integrity: needs cycles, dangling references, unreachable jobs, matrix size |
| 4 | Actions catalog | `actionlint` | `ACT` | `uses:` step validation against the built-in actions catalog |
| 5 | Policy / security | `policy` / `security` | `POL`, `AGENT` | Security and policy rules from `POLICY_RULES` |

## Diagnostic code families

| Family | Source | Codes | Notes |
|---|---|---|---|
| `SCHEMA` | `semantic` | SCHEMA001–SCHEMA005 | Structural / shape problems |
| `EXPR` | `semantic` | EXPR001–EXPR004 | Expression-context problems |
| `SEM` | `semantic` | SEM001–SEM005 | Graph / dependency problems |
| `ACT` | `actionlint` | ACT001–ACT005 | Actions catalog checks |
| `POL` | `policy` | POL001–POL010 | Policy rules (not security-critical) |
| `AGENT` | `security` | AGENT001–AGENT003 | Agentic workflow injection rules |

### SCHEMA codes

| Code | Severity | Title |
|---|---|---|
| SCHEMA001 | error | Job missing `runs-on` |
| SCHEMA002 | error | Job has no steps |
| SCHEMA003 | warning | Step has neither `run` nor `uses` |
| SCHEMA004 | error | Workflow has no jobs |
| SCHEMA005 | warning | Workflow declares no triggers |

### EXPR codes

| Code | Severity | Title |
|---|---|---|
| EXPR001 | error | `matrix` context without matrix strategy |
| EXPR002 | error | `needs.<name>` not declared in job's needs array |
| EXPR003 | warning | `steps.<id>` references a non-existent step id |
| EXPR004 | warning | `inputs` context without `workflow_dispatch`/`workflow_call` inputs |

### SEM codes

| Code | Severity | Title |
|---|---|---|
| SEM001 | error | Needs cycle (one finding per participating job) |
| SEM002 | error | Undefined needs reference (dangling) |
| SEM003 | warning | Unreachable job |
| SEM005 | info | Large matrix expansion (> 50 combinations) |

### ACT codes

| Code | Severity | Title |
|---|---|---|
| ACT001 | info | Built-in cache not enabled |
| ACT002 | warning | Deprecated action version |
| ACT003 | warning | Required action input missing |
| ACT004 | info | Unknown input passed to official action |
| ACT005 | warning | Undeclared step output referenced in job outputs |

### POL codes

| Code | Severity | Title |
|---|---|---|
| POL001 | warning | No top-level permissions block |
| POL002 | error | Third-party action not SHA-pinned |
| POL003 | error | Privileged token on an untrusted event |
| POL004 | error | Secret reachable from untrusted event |
| POL005 | warning | Broad `contents:write` on PR workflow |
| POL006 | warning | Deploy without environment gate |
| POL007 | error | Action ref uses a branch |
| POL008 | error | Shell injection from untrusted input |
| POL009 | warning | OIDC permission without a cloud step |
| POL010 | warning | Workflow modifies workflow files |

### AGENT codes

| Code | Severity | Title |
|---|---|---|
| AGENT001 | error | Untrusted input flows into an AI agent |
| AGENT002 | warning | Over-permitted AI agent |
| AGENT003 | error | Agent output executed (piped to shell) |

## Policy packs (`POLICY_PACKS`)

Policy rules are grouped into packs. Each `PolicyRule` declares which packs
include it via its `packs` array.

```ts
import { POLICY_PACKS } from "@daggler/validators";
// POLICY_PACKS: PolicyPack[]
```

| Pack id | Name | Focus |
|---|---|---|
| `oss-maintainer` | Open Source Maintainer | Essential security for repos accepting external PRs |
| `enterprise-least-privilege` | Enterprise Least Privilege | Minimal token scopes in regulated environments |
| `release-hardening` | Release Hardening | Pinned actions, provenance, and environment approvals |
| `ai-agent-safety` | AI Agent Workflow Safety | Prompt injection and unconstrained write permissions |
| `docker-publishing` | Docker Publishing | Image signing and registry hygiene |
| `cloud-deploy` | Cloud Deploy | Secure credential handling, environment gates, IAM |

## Actions catalog (`ACTION_CATALOG`)

A curated set of `ActionMeta` records for well-known actions. Powers the
actions layer (required/unknown inputs, cache hints, deprecated versions) and
the "Pin to SHA" quick-fix.

```ts
import { ACTION_CATALOG, KNOWN_SHAS, lookupActionMeta, trustOf } from "@daggler/validators";

const meta = lookupActionMeta("actions", "checkout");
// meta.official === true, meta.latestMajor === "v4", meta.deprecatedRefs === ["v1","v2","v3"]

const report = trustOf(someActionRef);
// { score: 90, level: "high", official: true, pinned: "sha", reasons: [...] }
```

### Trust model

`trustOf(ref: ActionRef): TrustReport` scores a ref on a 0–100 scale:

- +40 for first-party (`actions/*`, `github/*`), +20 for verified org
  (`docker`, `aws-actions`, `google-github-actions`, `azure`, `hashicorp`,
  `actions-rs`), +30 for local actions
- +20 for SHA-pinned, -25 for branch ref
- grade: ≥ 75 = `high`, ≥ 50 = `medium`, < 50 = `low`

## Other exports

```ts
// Raw rule list (PolicyRule[]) — useful for building custom UIs
import { POLICY_RULES } from "@daggler/validators";

// All public types re-exported from ./types.ts
import type {
  Diagnostic, RawFinding, ValidationContext, ValidationResult,
  PostureScore, QuickFix, PolicyRule, PolicyPack, PolicyPackId,
} from "@daggler/validators";
```
