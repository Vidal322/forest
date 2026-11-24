#!/usr/bin/env bash
# Run this checkout's whole app for browser tests: the frontend built and served by its API on a free port
# (8100-8199), against a fresh database forest_preview_<name> and its own photo dir. Several checkouts can each run
# one at the same time.
#   .claude/loop/preview.sh start   # prints the URL (also in .claude/loop/run/preview-<name>/url)
#   .claude/loop/preview.sh stop    # stops it and drops its database
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tree=$(git -C "$here" rev-parse --show-toplevel)
main=$(dirname "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")
command -v go >/dev/null && command -v psql >/dev/null || exec nix develop "$tree" -c "$0" "$@"

name=$(basename "$tree" | tr 'A-Z-' 'a-z_' | tr -cd 'a-z0-9_')
state=$main/.claude/loop/run/preview-$name
db=forest_preview_$name
db_url() { grep -E '^DATABASE_URL=' "$main/backend/.env" | cut -d= -f2- | sed -E "s#/[^/?]+(\?|\$)#/$1\1#"; }

stop() {
  if [ -f "$state/pid" ]; then kill "$(cat "$state/pid")" 2>/dev/null || true; fi
  if [ -f "$state/port" ]; then rmdir "$main/.claude/loop/run/port-$(cat "$state/port")" 2>/dev/null || true; fi
  psql "$(db_url postgres)" -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" 2>/dev/null || true
  rm -rf "$state"
}

start() {
  stop
  mkdir -p "$state/data"
  trap 'stop' ERR
  psql "$(db_url postgres)" -q -c "CREATE DATABASE $db"
  (cd "$tree/frontend" && { [ -d node_modules ] || pnpm install --frozen-lockfile --prefer-offline; } &&
    pnpm exec vite build --outDir "$state/dist" --emptyOutDir) >"$state/build.log" 2>&1 ||
    { tail -30 "$state/build.log" >&2; false; }
  (cd "$tree/backend" && go build -o "$state/api" ./cmd/api)

  # Claim a port atomically (mkdir), then make sure nothing else listens on it.
  local port='' p
  for p in $(seq 8100 8199); do
    mkdir "$main/.claude/loop/run/port-$p" 2>/dev/null || continue
    if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then # taken by something outside the loop
      rmdir "$main/.claude/loop/run/port-$p"
      continue
    fi
    port=$p
    break
  done
  [ -n "$port" ] || { echo "no free port in 8100-8199" >&2; false; }
  echo "$port" >"$state/port"
  DATABASE_URL=$(db_url "$db") FOREST_HTTP_ADDR=127.0.0.1:$port FOREST_DATA_DIR=$state/data \
    FOREST_STATIC_DIR=$state/dist setsid nohup "$state/api" >"$state/api.log" 2>&1 </dev/null &
  echo $! >"$state/pid"
  local i
  for i in $(seq 1 60); do
    kill -0 "$(cat "$state/pid")" 2>/dev/null || break # our API died: never trust another server's answer
    if curl -fsS "http://127.0.0.1:$port/healthz" >/dev/null 2>&1; then
      echo "http://127.0.0.1:$port" | tee "$state/url"
      return 0
    fi
    sleep 0.5
  done
  tail -30 "$state/api.log" >&2
  false
}

case ${1:-} in
  start) start ;;
  stop) stop ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
