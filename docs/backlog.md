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
Status: done (2026-11-24)
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
Status: done (2026-11-24)
Touches: frontend (navigation)
Area: navigation, more-page
Acceptance:
- On desktop widths the More page (and with it the CSV export) is reachable from the top navigation, not only at `/more`.

### F6 · Planted stats: species trees follow the live zones
Status: done (2026-11-24)
Touches: backend (stats)
Area: stats
Acceptance:
- In "Sown & planted by date", a species' tree count drops when some of the planting's zones are deleted, like the per-plot table (or the note and docs say it is not zone-aware).

### F7 · Planted stats: species share when only dead zones had tree counts
Status: done (2026-11-24)
Touches: backend (stats)
Area: stats
Acceptance:
- When every zone with a trees count is deleted and a live zone has none, the species rows show 0 like the plot row (today the live share falls back to live zones over all zones, so each species keeps about half). Covered by a case in `TestPlantedStats`.

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
Status: done (2026-11-24)
Touches: backend (activity list), frontend
Area: plot-page, map
Acceptance:
- The plot page's recent activity no longer depends on the 500-entry global log cap (per-plot query or `plot_id` filter).
- On a phone, tapping a zone right next to a plot name on the map still opens the zone, not the plot page.

### T2 · Make the plot-page e2e test reliable
Status: done (2026-11-24)
Touches: frontend/e2e (plot page spec), maybe the stats page scroll-to-card
Area: plot-page, e2e
Acceptance:
- The plot-page e2e test passes 10 runs in a row (`.claude/loop/e2e.sh <spec> --repeat-each=10`), with no fixed
  sleeps: wait on what the user would see (the card in view, `toBeInViewport`).
- If the flake is a real app bug (scrolling to the card is unreliable on a phone), fix the app, not only the test.
- The whole e2e suite passes 3 runs in a row.


## Redesign "Pintar" (target: `docs/mockups/pintar/`)

Decided with the owner on 2026-11-27 (canvas "Forest — three non-generic directions", page "Pintar"). The static
mockups are the look: `mapa.html` (map + tools), `regar.html` (painting zones), `plantar.html` (counts and species),
`zona.html` (zone page). They show the main path only; anything they leave out keeps today's behaviour, restyled. Their links are placeholders
(for example the Plantar tool jumps straight to `plantar.html`): painting with Plantar or Semear looks like
`regar.html` with that tool chosen and its paint colour.
The older `docs/mockups/*.html` and today's app are the reference for features, not for looks.

Every P item starts by reading this whole section (decisions, glossary, tokens, checklist): the loop shows an agent
only its own item. P2–P6 share the `redesign` area and run in this order; each one first checks that the items
before it are `done` and returns `blocked` if not.

Decisions:
- **Language**: everything a user can see is in Portuguese (Portugal), addressed as "tu" ("Toca noutra zona").
  Glossary: plot = parcela; zone = zona; water = regar / rega; plant = plantar / plantação; sow = semear / sementeira;
  fertilise = adubar / adubação; other = outro; task = tarefa (por fazer, em curso, feita, cancelada); species =
  espécie(s); tree = árvore (viva / morta, vivas / mortas); units: covas (holes), sementes (seeds), árvores, litros,
  kg; zone status (feminine, agrees with "zona"): por regar, regada, plantada, semeada, sem nada, caminho (path);
  late = atrasada; save = guardar; cancel = cancelar; undo a save = anular; take the last painted zone off = tirar a
  última; note = nota ("Acrescentar uma nota"); photo = fotografia; edit = editar; delete = apagar; today / yesterday
  = hoje / ontem; map = mapa; legend = legenda; layers = camadas; history = histórico; stats = estatísticas; field
  setup = configurar o terreno; more = mais; offline = sem rede. Status as a sentence: "Sem rega há 20 dias".
- **Formats**: dates "22 de novembro" (long) and "2 nov" (short), months in lower case, both from one custom
  formatter (Intl's pt-PT short form is "2/11", not wanted); numbers with `Intl.NumberFormat('pt-PT')` as it is
  (decimal comma, "0,41 ha"; it doesn't group 4-digit numbers, fine). The CSV export follows Portuguese spreadsheets:
  `;` between columns, decimal comma, header in Portuguese, several values in one cell joined with ", " (a deliberate
  break from the English export).
- **Flow**: logging starts from the tools on the map (Regar, Plantar, Semear, Outro); the Log tab goes and the phone
  tabs are Mapa, Tarefas, Mais (Tarefas shows the number of late tasks). Pick a tool, tap zones to paint them (tap
  again to take one off; painted zones stay painted when you switch tools), then save. ✕ leaves without saving;
  "Tirar a última" takes the last painted zone off. With no tool picked, tapping a zone opens the zone sheet as today.
- **Look**: the field photo stays the map. Zone codes are marking-paint blobs whose colour is the status; dry zones
  are also hatched, so status is never colour alone. Place names (zones, plots) are set in Alegreya italic and nothing
  else is; all other text is Atkinson Hyperlegible Next. Both are self-hosted and precached, so they work offline.
- **Tokens**:
  - UI: pine `#2C4A3A` (main actions), ink `#1F2A24` (text), secondary text `#4F5A53`, water `#1F64B8` (water button
    and tool), rust `#A9461D` / `#8E3A0F` (late, dead, errors), control borders `#8A947F` (3:1 on white), dividers
    `#E2E6D8`, sheets white; tool tints `#DCEAF8` (regar), `#E2EDD6` (plantar), `#F4EBCD` (semear), `#ECEDE8` (outro).
  - On the photo: paint blobs orange `#F26B1D` (por regar), blue `#6FB2F2` (regada), green `#9BD06A` (plantada),
    yellow `#F2D14A` (semeada), white `#FFFFFF` (sem nada), grey `#B8B4A8` (caminho); hatching in marking orange
    `#F26B1D`; painted zones blue `#2D7FE0` (regar), green `#3E8E3A` (plantar), yellow `#F2D14A` (semear) at 55–60 %.
    Text on the photo always has a 4 px dark halo `#1E2416` or sits on a solid chip; codes on blobs are `#1F1A12`,
    on a zone painted with water `#174D92`. A dashed white outline means the zone overlaps a bigger one; others are solid.
  - More UI shades: inactive tabs and icons `#59645C`, body text on tints `#3F4B43`, banner icon rust `#B4470F`,
    semear icon ochre `#8A6A16`.
  - Tree symbols (zone page): one symbol per species, given in the order the species were created: filled circle
    `#2C4A3A`, ring `#6E8F35`, filled square `#8A6A16`, ring square `#1F64B8`, filled triangle `#4F5A53`, then the
    same shapes again in outline; dead trees are the species' symbol crossed out in rust. The legend is always shown.
  - Radii by size: 12 px controls, 16 px buttons and banners, 24 px sheet tops. No box-shadow anywhere (rings and
    selection are outlines or borders). Focus: 3 px `#1F64B8` outline, 2 px offset.

Anti-AI checklist (every item below that changes UI; the reviewer checks it on the phone screenshots and also runs
the `frontend-design:frontend-design` skill on the changed screens). P2 turns the first three lines into automatic
checks:
- No emoji as icons (inline SVG line icons), no gradients, no box-shadow, no all-caps (`text-transform: uppercase`).
- No " · " joined strings and no "→" / "←" in text; sentence case; a button says what it does and the confirmation
  reuses the word ("Guardar rega" → "Rega guardada").
- Text contrast ≥ 4.5:1, control borders ≥ 3:1, touch targets ≥ 44 × 44 px, visible focus, reduced motion respected.
- Judged by the reviewer: no decoration that carries no information, no grid of look-alike cards where a list or
  table would do.

### P1 · Portuguese (pt-PT) in the frontend
Status: done (2026-11-27)
Touches: frontend (every page and component, index.html, PWA manifest, unit and e2e tests)
Parallel: alone
Acceptance:
- Read the section "Redesign Pintar" above first (glossary, formats).
- No English left that a user can see in the frontend: pages, buttons, empty states, errors and confirmations,
  `aria-label`s, page titles, the PWA name and description. Strings live next to the feature that uses them (no i18n
  library: Portuguese is the only language). Error texts that come from the API are shown as they arrive (P1b translates them at the source).
- `<html lang="pt-PT">`; dates and numbers as in "Formats" (replace the `en-GB` / `en-CA` display formatters, keep ISO
  dates where code compares them). Names the user typed (zones, species) are shown as typed.
- Unit and e2e tests updated; one test renders every page and fails on a list of known English words ("Save",
  "Watered", "Tasks", "Cancel", …).

### P1b · Portuguese (pt-PT) in the API and the CSV export
Status: done (2026-11-27)
Touches: backend (user-facing error messages, CSV export)
Area: export, api-text
Acceptance:
- Read the section "Redesign Pintar" above first.
- Validation and conflict messages the UI can show are in Portuguese (the codes and HTTP statuses stay the same).
- The CSV export follows "Formats": Portuguese header, `;` between columns, decimal comma, ", " inside a cell,
  UTF-8 BOM kept; tests updated. The More page's button reads "Descarregar CSV".

### P2 · Visual base: fonts, colours, icons, tabs, checks
Status: done (2026-11-27)
Touches: frontend (styles.css, app shell and nav, shared components: buttons, chips, sheets, banners, StatusBadge,
SyncStatus, Flash), package.json, e2e
Area: redesign, styles, navigation
Acceptance:
- Read the section "Redesign Pintar" above first. Needs P1 done.
- Fonts from `@fontsource/atkinson-hyperlegible-next` (400, 500, 700) and `@fontsource/alegreya` (italic 400, 500,
  700), imported so Vite bundles them and the service worker precaches them; no request to Google Fonts;
  `font-display: swap`; the OFL licences stay in the packages.
- The tokens replace the current palette; emoji in nav, buttons and the activity / task-kind icons
  (`api/activities.ts`) become inline SVG line icons.
- Phone tabs: Mapa, Tarefas (with the late count), Mais; the Log tab stays until P4c removes it. The desktop top
  navigation keeps today's links, restyled. The sync state reads in words and hides when nothing waits.
- Automatic checks, run by `pnpm check` or the e2e suite: a test over `src/**/*.tsx` and `styles.css` for emoji,
  `box-shadow`, `uppercase`, `linear-gradient`, " · " and arrows; `@axe-core/playwright` on every page (contrast,
  labels); a Playwright check that every visible control's clickable box is at least 44 × 44 px (a checkbox is measured
  by its label; links inside running text are exempt; Leaflet's controls are restyled to 44 px in P3). The content
  checks scan JSX text and string literals only, never comments. Existing pages may
  fail the content checks until P3–P6 restyle them: keep an explicit allow-list per page in the test that those items
  shrink to empty.
- The shell and shared components pass the anti-AI checklist (whole pages are P3–P6).

### P3 · Map: photo with paint marks
Status: blocked: zones have no code (Z1, Z3…), only an optional name. Where should the code come from? (a) stored per plot, given out automatically, never reused (migration + API; show in zone list, sheet, tasks, CSV?), (b) worked out on the phone from the order of live zones (codes shift on delete), or (c) no code: status-coloured blob with the zone name or initials.
Touches: frontend (map page, FieldMap / FieldLayers, Legend, ZoneSheet look)
Area: redesign, map
Acceptance:
- Read the section "Redesign Pintar" above first. Needs P2 done.
- Matches `mapa.html`: white zone outlines on the photo, the zone code in a paint blob coloured by status (colours in
  the tokens, caminho included), dry zones hatched, zone names in Alegreya italic with a dark halo; every zone,
  overlapping ones included, has a visible, tappable blob; labels stay readable at every zoom.
- Top: plot switcher ("Parcela 1", "Todas as parcelas"). Choosing a plot fits the map to it; the banner and its count
  cover the chosen plot (all plots for "Todas as parcelas"); the switcher has a link to the plot's page (tapping a plot outline still opens it too).
- Banner "N zonas por regar: <names>" (hidden when none) opens `/log?zone=…` with those zones (P4a switches it to
  the water tool).
- Everything today's map has stays: drawing plots and zones (the draw button and menu), layers and the "as of" date,
  the zones list, task pins and their sheet, the zone sheet with its actions. They take the new look, nothing is
  removed. "Legenda" opens a legend explaining blobs, hatching and painted fills.
- The anti-AI checklist passes on the map; its allow-list entries go.

### P4a · Log by painting: the water tool
Status: blocked: needs P3, which waits on where zone codes come from (a stored per plot, b order on the phone, c none); or build P4a now with zone names instead of codes?
Touches: frontend (map page, a paint-state module, log save path)
Area: redesign, log, map
Acceptance:
- Read the section "Redesign Pintar" above first. Needs P3 done.
- Matches `regar.html`: the tool row on the map, with Regar working (the others can open today's log page until
  P4b). Tap zones to paint or unpaint them; the banner says "A regar N zonas" with ✕ and "Tirar a última"; the
  sheet has the day ("Mudar o dia", no future days), optional litres per zone ("Acrescentar litros"), an optional
  note, the open tasks on those zones with M1's ticking rule (only matching kinds are ticked by default), and
  "Guardar rega".
- Overlaps keep today's rule (the smaller zone wins the tap) and "Escolher da lista" picks zones without the photo.
- Saving goes through the outbox (a queued change counts as saved), returns to the map with no tool, and shows "Rega
  guardada" with "Anular" for a few seconds. The P3 banner and the zone page's "Regar" open the tool with those zones. The zone sheet's log action opens
  the tool row with that zone painted and no tool chosen yet (picking a tool keeps it); `/log` links stay for old
  bookmarks only.
- Unit tests for the paint state (add, remove, take the last off, cancel, switch tools); the anti-AI checklist passes.

### P4b · Log by painting: plant, sow, fertilise, other
Status: blocked: needs P4a (Regar tool), which waits on the P3 zone-code question: (a) stored per plot, (b) order on the phone, (c) no codes, or build P4a now with zone names?
Touches: frontend (paint tools, second step)
Area: redesign, log, map
Acceptance:
- Read the section "Redesign Pintar" above first. Needs P4a done.
- Plantar and Semear paint like Regar; the sheet's button reads "Continuar com N zonas" and opens the second step
  (`plantar.html`; back returns to the painting with the zones kept).
- Plantar: trees per zone (stepper and typed number), species with optional counts; when the species counts don't
  add up to the trees, a warning says how many are left ("4 árvores ainda sem espécie") but saving is allowed.
- Semear: count per zone in covas or sementes (a choice, covas by default), the seed mix with optional seed counts and
  no sum check.
- Outro holds Adubar (optional kg per zone) and "Outra atividade" (today's `other` type, note required as today),
  with the same fields as today. Day, note and task closing as in P4a. Buttons "Guardar plantação", "Guardar sementeira", "Guardar adubação",
  "Guardar atividade"; confirmations reuse the word ("Atividade guardada").
- Tests for each type's payload (same as today's log produces); the anti-AI checklist passes.

### P4c · Remove the Log tab
Status: todo
Touches: frontend (routes, nav, LogPage and its tests), e2e walkthrough
Area: redesign, log, navigation
Acceptance:
- Read the section "Redesign Pintar" above first. Needs P4b done.
- The Log tab goes; `/log` (with or without `?zone=`) redirects to the map with the water tool open and those zones
  painted; nothing links to the old page; its code and tests go once every feature lives in the tools.
- The e2e walkthrough logs a watering and a planting by painting, one of them offline, and still syncs.

### P5 · Zone page
Status: todo
Touches: frontend (zone page, ZoneTrees, the zone's history list)
Area: redesign, zone-page
Acceptance:
- Read the section "Redesign Pintar" above first. Needs P4c done.
- Matches `zona.html`: photo crop of the zone, the name in Alegreya italic, the status in one sentence for every
  status (not only "Sem rega há N dias"), "Regar" (opens the water tool with this zone) and "Outra coisa" (the other
  tools), open tasks with "Acrescentar tarefa" and "Mostrar feitas (N)", history in plain sentences with quantities and
  species ("Regada com Encosta norte", "30 árvores plantadas: sobreiro e castanheiro"), each entry still tappable
  to edit or delete; "Ver tudo" expands the full history in place.
- Trees as symbols (see the tree-symbol tokens), one per tree, grouped by species, dead ones crossed out; over 100 trees one symbol stands for 10 (said in
  the legend). "Corrigir" edits the counts as today.
- Zone notes, kind (caminho) and "Editar contorno" stay. The anti-AI checklist passes; its allow-list entries go.

### P6 · The other screens in the new style
Status: todo
Touches: frontend (tasks, species, stats, plot page, field setup, draw zone, more)
Area: redesign, styles
Acceptance:
- Read the section "Redesign Pintar" above first. Needs P5 done.
- Every remaining screen uses the tokens, fonts and icons and passes the anti-AI checklist; the P2 allow-list is
  empty at the end; screenshots of each screen on a phone in the progress entry; no feature removed.
- Place names in Alegreya italic wherever a zone or plot is named; tables that hold numbers stay tables.
