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
