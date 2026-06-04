# daggler CLI

The `daggler` command-line interface. Runs Daggler's full semantic pipeline
(parse → IR → graph → validate) over GitHub Actions workflow YAML files and
reports diagnostics, security posture scores, and summary totals.

## Commands

```
daggler lint [paths...] [--json] [--quiet] [--no-color]
daggler help | --help
daggler --version
```

## `daggler lint`

Lint one or more workflow files or directories.

```
daggler lint                                  # scans .github/workflows/
daggler lint .github/workflows/ci.yml         # single file
daggler lint .github/workflows/ --json        # all files in dir, JSON output
daggler lint ci.yml deploy.yml --quiet        # multiple files, errors only
```

**Flags**

| Flag | Effect |
|---|---|
| `--json` | Emit a JSON array instead of the pretty terminal output |
| `--quiet` | Only report errors; suppress warnings and infos |
| `--no-color` | Disable ANSI color output |

**Path resolution**

- If no paths are given, `daggler lint` scans `./.github/workflows/`.
- If that directory does not exist either, it falls back to the five bundled
  sample workflows and prints a note explaining the demo mode.
- A directory argument is scanned for `*.yml` / `*.yaml` files. If a
  `.github/workflows` subdirectory exists inside it, that subdirectory is
  preferred.

**Exit codes**

| Code | Meaning |
|---|---|
| `0` | No errors (warnings and infos may still be present) |
| `1` | At least one `error`-severity diagnostic found |
| `1` | Unknown command |

**Pretty output format** (default, colorized)

```
────────────────────────────────────────────────────────────────────────────
  .github/workflows/ci.yml  Security B 82/100
  2 errors  ·  3 warnings  ·  1 info
  ⚑ Unpinned third-party actions

  ● POL002  .github/workflows/ci.yml:89:9  Third-party action not SHA-pinned
    └─ 'some-org/deploy@v1' is pinned to a mutable tag — ...
```

**JSON output format** (`--json`)

Emits a JSON array. Each element has this shape:

```json
[
  {
    "file": ".github/workflows/ci.yml",
    "security": { "score": 82, "grade": "B", "factors": ["Unpinned third-party actions"] },
    "counts": { "error": 2, "warning": 3, "info": 1, "total": 6 },
    "diagnostics": [
      {
        "id": "POL002:step:deploy#2:0",
        "code": "POL002",
        "severity": "error",
        "source": "security",
        "title": "Third-party action not SHA-pinned",
        "message": "'some-org/deploy@v1' is pinned to a mutable tag ...",
        "path": "step:deploy#2",
        "line": 89,
        "col": 9
      }
    ]
  }
]
```

`line` and `col` are 1-based and present only when a source span is available.
When no files are found `--json` emits `[]`.
