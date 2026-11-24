#!/usr/bin/env bash
# make restore from=backups/<timestamp> db=<name> data=<dir> [force=1]
# Restores the backup's database into <db> and copies its photos into <data>/photos.
# The dump goes into a scratch database first; <db> is only replaced once that worked, so a bad
# backup never costs you the database you had. An existing <db> is never dropped: it is renamed to
# <db>_old_<timestamp> (printed at the end; drop it yourself once happy). Overwriting the live database ("forest",
# POSTGRES_DB or the one in DATABASE_URL) needs force=1 — stop the API first, it is disconnected otherwise.
# Photos are copied over the ones in <data>/photos: files newer than the backup are left in place.
set -euo pipefail
from=${1:-} db=${2:-} data=${3:-} force=${4:-}
[ -n "$from" ] && [ -n "$db" ] && [ -n "$data" ] ||
  { echo "usage: make restore from=backups/<timestamp> db=<name> data=<dir> [force=1]" >&2; exit 2; }
backend=$(cd "$(dirname "$0")/.." && pwd)
# from= may be relative to the current folder, to backend/ or to the repo root (where backups/ is).
find_backup() {
  case $1 in /*) [ -d "$1" ] && (cd "$1" && pwd) && return ;; esac
  local base
  for base in "$PWD" "$backend" "$backend/.."; do
    [ -d "$base/$1" ] && (cd "$base/$1" && pwd) && return
  done
  return 1
}
. "$backend/scripts/lib.sh"
from=$(find_backup "$from") || die "no backup folder $1"
[ -s "$from/db.dump" ] || die "$from has no db.dump — is it a backup folder?"
valid_db_name "$db"
case "$db" in postgres | template0 | template1) die "refusing to restore over the system database $db" ;; esac
live=$(DATABASE_URL=${DATABASE_URL:-x/forest} url_db_name)
if [ "$db" = forest ] || [ "$db" = "${POSTGRES_DB:-forest}" ] || [ "$db" = "$live" ]; then
  [ "$force" = 1 ] || die "$db is the live database; add force=1 to replace it (stop the API first)"
fi
case $data in /*) ;; *) data=$PWD/$data ;; esac # absolute; created only once the database swap worked
cd "$backend"

scratch=${db:0:50}_restoring
trap 'sql -d postgres -c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" 2>/dev/null || true' EXIT
sql -d postgres -c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" -c "CREATE DATABASE $scratch TEMPLATE template0"
in_db pg_restore -U "$PG_USER" -d "$scratch" --no-owner --exit-on-error --single-transaction <"$from/db.dump"

if ! db_exists "$db"; then
  sql -d postgres -c "ALTER DATABASE $scratch RENAME TO $db"
  trap - EXIT
else
  # Swap without ever dropping: <db> becomes <db>_old_<timestamp>, then the scratch database becomes <db>, both
  # renames in one transaction (either both happen or neither). From here on the EXIT trap drops nothing; it only
  # lets clients back into whichever database is called <db>.
  old=${db:0:40}_old_$(date +%Y%m%d_%H%M%S)
  ! db_exists "$old" || die "$old already exists; wait a second and try again"
  trap 'sql -d postgres -c "ALTER DATABASE $db WITH ALLOW_CONNECTIONS true" >/dev/null 2>&1 || true' EXIT
  # Keep the API (or anyone) from reconnecting between disconnecting it and the rename.
  sql -d postgres -c "ALTER DATABASE $db WITH ALLOW_CONNECTIONS false"
  if ! sql -d postgres -1 \
    -c "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid()" \
    -c "ALTER DATABASE $db RENAME TO $old" \
    -c "ALTER DATABASE $scratch RENAME TO $db" >/dev/null && ! db_exists "$old"; then
    # The transaction rolled back: <db> is the old database again, untouched.
    sql -d postgres -c "ALTER DATABASE $db WITH ALLOW_CONNECTIONS true" || true
    trap - EXIT
    die "could not swap the restored copy in; $db is unchanged (the restored copy is left in $scratch)"
  fi
  trap - EXIT
  sql -d postgres -c "ALTER DATABASE $old WITH ALLOW_CONNECTIONS true" ||
    echo "warning: could not re-enable connections to $old (it can still be dropped)" >&2
  echo "the previous $db is kept as database $old; once you are happy with the restore, drop it with (from backend/):"
  echo "  docker compose exec db psql -U $PG_USER -d postgres -c 'DROP DATABASE $old'"
fi

if [ -d "$from/photos" ]; then
  mkdir -p "$data/photos"
  cp -a "$from/photos/." "$data/photos/"
fi
echo "restored $from into database $db, photos into $data/photos ($(find "$data/photos" -type f 2>/dev/null | wc -l) photos)"
