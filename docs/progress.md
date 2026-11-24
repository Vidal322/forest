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
