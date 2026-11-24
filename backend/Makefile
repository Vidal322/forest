# Everyday commands. Run inside `nix develop` (or with direnv).
# First time:  cp .env.example .env && make db-up migrate

-include .env
export

need-db-url = $(if $(DATABASE_URL),,$(error DATABASE_URL is not set — run: cp .env.example .env))
GOOSE = $(need-db-url)GOOSE_DRIVER=postgres GOOSE_DBSTRING="$(DATABASE_URL)" GOOSE_MIGRATION_DIR=internal/db/migrations goose

.PHONY: help db-up db-down db-smoke backup restore backup-check purge migrate migrate-down migrate-status migration run test lint check

help: ## list targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

db-up: ## start Postgres + PostGIS (docker)
	docker compose up -d --wait

db-down: ## stop the database (data is kept)
	docker compose down

db-smoke: ## schema smoke test (sample data + constraint checks, rolled back)
	$(need-db-url)psql "$(DATABASE_URL)" -q -f internal/db/testdata/smoke.sql

backup: ## back up the database + photos into <repo>/backups/<timestamp>/
	$(need-db-url)scripts/backup.sh

restore: ## restore a backup: make restore from=backups/<timestamp> db=<name> data=<dir> [force=1]
	scripts/restore.sh "$(from)" "$(db)" "$(data)" "$(force)"

backup-check: ## prove backups restore: back up, restore into a scratch database, compare row counts + photos
	$(need-db-url)scripts/backup-check.sh

# Only dry=1 is a dry run; dry= / dry=0 purge for real, and anything else (dry=yes, dry=true) is refused rather than guessed.
purge-dry = $(if $(filter 1,$(dry)),-dry-run,$(if $(filter-out 0,$(dry)),$(error dry=$(dry): use dry=1 for a dry run, or leave it out)))
purge: ## hard-delete tombstones older than N days, with the API stopped: make purge [days=90] [dry=1]
	$(need-db-url)go run ./cmd/purge -days=$(or $(days),90) $(purge-dry)

migrate: ## apply all pending migrations
	$(GOOSE) up

migrate-down: ## undo the last migration
	$(GOOSE) down

migrate-status: ## show which migrations are applied
	$(GOOSE) status

migration: ## create a new migration: make migration name=add_something
	@test -n "$(name)" || (echo "usage: make migration name=add_something" && exit 1)
	$(GOOSE) -s create $(name) sql

run: ## run the API
	go run ./cmd/api

test: ## run all tests with the race detector (DB tests must not be skipped)
	FOREST_REQUIRE_DB=1 go test -race ./...

lint: ## golangci-lint
	golangci-lint run ./...

check: lint test ## lint + test (run before committing)
