---
layout: home
hero:
  name: "Daggler"
  text: "A semantic workbench for GitHub Actions"
  tagline: Parse workflows into a typed IR, see the job graph, validate it in layers, and catch security problems before they ship. Install the linter from npm, or run the browser editor from source.
  image:
    src: images/editor.png
    alt: The Daggler editor
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Install the CLI
      link: "#install"
    - theme: alt
      text: GitHub
      link: https://github.com/alliecatowo/daggler
features:
  - title: Understand
    details: Workflow YAML becomes a typed IR with a source map, so every finding points at an exact line and column.
  - title: Validate
    details: Five validation layers, from schema to expressions to graph semantics to action inputs.
  - title: Secure
    details: 13 policy rules, including prompt-injection checks for AI-agent workflows, and a graded security posture score.
  - title: Runs client-side
    details: The whole parse, graph and validate pipeline is pure TypeScript with no backend.
---

<div class="home-section" id="demo">

## See it work

The screenshots below are from the real editor running from a checkout, with the real engine and bundled sample workflows. There is no hosted editor, so these are captures rather than a live embed.

<div class="home-grid">
<figure><img src="./images/editor.png" alt="The Daggler editor: job graph, Monaco YAML with diagnostics, inspector, confidence ladder"><figcaption>The editor: live job graph, Monaco YAML with source-mapped diagnostics, a typed inspector and one-click quick-fixes.</figcaption></figure>
<figure><img src="./images/security.png" alt="Security view of an AI-agent workflow graded F with AGENT001 findings"><figcaption>Security view: an AI-agent workflow graded F, with AGENT001 and POL003 findings.</figcaption></figure>
<figure><img src="./images/live-run.png" alt="The Local rung of the confidence ladder streaming an act plan into the Run panel"><figcaption>The Local rung of the confidence ladder runs act against Docker and streams the plan into the Run panel.</figcaption></figure>
</div>

</div>

<div class="home-section" id="cli">

## Or lint from the terminal

This is the actual output of `npx daggler-cli lint --no-color` on a small workflow that checks out `actions/checkout@main` and interpolates a pull request title into a shell step under `pull_request_target`.

```text
  .github/workflows/ci.yml  Security D 58/100
  2 errors  ·  1 warning  ·  0 info
  ⚑ Unpinned third-party actions
  ⚑ Shell injection risk

  ● POL007  .github/workflows/ci.yml:8:9  Action ref uses a branch
  └─ 'actions/checkout@main' tracks a moving branch — each run may execute different code. Pin to a release tag or a full commit SHA.
  ● POL008  .github/workflows/ci.yml:9:9  Shell injection from untrusted input
  └─ Untrusted 'github.event.pull_request.title' is interpolated into a shell script — an attacker can inject commands. Pass it via an env var and quote it instead.
  ▲ POL001  .github/workflows/ci.yml:workflow:permissions  No top-level permissions
  └─ No top-level 'permissions:' block — the workflow inherits broad default token scopes; add an explicit least-privilege block.

  Summary  2 errors  ·  1 warning  ·  0 info  in 1 file  ·  worst security grade D
```

</div>

<div class="home-section" id="install">

## Install

The CLI is published on npm as [`daggler-cli`](https://www.npmjs.com/package/daggler-cli) (Node 20 or newer). The binary is `daggler`.

```bash
npm install -g daggler-cli
daggler lint
```

Or without installing: `npx daggler-cli lint`.

The browser editor is not published as a package or a hosted service. Build and run it from source (Node 20+, pnpm 10+):

```bash
git clone https://github.com/alliecatowo/daggler
cd daggler
pnpm install
pnpm --filter @daggler/web dev
```

It opens at `http://localhost:3737` with bundled sample workflows. No database or GitHub connection is needed.

</div>

<div class="home-section" id="features">

## What it does

- **Parse and graph.** Workflow YAML becomes a typed IR with a source map, then a job dependency graph. Diagnostics point at an exact line and column.
- **Five validation layers.** Parser, schema, expressions, graph semantics, and action inputs.
- **13 security and policy rules.** POL001 to POL010 and AGENT001 to AGENT003: unpinned actions, shell injection, privileged untrusted events, and prompt injection in AI-agent workflows. Each workflow gets a score and a grade from A to F.
- **Source-preserving edits.** The patch engine applies edits to the YAML while keeping comments and formatting, and pin-to-SHA quick-fixes use API-verified commit SHAs.
- **Confidence ladder.** Run a static analysis pass, then optionally a local `act` run or a GitHub run. Results are labeled simulated until a real runner proves them.
- **Client-side engine.** The parse, graph and validate pipeline is pure TypeScript and runs in the browser with no backend.

Details are in the [guide](/guide/getting-started) and the [reference](/reference/cli).

</div>
