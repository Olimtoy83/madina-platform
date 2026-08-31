# Production Pilot Runbook

## Approved first-pilot topology

```text
Internet
  -> HTTPS reverse proxy
       -> CRM static frontend
       -> /api to Fastify on loopback
            -> one local SQLite database on durable local disk
```

- TLS terminates at the reverse proxy. Do not expose Fastify directly to the internet.
- Deploy the frontend and `/api` as same-origin. Do not add CORS for this topology.
- Run exactly one Fastify process. SQLite is not shared between replicas.
- Set `DATABASE_FILE` and `MADINA_BACKUP_DIR` to absolute directories outside the repository and build output, on a durable local filesystem. Do not use network, sync, or shared filesystems.
- Restrict database and backup access to the service account and authorized operators.
- Run the compiled server under an external process supervisor; this repository does not provide one.
- The reverse proxy must forward the original client address and HTTPS protocol. In production Fastify trusts only a loopback proxy (`127.0.0.1` or `::1`); it is not approved for direct internet exposure.
- The first pilot remains same-origin, so CORS is deliberately not enabled.

## Production configuration and start

Production requires explicit configuration before Fastify begins listening:

```powershell
$env:NODE_ENV = 'production'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:DATABASE_FILE = 'C:\madina-data\madina.sqlite'
$env:MADINA_BACKUP_DIR = 'C:\madina-backups'
pnpm --filter server start
```

`DATABASE_FILE` must be an absolute path in production. `/health` is process liveness; `/ready` additionally verifies that SQLite is usable. A normal `SIGTERM` or `SIGINT` closes Fastify, runs lifecycle hooks that close repositories, and exits successfully.

## Internet-facing security policy

- Every response has baseline anti-sniffing, referrer, frame, permissions, and safe CSP framing/object headers. HSTS is emitted only in production, where HTTPS terminates at the controlled reverse proxy.
- The CSP deliberately avoids `script-src` and `style-src` in this stage, so it does not risk breaking the existing CRM bundle. A full asset-specific CSP remains a separate browser-validation stage.
- The server applies conservative in-memory rate limiting per resolved client IP. `/health` and `/ready` are exempt for monitoring. This is single-process pilot protection, not distributed abuse protection.
- Unexpected production errors return generic responses; request logs retain the diagnostic error. Cookie, authorization, Set-Cookie, and password fields are redacted from structured logs.

## Deployment procedure

1. Validate the release with `pnpm test` and `pnpm build`.
2. Prepare the new application build while retaining the previous known-good build.
3. Stop or quiesce the Fastify process through its external supervisor.
4. Set the production database environment, then run `pnpm --filter server db:check`.
5. Create and verify a backup with `pnpm --filter server db:backup`.
6. Deploy the prepared application build.
7. Start the compiled server once. Established startup migrations run normally.
8. Run `pnpm --filter server db:check` again.
9. Confirm `GET /ready` succeeds through the local/reverse-proxy route.
10. Perform a login smoke test and one authorized application read.
11. Keep the prior known-good application build until the release is accepted.

## Backup policy

- Create a verified backup daily and before every migration or release.
- Retain multiple restore points and keep an off-machine copy.
- Restrict backup permissions; backups contain business and authentication data.
- Perform periodic restore drills.
- Run `db:check` after every restore.

The backup command validates source and backup. The detailed offline restore safeguards are maintained in [SOP-005](../standards/SOP-005-data-management-and-backup-standard.md).

## Restore and rollback

1. Stop the server before any restore.
2. Preserve the failed/current database as a separate recovery copy.
3. Validate the selected backup with `db:check`.
4. Restore only while the application is offline.
5. Start the new application once and allow normal forward migrations.
6. Run `db:check`, `/ready`, login smoke testing and an authorized read.

Git or application rollback does **not** roll back SQLite schema or business data. Use a prior application build only when schema compatibility is known. Never perform an automatic destructive database rollback.
