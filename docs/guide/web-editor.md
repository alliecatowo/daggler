# Web editor

`apps/web` is a Next.js 15 and React 19 editor. The entire semantic pipeline (parse, IR, graph, validate) runs in the browser, so there is no validation server.

![Security view](../images/security.png)

## Panels

- **Graph canvas**: an SVG job DAG built from jobs and `needs` edges, with run-status dots and diagnostic severity badges.
- **Monaco YAML pane**: the raw workflow source.
- **Inspector**: job and step properties, permissions, diagnostics and action metadata. Every input produces an edit command that round-trips through the patch engine.
- **Diagnostics panel**: all findings, sorted by severity then security source weight.
- **Command palette**: `Ctrl-K` / `Cmd-K`, for navigating the workflow library and applying common actions.
- **Confidence ladder**: the three execution rungs in the top bar. See [Confidence ladder](/guide/confidence-ladder).
- **Sidebar**: workflows, actions catalog, templates, diagnostics and policies.

## Source-preserving edits

Edits are applied as structured commands (rename a job, set `runs-on`, set `uses`, and so on) to the raw YAML string, so comments and formatting survive. The pin-to-SHA quick-fix replaces a mutable action tag with a full commit SHA taken from the bundled actions catalog, which holds API-resolved SHAs for commonly used actions.
