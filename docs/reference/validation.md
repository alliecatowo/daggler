# Validation layers

`@daggler/validators` runs every layer over a parse result and returns typed diagnostics, error, warning and info counts, a security posture score (0 to 100, graded A to F) and a complexity metric.

| Layer | Codes | What it checks |
|---|---|---|
| 0 Parser | | Syntax errors and warnings from YAML parsing. |
| 1 Schema | SCHEMA001-005 | Required fields, empty step lists, missing `runs-on`, no jobs, no triggers. |
| 2 Expressions | EXPR001-004 | `${{ }}` context availability: `matrix` without a strategy, `needs.<name>` not in `needs`, `steps.<id>` that does not exist, `inputs` without dispatch or call triggers. |
| 3 Graph semantics | SEM001-003, SEM005 | `needs` cycles, dangling references, unreachable jobs, matrix combinations over 50. |
| 4 Actions | ACT001-005 | `uses:` steps checked against the curated action catalog: cache hints, deprecated major versions, missing or unknown inputs, undeclared outputs. |

On top of these, the [policy engine](/reference/policy-rules) adds the security rules.
