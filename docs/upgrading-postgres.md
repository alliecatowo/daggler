# Upgrading the bundled Postgres from 16 to 18

`docker-compose.yml` now runs `postgres:18-alpine`. This is a breaking change for any
stack that already has data in the old `postgres_data` volume.

## What changed

- Postgres 18 images keep data in a versioned directory, `/var/lib/postgresql/18/docker`,
  so the volume is mounted at `/var/lib/postgresql` instead of `/var/lib/postgresql/data`.
- The compose volume is renamed from `postgres_data` to `postgres18_data`.
- A Postgres 16 data directory cannot be opened by Postgres 18. Pointing the new image
  at the old volume makes the container exit with
  `PostgreSQL data in: /var/lib/postgresql ... without upgrading the underlying database using "pg_upgrade"`.
- Because the new volume has a new name, your old `postgres_data` volume is never modified.
  It stays around as a backup until you delete it.

**Fresh installs** need nothing: `docker compose up -d` creates `postgres18_data`.

## Option A: dump and restore (recommended)

Run these from the repository root, with your existing `.env`. The commands use the
`POSTGRES_USER` you already have (default `daggler`).

```bash
# 1. With the OLD compose file / image still in place, stop the app and take a dump.
docker compose stop web worker
docker compose exec -T postgres pg_dumpall -U "${POSTGRES_USER:-daggler}" > daggler-pg16.sql
ls -lh daggler-pg16.sql   # sanity check: not empty

# 2. Stop and remove the containers. Do NOT use `-v`: the old volume is your backup.
docker compose down

# 3. Pull the new compose file (postgres:18-alpine, postgres18_data volume), start Postgres only.
docker compose up -d postgres

# 4. Restore.
docker compose exec -T postgres psql -U "${POSTGRES_USER:-daggler}" -d postgres < daggler-pg16.sql

# 5. Start everything and check the app.
docker compose up -d

# 6. When you are satisfied (keep it a few days), delete the old volume.
docker volume ls | grep postgres_data
docker volume rm <project>_postgres_data
```

`pg_dumpall` includes roles and passwords; restoring into `-d postgres` is the standard way
to replay it. Errors such as `role "daggler" already exists` are expected and harmless,
because the image created that role at first boot.

## Option B: in-place `pg_upgrade`

Use this only for databases too large to dump. It needs both Postgres binaries, so it runs in the
community `tianon/postgres-upgrade` image. Two caveats make Option A the better default:

- That image is Debian (glibc) and the compose image is Alpine (musl). Text indexes on
  non-`C` collations can be invalid after crossing libc, so run `REINDEX DATABASE` afterwards.
- Postgres 18 enables data checksums by default and `pg_upgrade` refuses a mismatch, so the new
  cluster is created with `--no-data-checksums`.

Steps (tested with Podman against a 16-alpine cluster; substitute `docker` and your compose
project prefix, see `docker volume ls`). Take a volume backup first, then:

```bash
docker compose down
docker volume create daggler_postgres18_data

# The upgrade image runs as uid 999 (Debian); the Alpine images use uid 70.
docker run --rm -v daggler_postgres_data:/v alpine chown -R 999:999 /v
docker run --rm -v daggler_postgres18_data:/v alpine chown 999:999 /v

docker run --rm \
  -e PGUSER=daggler \
  -e PGDATANEW=/var/lib/postgresql/18/docker \
  -e POSTGRES_INITDB_ARGS="-U daggler --no-data-checksums" \
  -v daggler_postgres_data:/var/lib/postgresql/16/data \
  -v daggler_postgres18_data:/var/lib/postgresql \
  tianon/postgres-upgrade:16-to-18

# Back to the Alpine image's uid, and drop the empty mountpoint dirs and generated script.
docker run --rm -v daggler_postgres18_data:/v alpine \
  sh -c 'rmdir /v/16/data /v/16; chown -R 70:70 /v'

docker compose up -d postgres
docker compose exec postgres vacuumdb -U "${POSTGRES_USER:-daggler}" --all --analyze-in-stages --missing-stats-only
docker compose exec postgres psql -U "${POSTGRES_USER:-daggler}" -d "${POSTGRES_DB:-daggler}" -c 'REINDEX DATABASE CONCURRENTLY daggler'
```

Set `PGUSER` and the initdb `-U` to your `POSTGRES_USER` if it is not `daggler`. Do not use
`--link`: the two volumes are separate filesystems. The old volume is left in place, so rollback
is the same as for Option A.

## Rolling back

Because `postgres_data` is untouched, rollback is: restore the previous `docker-compose.yml`
(`postgres:16-alpine`, `postgres_data:/var/lib/postgresql/data`) and `docker compose up -d`.
Anything written after the upgrade is not in the old volume.
