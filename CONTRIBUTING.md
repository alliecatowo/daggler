# Contributing to Daggler

Thank you for your interest in contributing. This document covers the essentials for working in the monorepo.

## Prerequisites

| Tool | Version |
|------|---------|
| Node | >= 20 (managed via `mise`, see `mise.toml`) |
| pnpm | 10.x (declared in `package.json#packageManager`) |
| Docker + Compose | for the full stack |

Install dependencies once from the repo root:

```sh
pnpm install
```

Never commit `pnpm-lock.yaml` changes unless you intentionally added or updated a dependency.

## Repo layout

```
apps/
  cli/       # daggler CLI — thin shell over the shared packages
  web/       # Next.js 15 + React 19 editor, engine runs client-side in WASM
packages/
  workflow-ir/  # parser, IR types, DAG builder — the source of truth
  validators/   # 5-layer validation + policy engine
  db/           # Drizzle schema (Postgres 16)
```

All packages are TypeScript ESM with `"type": "module"`. Local imports use `.js` extensions that resolve to `.ts` at build time.

## Development

Run everything in watch mode:

```sh
pnpm dev
```

Run only the web app (port 3737):

```sh
pnpm web
```

Run only the CLI:

```sh
pnpm cli -- --help
```

## Building

```sh
pnpm build          # all packages and apps via Turbo
```

Turbo caches outputs. A clean build:

```sh
pnpm turbo run build --force
```

## Testing

Tests live alongside source files using Vitest. Run the full suite:

```sh
pnpm test
```

Run tests for a single package:

```sh
pnpm --filter @daggler/workflow-ir test   # 17 tests
pnpm --filter @daggler/validators  test   # 20 tests
```

Watch mode for a package:

```sh
pnpm --filter @daggler/workflow-ir test -- --watch
```

**Do not break the existing test suites.** The public types and passing tests for `workflow-ir` and `validators` are contracts. If a consumer (web component, CLI command) disagrees with a shared type, fix the consumer.

## Type checking

```sh
pnpm typecheck      # runs tsc --noEmit across all packages via Turbo
```

## Code style

- **TypeScript strict** with `noUncheckedIndexedAccess` — always guard index access.
- ESM relative imports use `.js` extensions for local files; bare specifiers for `@daggler/*` workspace packages.
- Formatting is handled by Prettier (default config). Run `pnpm prettier --write .` before committing if your editor does not do it automatically.
- No default exports from shared packages — named exports only.
- Keep changes minimal and targeted. Avoid wholesale rewrites of files that are not broken.

## Architecture philosophy

Daggler follows a **modular-monolith with ports and adapters**:

- `workflow-ir` is the pure domain core — no I/O, no framework dependencies.
- `validators` depends only on `workflow-ir` types and is also pure.
- `db` is a thin persistence adapter (Drizzle schema) — never import it from `workflow-ir` or `validators`.
- `apps/web` wires domain packages to the browser; `apps/cli` wires them to the terminal.
- The background worker (Graphile Worker on Postgres) is the only async queue — no Redis, no Kubernetes required for self-hosting.

When adding a feature, ask: does this belong in the domain core, a validator layer, the persistence adapter, or an application shell? Keep those boundaries clean.

## Pull requests

1. Branch from `main`.
2. Keep PRs focused — one logical change per PR.
3. Ensure `pnpm test`, `pnpm typecheck`, and `pnpm build` all pass locally.
4. Write a clear description of *why* the change is needed, not just what it does.
5. Update relevant tests; do not delete existing passing tests.

## Self-hosting

See `docker-compose.yml` and `.env.example` at the repo root for the reference self-host stack (Postgres + web + worker, no external broker).
