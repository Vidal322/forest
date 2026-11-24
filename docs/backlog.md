# Backlog

Work list for the autonomous loop (`.claude/loop/README.md`). The loop takes the first `todo` items from the top, so
order = priority. Each item is one squashed commit on `master`.

- **Status**: `todo`, `done (<date>)`, `blocked: <question for the owner>`, `failed: <why> (branch auto/<id>)`.
  To unblock an item, answer the question in the item text and set it back to `todo`.
- **Touches**: what the item changes. **Area**: short tags; items sharing a tag never run at the same time (up to 3
  run at once). `Parallel: alone` instead of Area: the item runs with nothing else (walkthroughs). Migrations are fine
  in parallel: clashing numbers are renumbered when an item lands.
- **Acceptance**: what the reviewer checks. Anything a user sees is also checked in a phone-sized browser.

## Safety & ops

### B1 · Backups and a tested restore
Status: done (2026-11-24)
Touches: backend/scripts, backend/Makefile, README
Parallel: ok
Acceptance:
- `make backup` (in backend/) writes `backups/<timestamp>/` at the repo root (git-ignored) with a `pg_dump -Fc` of
  the database and a copy of `$FOREST_DATA_DIR/photos`; it prints the path and size. Use the server's own `pg_dump`
  (`docker compose exec db pg_dump`, PostgreSQL 17) — the nix client is a newer major version.
- `make restore from=backups/<timestamp> db=<name> data=<dir>` restores into a database of that name (refuses to
  overwrite the `forest` database unless `force=1`) and copies the photos into `<dir>/photos`.
- A script or test proves a round trip: backup → restore into a scratch database → row counts of every table match.
- README "Running it in the field" explains how and how often to back up (e.g. a cron line) and how to restore.

### B2 · Tests for the trees API
Status: done (2026-11-24)
Touches: backend/internal/httpapi (tests only)
Parallel: ok
Acceptance:
- `backend/internal/httpapi/trees_test.go` covers `PUT /api/zones/{id}/trees/{species_id}` `{alive, dead}` and
  `GET /api/tree-counts`: same content = no-op, validation errors (unknown zone/species, bad id, negative counts),
  deleted zone or species, response shape. `plots_test.go` already has a smoke test: extend, don't duplicate.
- Any bug the tests find is fixed in the same item.

### B4 · Restore never loses both databases
Status: done (2026-11-24)
Touches: backend/scripts (restore.sh), README
Parallel: ok
Acceptance:
- In `backend/scripts/restore.sh` a forced restore renames the live database to `<db>_old_<timestamp>` before
  swapping in `<db>_restoring`, and the EXIT trap can no longer drop anything once the swap has started; if the
  rename fails, the old database is renamed back. The script prints where the old copy is and how to drop it.
- `make backup-check` (or a new test) covers a forced restore over an existing database.
- README says backups always use the compose `db` service, and that a forced restore leaves newer photo files in place.

### B3 · Purge old tombstones
Status: done (2026-11-24)
Touches: backend/internal/store, backend/cmd, backend/Makefile
Parallel: alone
Acceptance:
- `make purge days=90` hard-deletes rows soft-deleted more than N days ago, following `docs/data-model.md`
  (join tables cascade from activity; `tree.planting_activity_id` and `task.resolved_by_activity_id` set to NULL).
- Runs in one transaction, prints counts per table, and has a store test.
- Tombstones still referenced by live rows (RESTRICT foreign keys, e.g. a deleted species with live trees) are
  skipped and reported, never forced.
- Decision: a late write to a purged id is accepted as a new row (no 410 any more). 90 days is far longer than any
  offline period; document this in docs/data-model.md.

## Mockup gaps (target: `docs/mockups/`)

### M1 · Close a task when logging the work
Status: done (2026-11-24)
Touches: frontend (quick log), maybe backend/internal/store (task)
Parallel: alone
Acceptance:
- In the quick log, after picking zones and an activity type, open tasks on those zones (or their plots) are listed
  with a checkbox; ticking one marks it done with `resolved_by_activity_id` = the new activity, in the same outbox
  flow (works offline): the task PUT carries its `base_version` and is queued after the activity's PUT.
- The zone page and tasks list show the task as done and link to the activity.

### M2 · Tasks: filter by plot
Status: done (2026-11-24)
Touches: frontend (tasks page)
Parallel: ok
Acceptance:
- Tasks page has a plot filter (all / each plot), remembered while the app is open; zone tasks count under their plot.
- Empty states read well on a phone.

### M3 · Zones sorted by need
Status: done (2026-11-24)
Touches: frontend (zone list)
Parallel: ok
Acceptance:
- The zone list sorts by urgency (needs water longest first, then other attention states, then fine), using the
  derived zone status — never a stored one.
- The order is explained in one short line in the UI.

### M10 · Offline task changes update zone badges right away
Status: done (2026-11-24)
Touches: frontend (api/tasks.ts, zone status/list queries)
Parallel: ok
Acceptance:
- Closing or reopening a task offline (tasks page, zone page, quick log) updates the zone's open-task count and its
  place in the zone list immediately (optimistic cache update), and the server's answer replaces it after sync.
- A test with the fake API offline shows the count change before the outbox flushes.

### M4 · Map: needs-attention summary
Status: done (2026-11-24)
Touches: frontend (map page)
Parallel: ok
Acceptance:
- As in `docs/mockups/map.html`: a compact "Needs attention" panel listing zones that need water / sowing / have open
  tasks, with counts; tapping one centres the map on the zone and opens its sheet.
- Collapsible, does not cover the map by default on a phone.

### M5 · Map: task pins and layer toggles
Status: done (2026-11-24)
Touches: frontend (map page, map/)
Parallel: ok
Acceptance:
- Open tasks show as pins at their zone's (or plot's) centre; tapping a pin shows the task with a "done" action.
- Layer toggles Plots / Zones / Tasks as in the mockup, remembered on the device.

### M6 · Map: show state as of a date
Status: done (2026-11-24)
Touches: backend (zone status as of), frontend (map page)
Area: map, zone-status
Acceptance:
- A date control ("Show state as of", mockup) recolours zones by their status on that day, computed from the activity
  log up to that date (backend parameter on the zone status query, defaults to `field_today()`; likely a migration
  turning the `zone_status` view into a function of the date).
- Clear "viewing <date>" indicator and one tap back to today. Tests for the as-of query.

### M7 · Plot stats: watering coverage and weekly activity
Status: done (2026-11-24)
Touches: backend (stats), frontend (stats page)
Area: stats
Acceptance:
- First check what `StatsPage.tsx` already shows; build only what is missing from `docs/mockups/plot-stats.html`:
  watering coverage over the last 7 days and activity per week over the last 8 weeks, per plot.
- Readable on a phone without horizontal scrolling. Backend tests for the numbers.

### M8 · Species: where each species is used
Status: done (2026-11-24)
Touches: backend (species/stats), frontend (species page)
Area: species
Acceptance:
- Species page shows, per species, the number of zones, living trees, and the last sowing/planting date (mockup
  `species.html`).

### M9 · Plot page
Status: done (2026-11-24)
Touches: frontend (new page, routes), maybe backend
Area: plot-page, routes
Acceptance:
- `/plots/:id`: plot name, area, its zones (sorted by need), open tasks, recent activity, link to its stats.
- Reachable by tapping a plot label on the map and from the stats page.

### M11 · Zone sheet on a past day: no misleading actions
Status: todo
Touches: frontend (map page, zone sheet)
Area: map
Acceptance:
- While a past day is shown ("On 30 Oct:"), "Log activity" and "Edit zone" either are hidden or say clearly that they
  act on today. A unit test covers it.

## Field readiness

### F1 · Phone walkthrough of the main flows
Status: done (2026-11-24)
Touches: none at first (finds problems)
Parallel: alone
Acceptance:
- `frontend/e2e/walkthrough.e2e.ts` goes through the main flows on the phone emulation, through the UI (not the API):
  field setup with a photo, draw a plot and a zone, quick log a watering, go offline (`context.setOffline(true)`),
  log a sowing, come back online and see it sync, add and close a task. Screenshots of each step via `shot()`.
- Small fixes land in this item; anything bigger becomes a new `todo` item below with acceptance criteria.
- Progress entry lists the screenshots taken and what was rough.

### F2 · Display-size photo copies
Status: done (2026-11-24)
Touches: backend/internal/photo, frontend (map image)
Area: photo, map
Acceptance:
- On upload the API also stores a display copy (e.g. longest side 2048 px, JPEG) and the map loads it; the original is
  kept for alignment/calibration. Existing photos get copies on first request or via a one-off command.
- Map still lines up exactly (same frame units). Tests.

### F3 · Export the activity log as CSV
Status: done (2026-11-24)
Touches: backend (export endpoint), frontend (More page)
Area: export, more-page
Acceptance:
- `GET /api/export/activities.csv` (date, type, zones, plots, species, quantity, notes; several zones or species in
  one cell are joined with "; ") and a "Download CSV" button on the More page. Opens in a spreadsheet with correct accents (UTF-8 BOM). No coordinates in the export.

### F4 · Covas planted per date range
Status: done (2026-11-24)
Touches: backend (stats), frontend (stats page)
Area: stats
Acceptance:
- Stats page can show covas (planting holes) and trees planted between two dates, per plot and per species.

### F5 · Desktop: reach the More page from the top navigation
Status: todo
Touches: frontend (navigation)
Area: navigation, more-page
Acceptance:
- On desktop widths the More page (and with it the CSV export) is reachable from the top navigation, not only at `/more`.

### F6 · Planted stats: species trees follow the live zones
Status: todo
Touches: backend (stats)
Area: stats
Acceptance:
- In "Sown & planted by date", a species' tree count drops when some of the planting's zones are deleted, like the per-plot table (or the note and docs say it is not zone-aware).

## Tidy-ups (low priority)

### T1 · Purge and backup loose ends
Status: done (2026-11-24)
Touches: README, docs/data-model.md, backend/Makefile, backend/internal/store (comment + test only)
Area: backup-purge
Acceptance:
- README: the "Old deletions" section moves below the Backups **Restore** block.
- docs/data-model.md says a late *edit* (with `base_version`) of a purged activity or task gets 410 while a plain
  create makes a new row — whichever the code does — and a store/API test pins that behaviour.
- `make purge` treats only `dry=1` as a dry run; a comment in `store/purge.go` explains its lock order (tombstones
  only, Postgres rolls back on deadlock) or the README says to run it with the API stopped.
- `backup-check` cleanup can never drop `<db>_old_*` copies, whatever the database name length.

### M12 · Plot page: per-plot activity query and tap-overlap check
Status: todo
Touches: backend (activity list), frontend
Area: plot-page, map
Acceptance:
- The plot page's recent activity no longer depends on the 500-entry global log cap (per-plot query or `plot_id` filter).
- On a phone, tapping a zone right next to a plot name on the map still opens the zone, not the plot page.
