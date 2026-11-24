#!/usr/bin/env bash
# make backup-check: proves a backup can be restored. Backs up the database in DATABASE_URL (and the photos)
# into a temporary folder, restores it into the scratch database restore_check_<db>, and checks that every
# table has the same number of rows and every photo file is identical. Then it restores again over that
# scratch database as if it were the live one: without force=1 that must be refused, with it the existing database
# must be kept as <check>_old_<timestamp> and the new copy must match too. Cleans up after itself; the live
# database is only read. Exits non-zero on any difference.
# Through make, overrides go after it: make backup-check DATABASE_URL=... (a VAR=... prefix loses to backend/.env).
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

db=$(url_db_name)
valid_db_name "$db"
# The scratch name starts with restore_check_ and stays within 40 characters, so restore.sh names its old copies
# exactly <check>_old_<timestamp> (it keeps 40 characters of the name), and those can never be the live database's
# own <db>_old_* copies, however long its name: the cleanup below must only ever drop what this check made.
check=restore_check_${db:0:26}
[ "$check" != "$db" ] && [ "$check" != "${db:0:40}" ] ||
  die "$db looks like a restore check database itself; run the check against the real one"
work=$(mktemp -d)
old_copies() { sql -d postgres -c "SELECT datname FROM pg_database WHERE datname ~ '^${check}_old_[0-9]{8}_[0-9]{6}\$'"; }
cleanup() {
  local d
  for d in $check $(old_copies 2>/dev/null); do
    sql -d postgres -c "DROP DATABASE IF EXISTS $d WITH (FORCE)" >/dev/null 2>&1 || true
  done
  rm -rf "$work"
}
trap cleanup EXIT

before=$(row_counts "$db")
FOREST_BACKUP_DIR=$work/backups scripts/backup.sh
after=$(row_counts "$db")
[ "$before" = "$after" ] || die "$db changed while it was being backed up; run the check again"
backup=$(find "$work/backups" -mindepth 1 -maxdepth 1 -type d)

scripts/restore.sh "$backup" "$check" "$work/restored" >/dev/null
restored=$(row_counts "$check")

if [ "$before" != "$restored" ]; then
  echo "row counts differ (< $db, > $check):" >&2
  diff <(echo "$before") <(echo "$restored") >&2 || true
  exit 1
fi
photos=${FOREST_DATA_DIR:-data}/photos
if [ -d "$photos" ]; then
  diff -r --exclude='.upload-*' "$photos" "$work/restored/photos" >&2 || die "restored photos differ from $photos"
fi

# A forced restore over an existing database: treat $check as the live one (DATABASE_URL names it).
[ -z "$(old_copies)" ] || die "leftover ${check}_old_* databases from an earlier run; drop them first"
if DATABASE_URL=x/$check scripts/restore.sh "$backup" "$check" "$work/restored" >/dev/null 2>&1; then
  die "restore over the live database $check went ahead without force=1"
fi
DATABASE_URL=x/$check scripts/restore.sh "$backup" "$check" "$work/restored" 1 >/dev/null
kept=$(old_copies)
[ "$(wc -w <<<"$kept")" = 1 ] || die "forced restore did not keep the previous $check as one ${check}_old_* (got: $kept)"
[ "$(row_counts "$kept")" = "$before" ] || die "the kept copy $kept lost rows"
[ "$(row_counts "$check")" = "$before" ] || die "row counts differ after the forced restore into $check"
[ "$(sql -d postgres -c "SELECT bool_and(datallowconn) FROM pg_database WHERE datname IN ('$check', '$kept')")" = t ] ||
  die "connections stay disabled on $check or $kept after the forced restore"

tables=$(wc -l <<<"$before")
rows=$(awk -F'\t' '{ n += $2 } END { print n }' <<<"$before")
echo "restore check OK: $tables tables, $rows rows and $(find "$work/restored/photos" -type f | wc -l) photos match; a forced restore kept the old copy"
