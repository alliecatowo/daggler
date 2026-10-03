# Confidence ladder

Daggler never fakes an execution result. The ladder, implemented in `@daggler/runner-protocol`, has three rungs, each with an honest status.

| Rung | Id | Adapter | What it needs |
|---|---|---|---|
| 1 | `static` | `AnalyzerAdapter` | Nothing. Runs parse and validate in-process; always available. |
| 2 | `local` | `ActAdapter` | [nektos/act](https://github.com/nektos/act) and Docker. |
| 3 | `github` | `GitHubDispatchAdapter` | A connected GitHub App in the editor; the `gh` CLI when used from `daggler run --github`. |

When a rung's prerequisites are missing it reports a clear "not connected" error instead of a simulated pass.

## From the CLI

```bash
daggler run .github/workflows/ci.yml            # static (default)
daggler run .github/workflows/ci.yml --local    # act plan (act -l)
daggler run .github/workflows/ci.yml --local --full
daggler run .github/workflows/ci.yml --github   # dispatch via gh
```

Run `daggler bridge` to see which tools (act, Docker, gh, actionlint) are present on the machine.
