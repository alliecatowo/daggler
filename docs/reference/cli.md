# CLI reference

Installed as `daggler` by the [`daggler-cli`](https://www.npmjs.com/package/daggler-cli) npm package.

```
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
| `lint` | Static analysis and security scoring. Defaults to `.github/workflows/`. |
| `verify` | Cross-checks with both Daggler and [actionlint](https://github.com/rhysd/actionlint). Exits `1` on errors from either tool. |
| `run` | Executes through the [confidence ladder](/guide/confidence-ladder). Exit code `2` means the needed infrastructure (act, Docker, an authenticated `gh`) is not available. |
| `map` | Repository automation map: per-workflow triggers, jobs, third-party actions and trust, unpinned count, secrets referenced, security grade, then a repo-level rollup. Takes a local directory or an `owner/repo` slug fetched through `gh`. |
| `search` | Finds actions in the GitHub ecosystem. |
| `logs` | Fetches a run's logs and maps failures back to workflow source. |
| `bridge` | A local capability probe. Reports which runner-related tools exist on this machine. Pairing with a Daggler cloud app is not implemented. |

## Flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--json` | lint, verify, map | Structured JSON output. |
| `--quiet` | lint | Only report errors. |
| `--no-color` | all | Disable ANSI color. |
| `--static` / `--local` / `--github` | run | Pick the ladder rung. `--static` is the default. |
| `--full` | run `--local` | Full run instead of a plan. |
| `--repo R`, `--ref REF` | run `--github` | Override repository (`owner/repo`) or git ref. |
| `--workflow FILE` | logs | Path to the workflow YAML. |

`lint` exits `1` when any error is found.
