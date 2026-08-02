#!/bin/sh

set -eu

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 /path/to/telegram-saved-organizer-TIMESTAMP.dump" >&2
    exit 2
fi

archive=$1
if [ ! -f "$archive" ] || [ ! -s "$archive" ]; then
    echo "Restore refused: backup archive is missing or empty: $archive" >&2
    exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

running_services=$(
    cd -- "$repository_root"
    docker compose ps --services --status running
)
if printf '%s\n' "$running_services" | grep -Eq '^(api|worker|web|migrate)$'; then
    echo "Restore refused: stop api, worker, web, and migrate services first." >&2
    exit 1
fi
if ! printf '%s\n' "$running_services" | grep -qx 'db'; then
    echo "Restore refused: the db service must be running." >&2
    exit 1
fi

(
    cd -- "$repository_root"
    docker compose exec -T db pg_restore --list
) < "$archive" > /dev/null

public_table_count=$(
    cd -- "$repository_root"
    docker compose exec -T db psql \
        --username=tso \
        --dbname=tso \
        --tuples-only \
        --no-align \
        --command="SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
)
if [ "$public_table_count" != "0" ]; then
    echo "Restore refused: target database is not empty ($public_table_count public tables)." >&2
    echo "Use a fresh PostgreSQL volume; this script never drops or overwrites tables." >&2
    exit 1
fi

(
    cd -- "$repository_root"
    docker compose exec -T db pg_restore \
        --username=tso \
        --dbname=tso \
        --exit-on-error \
        --single-transaction \
        --no-owner \
        --no-privileges
) < "$archive"

(
    cd -- "$repository_root"
    docker compose run --rm migrate
)

echo "Database restore and migrations completed."
echo "Before starting the app, restore the exact TSO_MASTER_KEY used when this backup was created."
