#!/usr/bin/env bash
# Run inside an item's worktree after rebasing it onto master. Gives the migrations this branch adds the next free
# numbers after master's highest one (keeping their order), commits that, and recreates the item's database.
# Prints old -> new names and any file that still mentions an old name (fix those by hand, then commit).
set -euo pipefail
tree=$(git rev-parse --show-toplevel)
dir=backend/internal/db/migrations
cd "$tree"
max=$(git ls-tree --name-only master "$dir/" | sed -E 's#.*/([0-9]+)_.*#\1#' | sort -n | tail -1)
mapfile -t added < <(git diff --name-only --diff-filter=A master...HEAD -- "$dir" | sort)
[ ${#added[@]} -gt 0 ] || { echo "no new migrations"; exit 0; }
first=$(basename "${added[0]}" | sed -E 's#^([0-9]+)_.*#\1#')
if [ $((10#$first)) -gt $((10#$max)) ]; then echo "already after master's $max: nothing to do"; exit 0; fi
n=$((10#$max))
olds=()
for f in "${added[@]}"; do
  n=$((n + 1))
  old=$(basename "$f")
  new=$(printf '%05d_%s' "$n" "${old#*_}")
  git mv "$f" "$dir/$new"
  echo "$old -> $new"
  olds+=("$old")
done
git commit -q -m "chore(db): renumber this branch's migrations after master's"
for old in "${olds[@]}"; do git grep -n -F "$old" -- . ":!$dir" || true; done
"$(dirname "$0")/worktree.sh" --reset-db "$(basename "$tree")"
