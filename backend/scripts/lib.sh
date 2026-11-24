# shellcheck shell=bash
# Shared by the backup scripts. Sourced, not run. Expects to be in backend/ (docker-compose.yaml).
# Uses the database server's own client tools (docker compose exec db …): the server is PostgreSQL 17 and a
# newer pg_dump would write dumps it cannot read.

die() { echo "error: $*" >&2; exit 1; }

PG_USER=${POSTGRES_USER:-forest}

# cron runs with PATH=/usr/bin:/bin, which misses a snap (/snap/bin) or /usr/local/bin docker.
command -v docker >/dev/null ||
  die "docker not found in PATH ($PATH). Under cron, add a PATH= line with the folder of 'command -v docker' (README, Backups)"

# psql / pg_dump / pg_restore inside the db container, as the database owner, over its unix socket.
in_db() { docker compose exec -T db "$@"; }
sql() { docker compose exec -T -e PGOPTIONS='-c client_min_messages=warning' db psql -U "$PG_USER" -X -v ON_ERROR_STOP=1 -qAt "$@"; }

# The database name in DATABASE_URL (postgres://user:pass@host:port/NAME?params).
url_db_name() {
  local name=${DATABASE_URL:-}
  [ -n "$name" ] || die "DATABASE_URL is not set — run: cp .env.example .env"
  name=${name%%\?*}
  echo "${name##*/}"
}

valid_db_name() { [[ $1 =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "'$1' is not a plain database name (a-z, 0-9, _)"; }

db_exists() { [ "$(sql -d postgres -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" = 1 ]; }

# "schema.table<TAB>rows" for every table, sorted: what a restore must reproduce.
row_counts() {
  local q
  q=$(sql -d "$1" -c "
    SELECT string_agg(format('SELECT %L, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename),
                      ' UNION ALL ' ORDER BY schemaname, tablename)
    FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")
  [ -n "$q" ] || die "database $1 has no tables"
  sql -d "$1" -F $'\t' -c "$q" | sort
}
