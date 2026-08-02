# Backup and restore

The organizer has two inseparable recovery assets:

1. the PostgreSQL database, which contains account data and encrypted Telegram sessions; and
2. the exact `TSO_MASTER_KEY` that encrypted those sessions.

The database dump intentionally does not contain the master key. Keep the key in an external secret manager or separately encrypted offline storage, with at least two tested copies and tightly limited access. Never rotate it by editing `.env`; existing ciphertext requires a planned key migration.

## Create a database backup

With the production database service running:

```bash
./ops/backup-postgres.sh /secure/backup/location
```

The script uses PostgreSQL's consistent custom dump format, validates the archive with `pg_restore --list`, writes it with a private umask, and creates a SHA-256 sidecar. Transfer both files to encrypted off-host storage. Back up the production environment configuration separately, or at minimum record the exact `TSO_MASTER_KEY`, public origin, Telegram API credentials, and database password in the approved secret store.

Choose retention appropriate to the deployment; a practical baseline is seven daily, five weekly, and twelve monthly copies. Monitor the script's exit status and archive size. A successful command is not a substitute for a restore test.

## Restore into a fresh database

1. Provision a fresh host or remove and recreate only the intended PostgreSQL volume using your infrastructure procedure. Do not point the restore script at a database that contains tables.
2. Restore the production `.env` from the secret store, including the exact original `TSO_MASTER_KEY`, and set its mode to `0600`.
3. Start only PostgreSQL: `docker compose up -d db`.
4. If a `.sha256` sidecar is available, verify it from the archive directory with `sha256sum -c FILE.sha256` (Linux) or `shasum -a 256 -c FILE.sha256` (macOS).
5. Restore and migrate:

   ```bash
   ./ops/restore-postgres.sh /secure/backup/location/telegram-saved-organizer-TIMESTAMP.dump
   ```

   The script refuses to run when application services are active or the target database has public tables. It never drops or overwrites tables.
6. Start the stack with `docker compose up -d` and confirm `/api/ready` returns `{"status":"ready"}`.
7. Sign in, confirm categories/messages are present, and verify a Telegram connection can be opened. Check API and worker logs for decryption or migration errors.

Run this restore drill regularly on an isolated host. Never consider backups complete until the database, key custody, migrations, and a representative sign-in/scan workflow have all been verified together.
