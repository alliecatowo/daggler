# Self-hosting

There are two ways to run Daggler yourself. The first works today; the second is not finished.

## Run the editor on your own machine

```bash
git clone https://github.com/alliecatowo/daggler
cd daggler
pnpm install
pnpm --filter @daggler/web dev
```

The server binds to `127.0.0.1:3737`, needs no database and no GitHub connection, and ships with the Local and GitHub run rungs behind environment flags (`DAGGLER_ALLOW_LOCAL_RUN`, `DAGGLER_ALLOW_GITHUB_DISPATCH`). It is a single-user tool: read the [security model](#security-model) before exposing it.

## Docker Compose stack (work in progress)

::: warning Not usable yet
The repository contains a `docker-compose.yml` and a Postgres schema, but the multi-user self-hosted stack is not complete. Do not rely on it yet.
:::

What is there today:

- `docker-compose.yml` defines a `postgres:18-alpine` service (on a `postgres_data` volume), a `web` service and a `worker` service, with an `.env.example` listing `DATABASE_URL`, `DAGGLER_SECRET_KEY` and the GitHub App and OAuth settings.
- `@daggler/db` holds a Drizzle ORM Postgres schema for users, workspaces, repositories, workflow revisions, validation runs, runners, executions, policy packs and templates.

What is missing:

- The `web` service references `apps/web/Dockerfile`, which does not exist in the repository, so `docker compose build` cannot succeed.
- The `worker` service runs a placeholder command; the Graphile Worker job registry in `apps/worker` is not wired into it.

The standalone editor needs none of this. It runs entirely in the browser; see [Getting started](/guide/getting-started).

## Security model

Daggler's server is built to run on your own machine or behind your own network controls. It has no user accounts, so treat it as a single-user tool and do not expose it to the internet without an authenticating reverse proxy in front.

**API routes** (`/api/run`, `/api/map`, `/api/ai`, `/api/verify`) go through one guard. A request must have an allowed `Host` header (stops DNS rebinding), a same-origin `Origin` / `Sec-Fetch-Site`, `Content-Type: application/json`, the per-launch token header, and a body under the size cap. The token is generated each time the server starts and is embedded in the pages the server itself serves, so a page on another origin cannot read it. The dev and start scripts bind to `127.0.0.1`. To serve from another hostname, add it to `DAGGLER_ALLOWED_HOSTS`. Running workflows with Docker and dispatching to GitHub with the host's `gh` login are opt-in by environment variable.

**Page routes** are plain HTML and are not behind the token (the token has to be delivered somewhere). They carry security headers instead: a restrictive `Content-Security-Policy` (same-origin scripts, no framing, no plugins), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and a locked-down `Permissions-Policy`. The Monaco editor is served from the app's own origin, not a CDN.

**Webhook** (`/api/github/webhook`) is intentionally outside the guard because GitHub calls it. It is authenticated by the HMAC signature (`GITHUB_WEBHOOK_SECRET`), has a body size cap, and only reads the workflow files named in the event; it never runs workflow code.

**GitHub sign-in** starts at `/api/github/oauth/start`, which sets a short-lived `HttpOnly` state cookie and passes the same value to GitHub as `state`. The callback rejects any request whose state does not match, so a forged callback link cannot attach someone else's authorization to your session. The access token is only ever stored encrypted (AES-256-GCM) using `DAGGLER_TOKEN_KEY` (`openssl rand -hex 32`). Without that key nothing is persisted. Runner registration tokens are stored as SHA-256 hashes.

The hosted demo is a static site with none of these routes.
