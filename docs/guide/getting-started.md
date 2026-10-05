# Getting started

Daggler has two front ends over one engine: a terminal linter (`daggler-cli` on npm, version 0.1.2) and a [browser editor](/guide/web-editor). Both parse a workflow into a typed graph, run five validation layers over it and apply thirteen security rules.

## 1. Try it without installing

Open the [hosted editor](../app/editor/){target="_self"}. It runs the whole pipeline in your browser: paste a workflow, watch the job graph redraw and read the diagnostics. Nothing is uploaded. Running workflows, GitHub dispatch and AI are switched off in the hosted build; see [Hosted editor](/guide/web-editor).

## 2. Lint a repository

Requires Node 20 or newer.

```bash
npx daggler-cli lint
```

With no arguments `lint` scans `.github/workflows/`. If that directory does not exist it falls back to bundled sample workflows as a demo, and says so.

To keep it installed (the package is `daggler-cli`, the binary is `daggler`):

```bash
npm install -g daggler-cli
daggler --version   # 0.1.2
daggler lint
```

Lint one file, several files, or a directory:

```bash
daggler lint .github/workflows/ci.yml
daggler lint ci.yml deploy.yml --quiet
daggler lint .github/workflows/ --json
```

## 3. Read the report

```text
.github/workflows/release.yml  Security F 0/100
6 errors  ·  4 warnings  ·  0 info
● POL007  .github/workflows/release.yml:12:9  Action ref uses a branch
└─ 'actions/checkout@main' tracks a moving branch ...
▲ POL001  .github/workflows/release.yml:workflow:permissions  No top-level permissions
```

- `●` is an error and `▲` a warning. The location is `file:line:column`, or a path such as `workflow:permissions` when the problem is the absence of a block.
- The score runs from 0 to 100 and is graded A to F per workflow. The lines marked `⚑` name the factors that cost points.
- The rule codes are explained in [Policy rules](/reference/policy-rules); the non-security layers in [Validation layers](/reference/validation).

## 4. Use it in CI

`lint` exits `1` when any error-severity finding is reported, so a plain step gates a pull request:

```yaml
- run: npx daggler-cli@0.1.2 lint --no-color
```

Warnings alone do not fail the run. Add `--quiet` to print only errors, or `--json` to feed another tool.

## 5. Go further

- Cross-check against actionlint with `daggler verify` (install [actionlint](https://github.com/rhysd/actionlint) first).
- Map a whole repository's automation with `daggler map`, or any repository you can read through `gh` with `daggler map owner/repo`.
- Climb the [confidence ladder](/guide/confidence-ladder) with `daggler run`.
- Run the full editor from source: see [Hosted editor](/guide/web-editor#run-the-full-editor-locally) and [Self-hosting](/guide/self-hosting).
- Every command and flag is in the [CLI reference](/reference/cli).
