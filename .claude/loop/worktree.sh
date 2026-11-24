#!/usr/bin/env bash
# The working copy for one backlog item: .claude/worktrees/<id> on branch auto/<id>, with its own database
# forest_wt_<id> (so tests and migrations of unfinished work never touch the dev database).
#   worktree.sh <id>            create or reuse it (frontend deps installed); prints its absolute path
#   worktree.sh --remove <id>   stop its preview, remove the worktree, delete the branch, drop its database
set -euo pipefail
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
command -v psql >/dev/null && command -v pnpm >/dev/null || exec nix develop "$main" -c "$0" "$@"

remove=0
if [ "${1:-}" = --remove ]; then remove=1; shift; fi
id=${1:?usage: worktree.sh [--remove] <item-id>}
wt=$main/.claude/worktrees/$id
db=forest_wt_$(tr 'A-Z-' 'a-z_' <<<"$id" | tr -cd 'a-z0-9_')
base_url=$(grep -E '^DATABASE_URL=' "$main/backend/.env" | cut -d= -f2-)
url_for() { sed -E "s#/[^/?]+(\?|\$)#/$1\1#" <<<"$base_url"; }

if [ $remove = 1 ]; then
  [ -x "$wt/.claude/loop/preview.sh" ] && "$wt/.claude/loop/preview.sh" stop || true
  [ -d "$wt" ] && git -C "$main" worktree remove --force "$wt"
  git -C "$main" show-ref --verify -q "refs/heads/auto/$id" && git -C "$main" branch -D "auto/$id"
  psql "$(url_for postgres)" -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)"
  echo "removed $id"
  exit 0
fi

if [ ! -d "$wt" ]; then
  if git -C "$main" show-ref --verify -q "refs/heads/auto/$id"; then
    git -C "$main" worktree add -q "$wt" "auto/$id" # earlier work on this item: continue it
  else
    git -C "$main" worktree add -q -b "auto/$id" "$wt" master
  fi
fi
if [ ! -f "$wt/backend/.env" ]; then
  sed -E "s#^DATABASE_URL=.*#DATABASE_URL=$(url_for "$db")#" "$main/backend/.env" >"$wt/backend/.env"
fi
psql "$(url_for postgres)" -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1 ||
  psql "$(url_for postgres)" -q -c "CREATE DATABASE $db"
(cd "$wt/frontend" && pnpm install --frozen-lockfile --prefer-offline >/dev/null)
echo "$wt"
