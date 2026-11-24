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
- Frontend (`cd frontend`): `pnpm dev` (proxies `/api` and `/healthz` to :8080), `pnpm dev:lan` (open it on a phone), `pnpm check`, `pnpm build` (PWA).
- Browser (e2e) tests: `frontend/e2e/*.e2e.ts`, run with `.claude/loop/e2e.sh [spec]` (fresh preview on its own port
  and database, system Chrome as a Pixel 7; screenshots via `shot()` in `frontend/e2e-results/`).
- Playwright MCP (`.mcp.json`, for ad-hoc looks, one shared browser): headless system Chrome emulating a Pixel 7, started via `nix develop` (needs Node ≥ 20;
  system Node is 18). Screenshots land in `.playwright-mcp/` (ignored). First start downloads the package — if it times
  out, run the `.mcp.json` command once by hand or raise `MCP_TIMEOUT`.
- The API applies migrations itself on start; photos are stored under `FOREST_DATA_DIR` (default `backend/data`).

## Rules worth remembering

- No real GPS is ever stored. Coordinates are pixels of the first field photo, PostGIS SRID 0.
  Write geometries with `ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($1)), 0)`.
- Zone status ("needs water", …) is derived from the activity log (`zone_status` view), never stored.
- "Today" is `field_today()` (Europe/Lisbon), not `current_date`.
- `activity` and `task` have a `version` that only the database bumps (trigger). The API never sets it.
- Every write is `PUT /api/<kind>/{client uuid}` (upsert by id, same content = no-op); deletes are soft (tombstones → 410
  on a late write). Versioned kinds take `base_version` and answer 409 `{error, current}` on a stale edit.
- Lock order in the store: plot → zone → task/trees (avoid deadlocks between edits and cascading deletes).
- Frontend writes go through the outbox (`src/api/outbox.ts`, `entity.ts`: mutation defaults by key, one ordered scope),
  persisted in IndexedDB (`src/app/persist.ts`). Forms use `useOutboxWrite`; a queued change counts as saved.
- Backend tests share the dev DB: `dbtest.Tx` (rolled back, savepoint per statement); give test rows unique names.
- Frontend tests: `src/test/fakeApi.ts` + `renderApp`; Leaflet needs `Browser.any3d = true` and stubbed client sizes.
