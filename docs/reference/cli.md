# CLI reference

Installed as `daggler` by the [`daggler-cli`](https://www.npmjs.com/package/daggler-cli) npm package (0.1.2, Node 20 or newer). Run it once with `npx daggler-cli <command>`.

```text
daggler lint   [paths...] [--json] [--quiet] [--no-color]
daggler verify [paths...] [--json]
daggler run    <file> [--static|--local|--github] [--full] [--repo R] [--ref REF]
daggler map    [dir | owner/repo] [--json]
daggler search <query> [--limit N]
daggler logs   <run-id> [--repo owner/repo] [--workflow <file>]
daggler bridge
daggler help
daggler --version
```

## Commands

| Command | What it does |
|---|---|
| `lint` | Static analysis and security scoring. Defaults to `.github/workflows/`; falls back to bundled samples when that directory is missing. |
| `verify` | Runs Daggler and [actionlint](https://github.com/rhysd/actionlint) over the same files and prints both. If actionlint is not installed it says so and still reports Daggler's findings. |
| `run` | Executes through the [confidence ladder](/guide/confidence-ladder). |
| `map` | Repository automation map: per-workflow triggers, jobs, third-party actions and trust, unpinned count, secrets referenced and security grade, then a repo-level rollup. Takes a local directory or an `owner/repo` slug fetched through `gh`. |
| `search` | Finds actions through the `gh` CLI and shows a trust score for each. Needs an authenticated `gh`; reports that plainly when it is missing. |
| `logs` | Fetches a run's logs through `gh`, finds the failure and maps it back to the workflow source. |
| `bridge` | Local capability probe: which runner-related tools (act, Docker, gh, actionlint) exist on this machine. Pairing with a cloud app is not implemented. |

## Flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--json` | lint, verify, map | Structured JSON output (an array, one entry per file for `lint`). |
| `--quiet` | lint | Only report errors. |
| `--no-color` | all | Disable ANSI color. |
| `--static`, `--local`, `--github` | run | Pick the ladder rung. `--static` is the default. |
| `--full` | run `--local` | Full run instead of an `act` plan. |
| `--repo R`, `--ref REF` | run `--github` | Override the repository (`owner/repo`) or git ref. |
| `--workflow FILE` | logs | Path to the workflow YAML to map failures onto. |
| `--limit N` | search | Maximum results. |

## Exit codes

| Command | Code | Meaning |
|---|---|---|
| `lint`, `verify` | `0` | No error-severity findings (warnings do not count). |
| `lint`, `verify` | `1` | At least one error. |
| `run` | `1` | The run or analysis reported errors. |
| `run`, `logs` | `2` | The infrastructure the rung needs (act, Docker, an authenticated `gh`) is not available. |
| `logs` | `1` / `3` | The run failed (report printed) / usage error. |

## `--json` shape

`daggler lint --json` prints an array with one object per file:

```json
{
  "file": ".github/workflows/release.yml",
  "security": { "score": 0, "grade": "F", "factors": ["Unpinned third-party actions"] },
  "counts": { "error": 6, "warning": 4, "info": 0, "total": 10 },
  "diagnostics": [
    {
      "id": "POL007:step:lint#0:0",
      "code": "POL007",
      "severity": "error",
      "source": "security",
      "title": "Action ref uses a branch",
      "message": "'actions/checkout@main' tracks a moving branch ...",
      "path": "step:lint#0",
      "line": 12,
      "col": 9
    }
  ]
}
```

## Examples

```bash
daggler lint                                  # every workflow in .github/workflows/
daggler lint --quiet --no-color               # errors only, for logs
daggler verify                                # Daggler + actionlint
daggler run .github/workflows/ci.yml          # static analysis (default rung)
daggler run .github/workflows/ci.yml --local  # act plan; add --full to execute
daggler map . --json                          # automation map of this repo
daggler map alliecatowo/daggler               # of another repo, via gh
daggler search "setup node" --limit 5
```
