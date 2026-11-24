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
