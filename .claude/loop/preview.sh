#!/usr/bin/env bash
# Run the whole app for a browser check (Playwright MCP): the frontend of this checkout, built and served by its API
# on http://127.0.0.1:8099, against a fresh throwaway database (forest_scratch) and photo dir.
# The browser is shared, so one preview runs at a time: `start` waits for the current one (up to 60 min).
#   .claude/loop/preview.sh start          # run the copy inside the checkout/worktree you want to preview
#   .claude/loop/preview.sh stop           # stops it only if this checkout holds the preview
#   .claude/loop/preview.sh stop --force   # stops whatever preview is running
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tree=$(git -C "$here" rev-parse --show-toplevel)
main=$(dirname "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")
command -v go >/dev/null && command -v psql >/dev/null || exec nix develop "$tree" -c "$0" "$@"

run=$main/.claude/loop/run
lock=$run/preview.lock
port=8099
mkdir -p "$run"

db_url() { grep -E '^DATABASE_URL=' "$main/backend/.env" | cut -d= -f2- | sed -E "s#/[^/?]+(\?|\$)#/$1\1#"; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

kill_lock() { # $1 = a lock directory taken out of the way
  if [ -f "$1/pid" ]; then kill "$(cat "$1/pid")" 2>/dev/null || true; fi
  rm -rf "$1"
}

stale() { # holder's API died, the starter died before starting it, or it has run for over 45 min
  [ -d "$lock" ] || return 1
  if [ -f "$lock/pid" ]; then ! alive "$lock/pid" && return 0
  elif [ -f "$lock/starter" ]; then ! alive "$lock/starter" && return 0; fi
  [ -n "$(find "$lock" -maxdepth 0 -mmin +45 2>/dev/null)" ]
}

stop() {
  [ -d "$lock" ] || return 0
  if [ "${1:-}" != --force ] && [ "$(cat "$lock/tree" 2>/dev/null)" != "$tree" ]; then
    echo "the running preview belongs to $(cat "$lock/tree" 2>/dev/null); not stopping it"
    return 0
  fi
  local tmp="$lock.gone.$$"
  mv "$lock" "$tmp" 2>/dev/null && kill_lock "$tmp"
  return 0
}

start() {
  local i
  for i in $(seq 1 720); do
    mkdir "$lock" 2>/dev/null && break
    if stale; then # move it aside atomically so two waiters can't both clear it
      local tmp="$lock.stale.$$"
      mv "$lock" "$tmp" 2>/dev/null && kill_lock "$tmp"
      continue
    fi
    [ "$i" = 720 ] && { echo "another preview has been running for 60 min; giving up" >&2; exit 1; }
    sleep 5
  done
  echo $$ >"$lock/starter"
  echo "$tree" >"$lock/tree"
  trap 'stop' ERR

  psql "$(db_url postgres)" -q -c 'DROP DATABASE IF EXISTS forest_scratch WITH (FORCE)' -c 'CREATE DATABASE forest_scratch'
  (cd "$tree/frontend" && { [ -d node_modules ] || pnpm install --frozen-lockfile --prefer-offline; } &&
    pnpm exec vite build --outDir "$run/dist" --emptyOutDir) >"$run/build.log" 2>&1 ||
    { tail -30 "$run/build.log" >&2; false; }
  (cd "$tree/backend" && go build -o "$run/api" ./cmd/api)
  rm -rf "$run/data" && mkdir -p "$run/data"

  DATABASE_URL=$(db_url forest_scratch) FOREST_HTTP_ADDR=127.0.0.1:$port FOREST_DATA_DIR=$run/data \
    FOREST_STATIC_DIR=$run/dist setsid nohup "$run/api" >"$run/api.log" 2>&1 </dev/null &
  echo $! >"$lock/pid"
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; then
      echo "preview of $tree: http://127.0.0.1:$port (API log: $run/api.log)"
      return 0
    fi
    sleep 0.5
  done
  tail -30 "$run/api.log" >&2
  false
}

case ${1:-} in
  start) start ;;
  stop) stop "${2:-}" ;;
  *) echo "usage: $0 start | stop [--force]" >&2; exit 2 ;;
esac
