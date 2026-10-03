# Self-hosting status

::: warning Work in progress
The repository contains a `docker-compose.yml` and a Postgres schema, but the self-hosted stack is not complete. Do not rely on it yet.
:::

What is there today:

- `docker-compose.yml` defines a `postgres:16-alpine` service, a `web` service and a `worker` service, with an `.env.example` listing `DATABASE_URL`, `DAGGLER_SECRET_KEY` and the GitHub App and OAuth settings.
- `@daggler/db` holds a Drizzle ORM Postgres schema for users, workspaces, repositories, workflow revisions, validation runs, runners, executions, policy packs and templates.

What is missing:

- The `web` service references `apps/web/Dockerfile`, which does not exist in the repository, so `docker compose build` cannot succeed.
- The `worker` service runs a placeholder command; the Graphile Worker job registry in `apps/worker` is not wired into it.

The standalone editor needs none of this. It runs entirely in the browser; see [Getting started](/guide/getting-started).
