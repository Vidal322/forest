#!/usr/bin/env bash
# make backup-check: proves a backup can be restored. Backs up the database in DATABASE_URL (and the photos)
# into a temporary folder, restores it into the scratch database <db>_restore_check, and checks that every
# table has the same number of rows and every photo file is identical. Cleans up after itself; the live
# database is only read. Exits non-zero on any difference.
# Through make, overrides go after it: make backup-check DATABASE_URL=... (a VAR=... prefix loses to backend/.env).
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

db=$(url_db_name)
check=${db:0:48}_restore_check
work=$(mktemp -d)
cleanup() {
  sql -d postgres -c "DROP DATABASE IF EXISTS $check WITH (FORCE)" >/dev/null 2>&1 || true
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

tables=$(wc -l <<<"$before")
rows=$(awk -F'\t' '{ n += $2 } END { print n }' <<<"$before")
echo "restore check OK: $tables tables, $rows rows and $(find "$work/restored/photos" -type f | wc -l) photos match"
