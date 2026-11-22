# Everyday commands. Run inside `nix develop` (or with direnv).
# First time:  cp .env.example .env && make db-up migrate

-include .env
export

need-db-url = $(if $(DATABASE_URL),,$(error DATABASE_URL is not set — run: cp .env.example .env))
GOOSE = $(need-db-url)GOOSE_DRIVER=postgres GOOSE_DBSTRING="$(DATABASE_URL)" GOOSE_MIGRATION_DIR=internal/db/migrations goose

.PHONY: help db-up db-down db-smoke migrate migrate-down migrate-status migration run test lint check

help: ## list targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-16s %s\n", $$1, $$2}'

db-up: ## start Postgres + PostGIS (docker)
	docker compose up -d --wait

db-down: ## stop the database (data is kept)
	docker compose down

db-smoke: ## schema smoke test (sample data + constraint checks, rolled back)
	$(need-db-url)psql "$(DATABASE_URL)" -q -f internal/db/testdata/smoke.sql

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

test: ## run all tests with the race detector
	go test -race ./...

lint: ## golangci-lint
	golangci-lint run ./...

check: lint test ## lint + test (run before committing)
