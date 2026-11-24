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
