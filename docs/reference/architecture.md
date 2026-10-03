# Architecture

```
daggler/
├── apps/
│   ├── cli/       daggler-cli: terminal linter (tsup, Node ESM)
│   ├── web/       Next.js 15 + React 19 editor
│   └── worker/    Graphile Worker job registry (stubs)
└── packages/
    ├── workflow-ir/      parser, IR, graph, serialize, patches
    ├── validators/       validation layers, policy engine, actions catalog
    ├── runner-protocol/  RunnerPort and the confidence ladder
    ├── runner/           act and actionlint adapters
    ├── github/           GitHub repository port and adapters
    ├── inventory/        repository automation map
    └── db/               Drizzle Postgres schema
```

## `@daggler/workflow-ir`

1. **Parse** YAML into a `WorkflowIR` (jobs, steps, triggers, permissions, matrix, concurrency, outputs).
2. **Source map** every IR node back to its offset, line and column in the original YAML.
3. **Graph**: `buildGraph` projects jobs and `needs` edges into a `WorkflowGraph` with depths for layout, cycle detection and unreachable-job detection.
4. **Serialize**: `serialize` and `denormalize` round-trip an IR to YAML.
5. **Patches**: `applyCommand` applies structured edits while preserving comments and formatting; `pinActionToSha` swaps a mutable tag for a verified SHA.

## `@daggler/validators`

See [Validation layers](/reference/validation) and [Policy rules](/reference/policy-rules).

For the full design notes, read [ARCHITECTURE.md](https://github.com/alliecatowo/daggler/blob/main/ARCHITECTURE.md) in the repository.
