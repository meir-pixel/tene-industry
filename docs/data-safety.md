# Data Safety Rules

IronBend must not silently create a blank production database during deployment.

## Production Startup Guard

- Production uses `DB_PATH=/data/ironbend.db`.
- Startup refuses to create a missing production database unless `ALLOW_EMPTY_DB_INIT=true`.
- Startup also refuses to seed an existing but empty production database.
- Keep `ALLOW_EMPTY_DB_INIT=false` after the first intentional initialization.
- Before startup migrations, the server creates a snapshot of the active SQLite database and any WAL sidecar files.

## Migration Rules

1. Never run a migration against production without downloading or copying a verified backup.
2. Run the dry-run command first: `npm run auth:migrate:dry-run`.
3. Apply only after reviewing the target `DB_PATH`: `npm run auth:migrate`.
4. Plaintext PIN values remain for the 48-hour rollback window.

## Restore Rules

- Uploaded database files are validated with SQLite `integrity_check`.
- Upload is rejected unless core tables exist.
- Upload stays disabled unless `ALLOW_DATABASE_UPLOAD=true` is set for a supervised maintenance window.
- The active database is checkpointed and backed up with a timestamp before replacement.

## Deployment Checklist

1. Confirm Render has the persistent disk mounted at `/data`.
2. Confirm `DB_PATH=/data/ironbend.db`.
3. Confirm `ALLOW_EMPTY_DB_INIT=false`.
4. Download a database backup before deploy.
5. Deploy to staging first.
6. Verify sentinel data remains after restart before deploying production.
