# Forest — instructions for Claude

Reforestation field tracker: Go API (`backend/`) + React PWA (`frontend/`), PostgreSQL + PostGIS in Docker, Nix dev shell.
Design docs: `docs/data-model.md` (source of truth for the schema) and `docs/mockups/` (UI target).

## Workflow

- Work in small steps, one commit-sized change at a time.
- After each step, have a **different agent** review it, and fix its findings before moving on.
- Then commit the step yourself (allowed in this repo). Use conventional commits (`feat(backend): …`, `chore: …`).
  Never add a `Co-Authored-By: Claude` trailer or any other Claude attribution.
- Goal: the app must be very user friendly (used on a phone in the field) and correct.

## Commands (inside `nix develop`)

- Backend (`cd backend`): `make db-up migrate`, `make run`, `make check` (lint + tests), `make db-smoke` (schema checks).
  First run: `cp .env.example .env`. The database is on port 5433.
- Frontend (`cd frontend`): `pnpm dev` (proxies `/api` and `/healthz` to :8080), `pnpm dev:lan` (open it on a phone), `pnpm check`.

## Rules worth remembering

- No real GPS is ever stored. Coordinates are pixels of the first field photo, PostGIS SRID 0.
  Write geometries with `ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($1)), 0)`.
- Zone status ("needs water", …) is derived from the activity log (`zone_status` view), never stored.
- "Today" is `field_today()` (Europe/Lisbon), not `current_date`.
- `activity` and `task` have a `version` that only the database bumps (trigger). The API never sets it.
