# Progress log

One entry per backlog item the loop finished (or gave up on), newest at the bottom. Format:

```
## <date> · <id> <title> — merged <commit> | blocked | failed
- Change: what a user (or the owner) will notice.
- Review: blocking findings and how they were fixed; minor findings left as is.
- Browser check: what was exercised on the phone-sized browser, or "not needed".
- Follow-ups: anything left over (new backlog items added, questions).
```

## 2026-11-24 · B2 Tests for the trees API — merged (squash of branch commit 7b5dcc4)
- Change: tests only, so nothing changes for the user. The new `backend/internal/httpapi/trees_test.go` covers
  `PUT /api/zones/{id}/trees/{species_id}` and `GET /api/tree-counts`. It checks that a repeated PUT changes nothing,
  checked on the tree rows themselves. It also checks lowering the alive count (a tree is marked dead, none is
  deleted), clearing to 0/0, all the validation errors (400 bad_id / bad_json, 404, 422), deleted species, zones and
  plots (422 / 410, and they leave the list), the exact response shape, and that an empty list is `[]`. The old smoke
  test moved here from `plots_test.go`. The tests found no bugs.
- Review: no blocking findings. Three minor ones were left as they are: (1) the deleted zone/plot cases only check the
  list, which already filters on live zones and plots, so nothing checks that the tree rows themselves are retired;
  (2) `counts()` in the test ignores an error from its second unmarshal; (3) a field left out of the PUT body counts as
  0, so `{"alive":1}` removes every dead tree (this was already true; the only client always sends both fields).
- Browser check: not needed (tests only).
- Follow-ups: these could become new items: assert `tree.deleted_at` after a zone or plot delete; make `alive` and
  `dead` required in the trees PUT (422 when one is missing).

## 2026-11-24 · B1 Backups and a tested restore — merged (squash of branch commits cd8fee7 + 47d099d, rebased)
- Change: new `make backup`, `make restore from= db= data= [force=1]` and `make backup-check` in backend/
  (`backend/scripts/`). A backup is `backups/<YYYY-MM-DD_HHMMSS>/` at the repo root with `db.dump` (`pg_dump -Fc` run
  in the PostgreSQL 17 container) and a copy of the photos, written as `.partial` until both parts are done. Restore
  loads into `<db>_restoring` first and only swaps it in when that worked, refuses the live database without `force=1`
  and always refuses `postgres`/templates. `backup-check` proves a round trip (row counts of every table, `diff -r` of
  the photos). README "Running it in the field" has a Backups section: daily cron line keeping 30 days, an off-machine
  copy, `backup-check` after setup and monthly, and how to restore.
- Review: round 1 findings fixed (cron PATH / missing docker, in-flight `.upload-*` files skipped, data folder created
  only after the swap). Three minor findings left as is: (1) in `restore.sh` the EXIT trap that drops the scratch
  database stays armed across `DROP <db>` + `RENAME`, so a failed rename after a successful drop would lose both;
  (2) only the database name is read from DATABASE_URL, backups always target the compose `db` service (not stated);
  (3) a `force=1` restore leaves newer photo files next to the restored ones (harmless, not said so).
- Browser check: not needed (scripts, Makefile and README only).
- Follow-ups: possible items: disarm the trap (or rename the old database to `<db>_old`) before the swap in
  `restore.sh`; document or warn that backups use the compose `db` service whatever host DATABASE_URL names.

## 2026-11-24 · B4 Restore never loses both databases — merged (squash of branch commit a41a0bd)
- Change: a restore over an existing database never drops it any more. `restore.sh` blocks new connections, then in
  one transaction disconnects sessions, renames `<db>` to `<db>_old_<YYYYmmdd_HHMMSS>` and `<db>_restoring` to `<db>`;
  if a rename fails the transaction rolls back and the old database keeps its name. Once the swap starts the EXIT trap
  only re-allows connections, it never drops anything. The script prints the old copy's name and the command to drop
  it. `backup-check` now also does a forced restore over the scratch database (refused without `force=1`; with it,
  exactly one `_old_` copy, original row counts in both, both accept connections). README: backups and restores always
  use the compose `db` service (only the database name in DATABASE_URL is used), a replaced database is kept as
  `<db>_old_<date_time>` until dropped, a forced restore leaves newer photo files in place.
- Review: no blocking findings. Three minor ones left as is: (1) `backup-check`'s `_old_` pattern uses
  `${check:0:40}` with unescaped `_`, so with a live database name of 40+ characters it could match (and its cleanup
  drop) the live database's own kept `_old_` copies; the default `forest` is safe; (2) the "refused without force=1"
  assertion only checks a non-zero exit, not the refusal message; (3) the rollback of a failed rename and the
  disconnect of a session holding the database open were checked by hand (both correct), not in `backup-check`.
- Browser check: not needed (scripts and README only).
- Follow-ups: possible items: make `backup-check` use a short fixed check name (or drop only the exact `_old_` name
  restore printed), grep the refusal message, and hold a connection (`pg_sleep`) during the forced restore. shellcheck
  is not in the dev shell, so the scripts are not linted.

## 2026-11-24 · B3 Purge old tombstones — merged (squash of branch commit 165ef92)
- Change: new `make purge [days=90] [dry=1]` in backend/ (`cmd/purge`, `store/purge.go`). It hard-deletes rows
  soft-deleted more than N days ago, in one transaction, in the order activity, task, tree, zone, plot, species,
  watering_rule. The existing foreign keys do the cascades (join tables from activity; `tree.planting_activity_id` and
  `task.resolved_by_activity_id` set to NULL), so the schema did not change. Each row is deleted in its own savepoint:
  a tombstone still referenced through a RESTRICT key is kept and reported under the constraint name, never forced.
  The command prints one line per table (purged, kept and why, join rows and links removed). It refuses fewer than
  30 days. `dry=1` prints the counts and rolls back. `field` and `field_image` are never purged, because an image row
  owns a photo file. Clearing `resolved_by_activity_id` on a live task bumps that task's version, so a phone editing
  that task gets one 409. docs/data-model.md records the decision that a late write to a purged id makes a new row.
  README has an "Old deletions" section.
- Review: no blocking findings. Four minor ones left as is: (1) the README "Old deletions" heading sits between the
  Backups text and its **Restore** block, so the restore steps now appear under the wrong heading; (2) the docs say a
  late write to a purged id becomes a new row, but a late *edit* (with `base_version`) of a purged activity or task
  still gets 410; that is safer, but it is not documented or tested; (3) the purge locks activity, then task/tree,
  then zone, then plot, the reverse of the store's plot → zone → task order. It only touches tombstones plus the
  SET NULL updates, and Postgres would roll back on a deadlock, but no comment explains this; (4) `make purge dry=0`
  still does a dry run (any non-empty value counts).
- Browser check: not needed (admin command and docs only).
- Follow-ups: these could become new items: move the README "Old deletions" section below Restore; document (and
  test) that a late edit of a purged activity or task gets 410; add a comment on the lock order (or say to run purge
  with the API stopped); accept only `dry=1`.

## 2026-11-24 · M1 Close a task when logging the work — merged (squash of branch commits 2920c25 + df0dd24)
- Change: frontend only. Once zones and a type are chosen, the quick log shows an "Also done" list of the open tasks on
  those zones and their plots, with checkboxes. Tasks whose kind matches the work (sow, water, plant, fertilize) come
  first and are ticked by default (plot-wide ones only when every zone of the plot is chosen); the Save button says
  "closes N task(s)". Each ticked task is sent as `status: done`, `resolved_by_activity_id` = the new entry and its
  `base_version`, queued in the outbox right after the entry, so it works offline. The confirmation adds
  "Done: <titles>."; Undo reopens those tasks, then deletes the entry. If the server refuses the entry, the dependent
  task writes fail too, are reported once, and the ticks stay. Done tasks on the zone page and the tasks list link to
  the entry ("Sowed 24 Nov →", `/zones/<zone>#entry-<id>`), which is scrolled to, focused and outlined. Reopening a
  task (tick or form) clears `resolved_by_activity_id`.
- Review: round 1 findings fixed (the button names how many tasks it closes; plot-wide tasks only pre-ticked for the
  whole plot). Three minor findings left as is: (1) after Undo the toast says only "Entry removed." though the tasks
  were reopened too; (2) pre-existing: persisted own-versions in `entity.ts` that are ahead of the server (e.g. after
  a database restore, or a preview on the same origin with another database) make every edit of that row 409, and
  the toast still said "Done: …" while the task stayed open; (3) preview tooling: a stale service worker on :8099
  served an old bundle until unregistered.
- Browser check: Pixel 7 emulation on the preview. Sowing on one zone pre-ticked only its task; watering both zones
  offline closed the zone and plot-wide tasks, and on reconnect the PUTs went activity, task, task; Undo reopened
  both (200) then deleted the entry (204); the tasks page link opened the zone page with the entry outlined.
- Follow-ups: these could become new items: name the reopened tasks in the Undo toast; drop own-versions higher than
  the version the server reports on refetch; have preview.sh clear the service worker and caches on start. Also
  noted by the author: the existing LogPage offline test leaks a retrying write into later tests; the zone page
  highlights "More" in the bottom bar.

## 2026-11-24 · M3 Zones sorted by need — merged (squash of branch commit 4e0d1ed)
- Change: frontend only. The zone list (Map > Zones) stays grouped by plot and sorts the zones of each plot by need,
  using only the status derived from the activity log (never the stored `needs_water`): first zones that need water,
  most days past their watering interval first; then zones needing attention (a planting zone with nothing sown yet,
  or any zone with open tasks, paths included); then the rest; name order inside each group (`needRank` / `byNeed`
  in `src/domain/zoneStatus.ts`). A hint line on top reads "Most urgent first: dry longest, then unsown or with open
  tasks." and a zone with open tasks shows "· N open task(s)". The status badge in the list no longer shrinks or wraps.
- Review: no blocking findings. Four minor ones left as is: (1) the open task count and attention rank come from the
  server's `zone.open_task_count`, which the cache does not update when a task is closed or added offline (seen in the
  preview: a task ticked done offline still showed "1 open task" until reconnect); (2) needs-water zones rank by days
  past their own interval, not days since watering — the same today since the interval is per field/season;
  (3) plots stay in name order, so "Most urgent first" only holds within each plot; (4) no test for ties in the
  needs-water group or for 'other'-kind zones.
- Browser check: Pixel 7 emulation on the preview with one plot and six zones: order was Encosta (19 days dry), Vale
  (10 days dry), Baixa (unsown), Caminho · 1 open task, Plantada · 1 open task, Regada; hint wraps to two lines, nothing
  overflows, tap targets kept. Offline task close reproduced finding (1).
- Follow-ups: these could become new items: derive open tasks per zone from the cached tasks query (or adjust
  `open_task_count` optimistically in the tasks entity) with an offline test; decide whether plots are ordered by
  their most urgent zone or the hint says "in each plot"; add tie and 'other'-kind cases to the sort tests.

## 2026-11-24 · M2 Tasks: filter by plot — merged (squash of branch commit 5a1f608, rebased as c525cdb)
- Change: frontend only. The Tasks page has a row of large chips under the heading, "All plots (n)" and one per plot
  with its open task count; the row scrolls sideways (never the page) and only shows with two or more plots. Zone tasks
  count under their zone's plot (`taskPlotId` in `src/api/tasks.ts`), and the "Show done and cancelled" list is
  filtered too. The choice is kept in memory while the app is open (`useRemembered` in `src/app/remembered.ts`,
  cleared per test in `src/test/setup.ts`), forgotten on reload, and falls back to all plots if that plot was deleted;
  coming back scrolls the chosen chip into view. Empty state: "Nothing to do in <plot>. 🌿", "N open tasks in other
  plots." and a "Show all plots" button. Chips instead of the mockup's select: easier to tap and show the counts.
- Review: no blocking findings. Four minor ones left as is: (1) with a plot chosen, Add task still starts at "Choose a
  zone or plot…", and a task saved for another plot does not show in the current view although "Added …" appears;
  (2) while plots/zones are still loading (or only partly cached offline) the filter briefly shows all plots, and zone
  tasks whose zone is not loaded drop out of the filtered list and counts; (3) for the same reason the per-plot counts
  may not add up to "All plots (n)" until zones load; (4) no test for the deleted-plot fallback (the chip scroll was
  checked by hand; jsdom has no layout).
- Browser check: Pixel 7 emulation on the preview with 4 long-named plots, one zone, 3 open tasks (one on the zone) and
  1 done task: chips 40px tall, row scrolls sideways, page scrollWidth stays 412; the last (off-screen) plot stayed
  chosen after Map -> Tasks and its chip was scrolled into view; a plot with only a done task showed the empty state
  plus "Show done and cancelled (1)"; reload reset to All plots. The stale service worker on the preview again had to be
  unregistered.
- Follow-ups: these could become new items: preselect the chosen plot in Add task (or switch back to All plots after
  adding elsewhere); wait for plots and zones before applying or dropping the remembered choice; test the deleted-plot
  fallback.

## 2026-11-24 · M10 Offline task changes update zone badges right away — merged (squash of branch commit 62cd754)
- Change: frontend only. Closing, reopening, moving or deleting a task (tasks page, zone page, quick log all use the
  same save) changes its zone's open-task count in the cached zone list at once, offline too, so the zone badge and its
  place in the zone list update immediately. `recountZones` in `src/api/tasks.ts` takes 1 off the zone the task was
  open in and adds 1 to the zone it is open in now, cancels an in-flight zone-list fetch first, and puts the counts
  back if the write fails; `entity.ts` now awaits the save hook like the delete hook. After sync the server's zone list
  replaces the local count. Plot stats counts still only update after sync. Tests: MapPage (offline close moves the
  zone down with no write sent, reopen puts it back, server count wins after flush) and TasksPage (offline move to
  another zone and delete update both zones).
- Review: no blocking findings. Five minor ones left as is: (1) during sync of a quick log the activity write's zones
  refresh runs while the task-close PUT is still queued, so the server's old count briefly comes back and the list
  jumps until the task write lands (fix: overlay queued task writes on refetched zones, or hold the zones refresh while
  task writes are pending; add a quick log + reconnect test); (2) the undo is not exact when a count was already 0
  (the clamp), fixed by the next refresh; (3) `cancelQueries(['zones'])` also runs while the zone list's first load is
  in progress, which can leave it unloaded until the next write or remount; (4) no test for the rollback on a rejected
  write (409/410) nor for the zone page / quick log paths (checked by hand); (5) tooling: a stale service worker on the
  preview origin served an old bundle.
- Browser check: Pixel 7 emulation on the preview with 1 plot, 3 sown and watered zones and an open task in Zone 3.
  Offline: closing it on /tasks moved Zone 3 from first to last, reopening on the zone page put it back on top, a new
  water task for Zone 1 counted at once, quick log "closes 1 task" dropped it again, a reload kept the state. Online:
  all writes synced and the server's counts ended up correct, with the brief flicker from finding (1).
- Follow-ups: these could become new items: no zones flicker while task writes are still queued (finding 1, with a
  quick log + reconnect test); exact undo and no cancel before the first zone load (findings 2-3); a 409 rollback test;
  make `preview.sh` start without an old service worker.

## 2026-11-24 · M4 Map: needs-attention summary — merged (squash of branch commits d55160e + 277269c, rebased)
- Change: frontend only. A small button under the map's zoom buttons says "N zones need attention ▾" (orange border)
  or "✓ Nothing needs attention". It starts closed and opens a list grouped as "Need water" (driest first, "dry N
  days"), "Not sown yet" and "Open tasks" (most tasks first), each with a count; the total counts each zone once. Tapping
  a zone closes the list, opens its sheet and pans the zone into view above the sheet. It shares the open/closed state
  with Legend and Zones, is hidden while drawing, while a sheet is open and when there are no zones, and the list
  scrolls between the zoom and bottom buttons. Status comes from `zoneStatus` + `useFieldToday`, so it works offline.
  New `src/domain/attention.ts`, `src/components/NeedsAttention.tsx`; `FieldLayers.tsx` centres a list pick above the
  sheet (pan limits widened on a copy, restored when the selection clears). Task counts use `open_task_count`, so
  plot-wide tasks are not counted. The mockup's "overdue tasks" line was replaced by open tasks, as the acceptance asks.
- Review: round 1 findings fixed in the second branch commit (centring above the sheet). Four minor findings left as
  is: (1) closing the sheet does not return to the view from before the pick, the map only springs back inside the
  padded field limits (same as before); (2) `prefersReducedMotion()` in `FieldLayers.tsx` duplicates the one in
  `FieldMap.tsx`; (3) the centring estimates the sheet as 60% of the map instead of measuring it, so the zone sits a bit
  high and a tapped zone in the band between estimated and real sheet top now moves; (4) no test for the map-tap rule
  (move only when the zone's centre is hidden).
- Browser check: Pixel 7 emulation on the preview, 16 zones in a 4x4 grid (some watered 20 Oct / 5 Nov, two never
  sown, 3 open tasks). Pill closed with "7 zones need attention" and orange border; list with counts and dry-days text,
  scrolling inside its space; picking Z16 opened its sheet with Z16 above it and hid the pill; closing brought the pill
  back closed; tapping Z6 on the map opened its sheet. A stale service worker had to be unregistered again.
- Follow-ups: these could become new items: restore the pre-pick view when the sheet closes; share
  `prefersReducedMotion`; measure the real sheet top; test the map-tap pan rule; an "overdue tasks" group if wanted.
  Rebased onto M10 (import-only conflict in `MapPage.test.tsx`); `pnpm check` passed after the rebase (168 tests).

## 2026-11-24 · M5 Map: task pins and layer toggles — merged (squash of branch commit ed4d019)
- Change: frontend only. Open and in-progress tasks show as red pins at their zone's centre (plot-wide tasks at the
  plot's centre), just under the zone's name. All open tasks of one place share a pin: one task shows its kind icon
  (and its title when zoomed in), several show a count. Tapping a pin opens a bottom sheet (`TaskSheet.tsx`) with that
  place's open tasks, each with the big tick and Undo; a ticked task stays struck through until the sheet closes, and
  the pin updates at once, also offline (outbox path of `useTaskToggle`). The sheet links to "History & tasks" (zone)
  or "All tasks" (plot); tapping a zone swaps sheets. Pins are hidden while drawing. The Legend button became "Layers":
  Plots / Zones / Tasks checkboxes, then the colours (new "Open task" entry), saved on the phone
  (`forest.map.layers`, new `app/device.ts`), with a dot and "Layers, N off" when something is off; an unreadable
  saved choice shows everything. With Zones off a zone picked from the list still shows, and drawing shows all
  outlines. One merged button instead of the mockup's two cards, because a third button hit "＋ Draw" on a phone.
  `TaskRow`'s edit action is now optional. Leaflet only sets a pin's title once, so it is updated by hand (tested).
- Review: no blocking findings. Four minor findings left as is: (1) a plot-wide pin at the plot's centre can look like
  it belongs to a zone, or sit exactly on a zone pin when the zone is centred (mockup puts it under the plot's name);
  (2) the pin is drawn below the centre, so on a small zoomed-out zone it falls outside the zone; (3) no test for pins
  hidden while drawing with Zones off, for closing the sheet with a map tap, or for ticking offline (checked by hand);
  (4) with Zones off the "N zones need attention" button still shows.
- Browser check: Pixel 7 emulation on the preview, 1 plot, 3 zones, 5 tasks (two on one zone, one overdue, one
  plot-wide, one done). Shared pin "2", single pins with icon and title, no pin for the done task; sheet with both
  tasks; offline tick kept the row struck through and the pin became "Task: Semear", Undo brought it back, the outbox
  replayed correctly when back online; layers off survived a reload with "Layers, 2 off"; drawing with Zones off
  showed 0 pins and all 3 outlines.
- Follow-ups: these could become new items: pin plot-wide tasks under the plot's name; anchor the pin on the centre
  when the zone is small on screen; tests for drawing with layers off and closing the sheet with a map tap; hint
  "zones hidden" on the attention button when Zones is off.

## 2026-11-24 · M8 Species: where each species is used — merged (squash of branch commit d7e4ea9)
- Change: each species card shows a usage line, e.g. "2 zones · 12 trees alive · sown 28 Jun 2025 · planted 3 Oct", or
  "Not used yet". New `GET /api/species-stats`. If it fails the list still shows. Refreshes after activity, tree
  count, zone, plot and species changes, also offline ones once synced.
- Review: no blocking findings. Minor, left as is: (1) a species with only dead trees reads "Not used yet"; (2) the
  card height shifts when the line appears after loading.
- Browser check: e2e smoke and species-usage passed; phone screenshot legible, nothing overflows.
- Follow-ups: could mention dead trees; reserve the usage line height while loading.

## 2026-11-24 · M7 Plot stats: watering coverage and weekly activity — merged (squash of branch commit 285afd9, rebased)
- Change: each plot card on the stats page shows a coverage bar ("X of Y cultivation zones (Z%)" watered in the last 7
  days) and an 8-week activity bar chart (rolling 7-day windows ending today, empty weeks greyed). New fields on
  `GET /api/plot-stats`: `cultivation_zones`, `zones_watered_7d`, `activities_per_week`. Zone names needing water from
  the mockup were left out on purpose (the "need water now" count and the map cover it).
- Review: no blocking findings. Minor, left as is: correlated subquery per plot and week (fine at this size); the
  weekly join relies on 8 rows per plot. Rebase conflict in `stats_test.go` (both sides added a test) resolved by
  keeping both; checks passed afterwards.
- Browser check: e2e plot-stats and smoke passed; phone screenshot fits the width, no horizontal scroll.
- Follow-ups: none.

## 2026-11-24 · M6 Map: show state as of a date — merged (squash of branch commits d0bbfb8 + f4b8b70)
- Change: the Layers panel has "Show state as of" (date box plus a 60-day slider). Zones are recoloured by their status
  on that day; a banner "Viewing <date> · N days ago" with "Back to today" replaces the needs-attention pill. The zone
  sheet shows "On <date>:". Backend: migration 00013 adds `zone_status_on(day)` (the `zone_status` view is now that
  function for today), `GET /api/zones?as_of=YYYY-MM-DD` (422 for a bad or future date). Limits (documented): today's
  zones and today's open task count are shown, since outlines and task status keep no history.
- Review: no blocking findings. Minor: (1) the sheet still offers Log activity / Edit zone on a past day (new item M11);
  (2) the Layers panel covers most of the map on a phone while dragging the slider; (3) e2e does not cover the slider
  or the failed-load banner; (4) the as-of limits above, left as documented.
- Browser check: e2e map-as-of and smoke passed; phone screenshots show the banner on one row, 44 px targets.
- Follow-ups: M11 added; the panel size and slider e2e could be tidied later.

## 2026-11-24 · M9 Plot page — merged (squash of branch commit 2a09765, rebased)
- Change: new page `/plots/:id` with the plot's name, measured area, area on the old map, zone count, a link to its
  stats card, its zones by urgency (status badge, open tasks), its open tasks (tick, undo, edit, add) and recent
  activity (10 at first, "Show more", totals only for this plot's zones). "Plot not found" for an unknown plot.
  Reached from the plot name on the map (underlined, big tap area, off while drawing), the plot headings in the zone
  list, and each plot name on the stats page.
- Review: no blocking findings. Minor: (1) the e2e has one plot, so the stats-page scroll to the right card is not
  really tested; (2) recent activity uses the 500-entry log list, so very old entries can be missing; (3) the label's
  tap area may overlap zone polygons. After the rebase the plot test fixture needed the new stats fields from the
  coverage change; fixed.
- Browser check: e2e plot-page, map and smoke passed; phone screenshots read well.
- Follow-ups: M12 added (per-plot activity query, tap-overlap check).

## 2026-11-24 · F1 Phone walkthrough of the main flows — merged (squash of branch commit e02571e)
- Change: new e2e `frontend/e2e/walkthrough.e2e.ts`, all through the UI: field photo and typed scale, a plot and a zone,
  a watering, offline sowing (waiting bar), sync, a task added and closed. It runs first (two Playwright projects).
  Screenshots in `frontend/e2e-results/`: walkthrough-01-welcome, 02-field-photo, 03-field-scale, 04-draw-menu,
  05-plot-outline, 06-plot-details, 07-zone-outline, 08-zone-sheet, 09-log-watering, 10-logged, 11-offline-sowing,
  12-synced-history, 13-task-form, 14-task-added, 15-task-done, 16-task-closed.
  Fixed: "No plots yet" note covered the zoom-out button; Draw menu hint split into a narrow column; hourglass on its
  own line in the waiting bar; log confirmation off-screen after Save (now scrolled into view). `map-as-of.e2e.ts`
  adjusted because the walkthrough's zone and scale stay in the shared DB.
- Review: no blocking findings. Minor, left as is: draw-menu text and hourglass fixes have no assertion (only in
  screenshots); no unit test for the LogPage scrollIntoView; map-as-of is now coupled to the walkthrough.
- Browser check: screenshots 04, 05, 11 looked at; all 6 e2e specs pass.
- Follow-ups: rough edges left: area shown instead of "Nothing logged here yet" once a scale exists; plot name label on
  the plot's top edge; duplicate confirmation and waiting bar offline; A/B handle dragging is not tested.

## 2026-11-24 · F2 Display-size photo copies — merged (squash of branch commit 89bea10)
- Change: uploads also store a display copy (longest side 2048 px, JPEG quality 82; none if the photo is already that
  small) at `photos/display/<key>`, served by `GET /api/photos/{key}/display` (cached forever). The map, log page and
  photo thumbnails load the copy; scale form and photo alignment keep the original. Old photos get a copy on first
  request. Coordinates stay in the original's pixels. New e2e `display-photo.e2e.ts`.
- Review: no blocking findings. Minor, left as is: (1) `FieldSettings` calls `fieldPhoto(field)` with the display
  default but only needs metadata; (2) `OpenDisplay` returns ErrTooLarge (probably a 500) for a stored photo over the
  limits, only reachable if limits are lowered after storing.
- Browser check: full e2e 7/7, screenshot `display-photo-map.png` looked right.
- Follow-ups: none that matter for the field.

## 2026-11-24 · F3 Export the activity log as CSV — merged (squash of branch commits 3b8d805, 6121d39)
- Change: `GET /api/export/activities.csv` returns every live activity, oldest first (Date, Type, Zones, Plots, Species,
  Quantity, Notes; "; " inside a cell), UTF-8 with BOM, CRLF, names only, file named `forest-activities-<today>.csv`.
  Cells starting with = + - @ get a leading apostrophe. The More page has an Export card with "Download CSV"; offline
  it says so, and it warns when queued changes are not in the file.
- Review: no blocking findings. Minor: a note starting with "-" or "+" shows the apostrophe (deliberate, documented);
  on desktop the More page is not in the top navigation.
- Browser check: full e2e 7/7 including export-csv; screenshot looked fine on a phone.
- Follow-ups: new item F5 (desktop navigation to More).

## 2026-11-24 · F4 Covas planted per date range — merged (squash of branch commits d1cb492, b37d9ee, rebased)
- Change: `GET /api/planted-stats?from=&to=` (422 on bad dates) and a "Sown & planted by date" card on the Stats page:
  quick ranges, From/To pickers (kept in the address), per-plot table (zeros included) and per-species table. Covas
  are not split by species, so a species gets the covas of every sowing whose mix included it; documented in
  `docs/data-model.md` and on the page.
- Review: no blocking findings. Minor: (1) species tree counts do not drop when some of a planting's zones are deleted
  (per-plot totals do); (2) no "nothing logged" hint when every total is 0 (left as is).
- Browser check: e2e 7/7 including planted-range; phone screenshot looked right, no sideways scroll.
- Follow-ups: new item F6 (species trees follow live zones).

## 2026-11-24 · T1 Purge and backup loose ends — merged (squash of branch commit ed8f3bc, rebased)
- Change: README "Old deletions" now follows the Restore block and says to back up and stop the API while purging.
  `make purge` is a dry run only for `dry=1`; other odd values stop with an error. `store/purge.go` documents the lock
  order (child-first, can deadlock with a concurrent edit; purge rolls back, the edit gets a 5xx). Late writes to
  purged rows are documented in `docs/data-model.md` and pinned by a test (edit with `base_version` gets 410, plain
  create makes a new row). `backup-check.sh` now uses `restore_check_<26 chars>` and an exact old-copy pattern, so it
  can no longer drop the live database's `_old_*` copies.
- Review: no blocking findings. Minor, left as is: the guard in backup-check.sh does not reject a database literally
  named `restore_check_*` (harmless, cleanup is exact).
- Browser check: not needed (docs, script, Makefile, comment, test).
- Follow-ups: none.

## 2026-11-24 · F5 Desktop: reach the More page from the top navigation — merged (squash of branch commit 61b8723)
- Change: on desktop widths (641px and up) the top bar has a "More" link, so the More page and its CSV export can be
  reached without typing `/more`. It is highlighted only on `/more`, because Plot stats, Species and Field setup have
  their own top-bar links. At 641-820px the links got less padding and a smaller font so the bar stays on one line.
  Phone bottom tabs are unchanged.
- Review: no blocking findings. Minor, left as is: the More link is not driven by the NAV list (deliberate); the e2e
  test covers only 641px and 1280px and only the Online status pill, not 642-820px or Offline.
- Browser check: e2e suite passed (11 tests), including the new desktop-more test at 1280px and 641px; 641px
  screenshot read.
- Follow-ups: none that matter for correctness.

## 2026-11-24 · M11 Zone sheet on a past day: no misleading actions — merged (squash of branch commit 29dc888)
- Change: when the map shows a past day, the zone sheet says "Logging and editing act on today." and the actions read
  "＋ Log for today" and "✎ Edit zone today". After "Back to today" the line goes and the usual labels return.
- Review: no blocking findings. Minor, left as is: the sheet is tall on a past day (actions wrap to two rows); the
  plot-page e2e test failed once and passed on rerun (looks flaky, unrelated).
- Browser check: e2e map-as-of passed on the phone-sized browser; screenshot read, line and buttons legible.
- Follow-ups: none that matter for correctness; the plot-page e2e flakiness could be looked at separately.

## 2026-11-24 · F6 Planted stats: species trees follow the live zones — merged (squash of branch commit 8835dc0, rebased)
- Change: in "Sown & planted by date", a species' planted-tree count drops when some of the planting's zones are
  deleted, like the per-plot table. Each species count is scaled by live trees / all trees (or live zones / all zones
  when no trees were counted per zone), rounded, so species rows can differ from the plot row by one. The note under
  the table and docs/data-model.md say so.
- Review: no blocking findings. Minor: when all zones with tree counts are deleted and a live zone has none, species
  keep about half their count while the plot shows 0; the case is untested. Left as is, added as F7.
- Browser check: e2e planted-range (3 tests) passed on the phone viewport; screenshot read, note wraps cleanly.
- Follow-ups: F7.

## 2026-11-24 · M12 Plot page: per-plot activity query and tap-overlap check — merged (squash of branch commit 922b7cd, rebased)
- Change: the plot page's recent activity no longer depends on the 500-entry global log cap. `GET /api/activities` takes
  `plot_id` (entries touching one of the plot's live zones; a bad id gives 400) and `usePlotHistory` fetches entries
  older than the global list from it. On the map, a tap on a plot name's padding more than 3px off the text opens the
  zone drawn under that point; with no zone underneath the plot still opens.
- Review: no blocking findings. Minor, left as is: the plot-page e2e failed in 2 of 4 runs at the stats scroll-to-card
  viewport check (looks like an existing race, not in this change); the tap routing has only an e2e, no vitest.
- Browser check: e2e map-tap-overlap (Pixel 7, touch taps below, right, above and on the name) and plot-page passed;
  screenshot read.
- Follow-ups: plot-page e2e flakiness at the stats scroll-to-card step could be looked at separately.

## 2026-11-24 · F7 Planted stats: species share when only dead zones had tree counts — merged (squash of branch commit cec0113)
- Change: when every zone with a trees count is deleted and a live zone has none, species rows now show 0 like the
  plot row (they used to keep about half, from the live-zones-over-all-zones fallback). The live trees sum in
  `GetPlantedStats` is COALESCEd to 0; the zone-ratio fallback only applies when no trees were counted on any zone.
  New case in `TestPlantedStats`.
- Review: no findings.
- Browser check: not needed (backend query only).
- Follow-ups: none.

## 2026-11-24 · T2 Make the plot-page e2e test reliable — merged (squash of branch commit 8006ad9)
- Change: a real app bug, not just a weak test. The `.visually-hidden` labels in the stats weekly chart are absolutely
  positioned and nothing above them was, so the document grew taller than the screen and scrolling a card into view
  also scrolled the whole app (top bar and tabs slid up, blank space below). `.main` is now `position: relative` and
  html/body use `overflow: clip` (`hidden` as fallback). The e2e now also checks the top bar link and the tabs' bottom
  edge after the card is in view; it failed 4 of 4 runs without the CSS fix.
- Review: no blocking findings. Minor, left as is: after scrolling, the card's top edge is just off screen (a
  `scroll-margin-top` would fix it, cosmetic); the tabs-bottom assertion compares with the exact viewport height, which
  could break if a safe-area inset is added.
- Browser check: plot-page spec --repeat-each=10 passed 11/11 (2/11 failed before); whole e2e suite 13/13 three times;
  stats screenshot read at phone size. Repeating the whole suite with --repeat-each=3 collides on fixed names in other
  specs ("Display zone", "Old sowing"); not touched.
- Follow-ups: optional `scroll-margin-top` on stats cards; e2e specs that reuse fixed names break under repeat-each.

## 2026-11-27 · P1 Portuguese (pt-PT) in the frontend — merged
- Change: every page, button, empty state, error, confirmation, aria-label, title and alt text is in European
  Portuguese ("tu"). `<html lang="pt-PT">`, PWA name "Forest — registo do terreno", pt-PT dates ("2 nov", "22 de novembro",
  "hoje", "há 5 dias") and numbers ("0,41 ha") through `domain/dates.ts` and `domain/numbers.ts`. Leaflet zoom buttons
  translated. Desktop top bar shows "Terreno" to fit. New `portuguese.test.tsx` and `portuguese.e2e.ts`.
- Review: no blocking findings. Minor: zone page highlights "Mais" in the tab bar (pre-existing); log quantities are
  integers only, so a decimal comma would be rejected if decimals are ever allowed; API errors and CSV header still English (P1b).
- Browser check: full e2e suite (14) passed; phone screenshots show Portuguese text, nothing cut off.
- Follow-ups: P1b (API messages, CSV header; export-csv.e2e still expects English), P2 (emoji, separators, arrows).

## 2026-11-27 · P1b Portuguese (pt-PT) in the API and the CSV export — merged
- Change: every API error message is in pt-PT (codes and statuses unchanged), written to read after the field label the
  app shows. CSV export: `;` separator, Portuguese header and type/unit words, BOM and formula guard kept, file named
  `forest-atividades-<day>.csv`. Portuguese labels added for more fields in `errors.ts`. New `messages_test.go`.
- Review: no blocking findings. Minor, left as is: bad_json message embeds Go's English decoder error; no decimal comma
  because quantities are integers; `agree()` hard-codes the plural fields.
- Browser check: full e2e suite (14) passed, including export-csv.e2e.ts.
- Follow-ups: none.

## 2026-11-27 · P2 Visual base: fonts, colours, icons, tabs, checks — merged (squash of branch commits 8dcd960 + 149e025)
- Change: Atkinson Hyperlegible Next and Alegreya are bundled (no outside requests, precached). The Pintar tokens replace
  the old palette (no shadows, gradients or caps; 44 px chips and small buttons; 3 px focus outline; reduced motion). SVG
  icons replace emoji in the nav, buttons and activity/task kinds. Phone tabs are Mapa, Registar, Tarefas ("(1 atrasada)"
  when late) and Mais; the sync line is in words. New `antiAi.test.ts` content check (allow-list per page, shrink-only)
  and `e2e/design.e2e.ts` (axe WCAG 2.1 AA and 44 px targets on all 10 pages). Rows use ", " instead of " · ".
- Review: no blocking findings. Minor: (1) walkthrough e2e failed once in several runs on "Rega guardada" not in the
  viewport, probably an existing flake in the Log page that P4c removes; (2) the shared components AsOf, NeedsAttention,
  ShapeEditor, ZoneList, PlantedInRange and FieldLayers still have " · " allow-list entries, to be emptied by P3 and P6;
  (3) the design spec's sowing task shows the water icon (test data), left as is.
- Browser check: full e2e suite 15/15 on the last runs; tabs, tasks and zone sheet screenshots read on a phone size.
- Follow-ups: P3 and P6 must empty the allow-list entries; watch the walkthrough flake until P4c.
