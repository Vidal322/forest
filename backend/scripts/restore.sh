#!/usr/bin/env bash
# make restore from=backups/<timestamp> db=<name> data=<dir> [force=1]
# Restores the backup's database into <db> and copies its photos into <data>/photos.
# The dump goes into a scratch database first; <db> is only replaced once that worked, so a bad
# backup never costs you the database you had. Overwriting the live database ("forest", POSTGRES_DB or
# the one in DATABASE_URL) needs force=1 — stop the API first, it is disconnected otherwise.
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
sql -d postgres -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" -c "ALTER DATABASE $scratch RENAME TO $db"
trap - EXIT

if [ -d "$from/photos" ]; then
  mkdir -p "$data/photos"
  cp -a "$from/photos/." "$data/photos/"
fi
echo "restored $from into database $db, photos into $data/photos ($(find "$data/photos" -type f 2>/dev/null | wc -l) photos)"
