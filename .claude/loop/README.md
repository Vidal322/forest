# Backlog loop

Start it from the repo root with `/loop Forest backlog loop: follow .claude/loop/README.md`, in auto mode (or another
mode that doesn't stop for permission prompts: the loop's agents run `nix develop`, git, psql and Playwright).
The setup must be committed on master first: worktrees are branched from master.

The session running the loop only coordinates: it never edits code itself, and nothing ever pushes (the
`.claude/hooks/git-guard.py` hook blocks `git push` in any form). Each iteration:

1. **Budget.** Run `.claude/loop/budget.sh <your session id>` (the id is the last folder of your scratchpad path).
   Exit 1 → stop the loop (ScheduleWakeup `stop: true`) and tell the owner the reason.
2. **Stop rules.** Run `python3 .claude/loop/items.py`. Stop if it lists nothing, or if `docs/backlog.md` has 3 or
   more `blocked:` / `failed:` items (they are waiting on the owner).
3. **Run.** `Workflow({ scriptPath: ".claude/workflows/forest-step.js", args: { date: "<today YYYY-MM-DD>", session: "<your session id>",
   items: <the JSON list from step 2, as a real array> } })`. It works through the items as a queue: up to 3 at a time (items sharing an
   **Area** tag never overlap; `Parallel: alone` items run by themselves), checks the budget before starting each one,
   and stops starting new ones on a budget stop, an interrupted item, or 3 blocked/failed items. Wait for its
   notification; don't poll. (Use the file path, not the name "forest-step": a named workflow
   is loaded when the session starts and would miss later edits.)
4. **Report.** Tell the owner in a few lines: what landed (commits), what got blocked (the questions) or failed, and
   why the workflow stopped (`stop`), if it did.
5. **Next.** If the workflow stopped for the budget or an interruption, or itself errored, stop the loop. If it simply
   finished, go to step 1 (reviews may have added new items) and, if the loop goes on, ScheduleWakeup 60 s with the
   same /loop prompt.

Speed: the landing and budget agents run on smaller models (Sonnet / Haiku), reviews on Sonnet, implementation and
fixes on the session model. Agents run only related tests while they work; the commit hook runs the full checks once.
Browser checks are scripted Playwright tests (`frontend/e2e/`, run with `.claude/loop/e2e.sh`), each checkout on its
own preview port and database, so several items can be checked at once.

## Pieces

| File | Role |
|---|---|
| `docs/backlog.md` | The goal: ordered items with acceptance criteria and status. |
| `docs/progress.md` | One entry per finished item: change, review findings, browser check, follow-ups. |
| `.claude/workflows/forest-step.js` | The queue: per item implement (worktree, branch `auto/<id>`) → independent review → fix (≤ 2 rounds) → squash-merge into master, up to 3 items at once. |
| `.claude/loop/items.py` | The todo items as JSON; `--show <id>` prints one item. |
| `.claude/loop/e2e.sh` | Fresh preview + Playwright e2e tests + stop, for the checkout it lives in. |
| `.claude/loop/renumber-migrations.sh` | At landing: moves a branch's new migrations after master's highest number. |
| `.claude/loop/worktree.sh` | An item's worktree `.claude/worktrees/<id>` with its own database `forest_wt_<id>`; `--remove` cleans all of it up, `--reset-db` recreates the database. |
| `.claude/loop/preview.sh` | Runs a checkout's app on a free port (8100–8199) with its own fresh database. |
| `.claude/loop/budget.sh` | Stop check: 5-hour usage ≥ 75 % or context ≥ 40 % (`LOOP_MAX_5H`, `LOOP_MAX_CONTEXT`). |
| `.claude/hooks/git-guard.py` | Blocks `git push`; blocks any `git commit` whose backend/frontend checks fail. |

The usage numbers come from the status line (`~/.claude/statusline-command.sh`), which writes
`.claude/loop/usage/<session id>.json` whenever it renders (at least every 60 s: `statusLine.refreshInterval`) in a
checkout that has `.claude/loop/`. The budget is checked before each item starts, so items already running can push
past 75 % a little; an agent that hits the limit leaves its item `interrupted`, not failed.

Watch it live with `/workflows`; read `docs/progress.md` and `git log` afterwards. Items that failed keep their branch
`auto/<id>` and worktree for you; `.claude/loop/worktree.sh --remove <id>` throws one away.
