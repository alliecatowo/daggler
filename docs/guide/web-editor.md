# Hosted editor

The editor is a Next.js 15 and React 19 app in `apps/web`. The whole semantic pipeline (parse, IR, graph, validate) is TypeScript that runs in the browser, so there is no validation server.

**Open it:** [alliecatowo.github.io/daggler/app/editor](../app/editor/){target="_self"}

## What the hosted build does

The hosted site is a static export. The server API routes are removed from that build, so nothing you type leaves your browser.

| Feature | Hosted | Local build |
|---|---|---|
| Parse, job graph, five validation layers | yes | yes |
| Thirteen policy rules and security grade | yes | yes |
| Event simulation | yes | yes |
| Source-preserving edits and pin-to-SHA quick-fix | yes | yes |
| Run with `act` and Docker (Local rung) | no | opt-in |
| Dispatch to GitHub (GitHub rung) | no | opt-in |
| AI assistance | no | opt-in |

## Panels

- **Graph canvas**: an SVG job DAG built from jobs and `needs` edges, with diagnostic severity badges.
- **Monaco YAML pane**: the raw workflow source. Monaco is bundled with the site, not loaded from a CDN.
- **Inspector**: job and step properties, permissions, diagnostics and action metadata. Every input produces an edit command that round-trips through the patch engine.
- **Diagnostics panel**: all findings, sorted by severity then security weight.
- **Command palette**: `Ctrl-K` or `Cmd-K`.
- **Confidence ladder**: the three execution rungs in the top bar; see [Confidence ladder](/guide/confidence-ladder).
- **Sidebar**: workflows, actions catalog, templates, diagnostics and policies.

![Security view](../images/security.png)

## Source-preserving edits

Edits are applied as structured commands (rename a job, set `runs-on`, set `uses`, and so on) to the raw YAML string, so comments and formatting survive. The pin-to-SHA quick-fix replaces a mutable action tag with a full commit SHA from the bundled actions catalog, which holds API-resolved SHAs for commonly used actions.

## Run the full editor locally

Node 20 or newer and pnpm 10 or newer:

```bash
git clone https://github.com/alliecatowo/daggler
cd daggler
pnpm install
pnpm --filter @daggler/web dev
```

It opens at `http://localhost:3737` with bundled sample workflows. No database or GitHub connection is needed. The server build binds to `127.0.0.1` and protects its API routes; see the [security model](/guide/self-hosting#security-model).

To build the static hosted variant yourself, run `mise run build:hosted` (or `pnpm --filter @daggler/web build:hosted`); the output is `apps/web/out`.
