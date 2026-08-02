#!/bin/sh

set -eu
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
output_dir=${1:-"$repository_root/backups"}

mkdir -p -- "$output_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$output_dir/telegram-saved-organizer-$timestamp.dump"
temporary_archive=$(mktemp "$output_dir/.telegram-saved-organizer-$timestamp.XXXXXX")

cleanup() {
    rm -f -- "$temporary_archive"
}
trap cleanup EXIT HUP INT TERM

(
    cd -- "$repository_root"
    docker compose exec -T db pg_dump \
        --username=tso \
        --dbname=tso \
        --format=custom \
        --no-owner \
        --no-privileges
) > "$temporary_archive"

if [ ! -s "$temporary_archive" ]; then
    echo "Backup failed: pg_dump produced an empty archive." >&2
    exit 1
fi

(
    cd -- "$repository_root"
    docker compose exec -T db pg_restore --list
) < "$temporary_archive" > /dev/null

mv -- "$temporary_archive" "$archive"
trap - EXIT HUP INT TERM

if command -v sha256sum > /dev/null 2>&1; then
    digest=$(sha256sum "$archive" | awk '{print $1}')
else
    digest=$(shasum -a 256 "$archive" | awk '{print $1}')
fi
printf '%s  %s\n' "$digest" "$(basename -- "$archive")" > "$archive.sha256"

echo "Created verified PostgreSQL backup: $archive"
echo "Store it encrypted off-host and back up TSO_MASTER_KEY separately; the dump does not contain that key."
