# Getting started

Daggler has two front ends over the same engine: a terminal linter (`daggler-cli` on npm) and a browser editor you run from a checkout of the repo.

## Install the CLI

Requires Node 20 or newer.

```bash
npm install -g daggler-cli
daggler lint
```

Or run it once without installing:

```bash
npx daggler-cli lint
```

The package is [`daggler-cli`](https://www.npmjs.com/package/daggler-cli); the binary it installs is `daggler`. With no arguments `daggler lint` scans `.github/workflows/`. If that directory does not exist it falls back to bundled sample workflows as a demo.

```bash
daggler lint .github/workflows/ci.yml
daggler lint .github/workflows/ --json
daggler lint ci.yml deploy.yml --quiet
```

Exit code is `1` when any error-severity finding is reported. See the [CLI reference](/reference/cli) for every command.

## Run the web editor

There is a hosted demo at <a href="../app/editor/" target="_self">/app/editor</a>: validation, the job graph, event simulation and policy checks run in your browser, and running workflows, GitHub dispatch and AI are off. For those, run the editor from source (Node 20+, pnpm 10+):

```bash
git clone https://github.com/alliecatowo/daggler
cd daggler
pnpm install
pnpm --filter @daggler/web dev
```

It opens at `http://localhost:3737` with bundled sample workflows. No database or GitHub connection is needed. See [Web editor](/guide/web-editor).

## Run the tests

```bash
pnpm test
```

![The Daggler editor](../images/editor.png)
