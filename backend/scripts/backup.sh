#!/usr/bin/env bash
# make backup: a dump of the database plus a copy of the photos, in <repo>/backups/<timestamp>/
#   db.dump   pg_dump -Fc (custom format, compressed; restore with make restore)
#   photos/   copy of $FOREST_DATA_DIR/photos (without in-flight .upload-* temp files)
# The folder only gets its final name once both are complete, so a failed run leaves "<timestamp>.partial".
# Env: DATABASE_URL (which database), FOREST_DATA_DIR (default: data), FOREST_BACKUP_DIR (default: <repo>/backups).
# Through make, overrides go after it: make backup DATABASE_URL=... (a VAR=... prefix loses to backend/.env).
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib.sh

db=$(url_db_name)
data=${FOREST_DATA_DIR:-data}
root=${FOREST_BACKUP_DIR:-$(cd .. && pwd)/backups}
dest=$root/$(date +%Y-%m-%d_%H%M%S)
[ ! -e "$dest" ] || die "$dest already exists"
tmp=$dest.partial
mkdir -p "$tmp"

# Database first: every photo it refers to is already on disk, so the copy below has it too.
in_db pg_dump -U "$PG_USER" -Fc -d "$db" >"$tmp/db.dump"
[ -s "$tmp/db.dump" ] || die "pg_dump wrote nothing"

if [ -d "$data/photos" ]; then
  # tar, not cp: skips the API's half-written .upload-* temp files (photo.Dir.Save writes them in this folder).
  tar -C "$data" --exclude='.upload-*' -cf - photos | tar -C "$tmp" -xpf -
else
  echo "note: no photos yet ($data/photos does not exist)" >&2
  mkdir "$tmp/photos"
fi

mv "$tmp" "$dest"
echo "backup of $db: $dest ($(du -sh "$dest" | cut -f1), $(find "$dest/photos" -type f | wc -l) photos)"
