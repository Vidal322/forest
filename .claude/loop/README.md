# Backlog loop

Start it from the repo root with `/loop Forest backlog loop: follow .claude/loop/README.md`, in auto mode (or another
mode that doesn't stop for permission prompts: the loop's agents run `nix develop`, git, psql and the Playwright MCP).
The setup must be committed on master first: worktrees are branched from master.

The session running the loop only coordinates: it never edits code itself, and nothing ever pushes (the
`.claude/hooks/git-guard.py` hook blocks `git push` in any form). Each iteration:

1. **Budget.** Run `.claude/loop/budget.sh <your session id>` (the id is the last folder of your scratchpad path).
   - Exit 1 → stop the loop (ScheduleWakeup `stop: true`) and tell the owner the reason.
   - Exit 2 (no usable usage snapshot) → say so once, keep going, but stop after 3 items in this session.
2. **Stop rules.** Read `docs/backlog.md`. Stop if there is no `todo` item, or if 3 or more items are `blocked:` /
   `failed:` (they are waiting on the owner).
3. **Pick.** Take the first `todo` item. Also take the next `todo` item only if both say `Parallel: ok` and their
   **Touches** don't share a page, package or directory. Never more than two.
4. **Run.** `Workflow({ name: "forest-step", args: { items: [{ id, title, text }], date: "<today YYYY-MM-DD>" } })`,
   where `text` is the item's full section. Wait for its notification; don't poll.
5. **Report.** Tell the owner in 1–3 lines what landed (commit), what got blocked (the question) or failed.
6. **Next.** Stop the loop if any item came back `interrupted` (an agent died, most likely the usage limit; the item
   stays `todo` and its branch keeps the work), if a landing `failed` because of the main checkout, or if the
   workflow itself errored. Otherwise run step 1 again and, if the loop goes on, ScheduleWakeup 60 s with the same
   /loop prompt.

## Pieces

| File | Role |
|---|---|
| `docs/backlog.md` | The goal: ordered items with acceptance criteria and status. |
| `docs/progress.md` | One entry per finished item: change, review findings, browser check, follow-ups. |
| `.claude/workflows/forest-step.js` | One iteration: implement (worktree, branch `auto/<id>`) → independent review → fix (≤ 2 rounds) → squash-merge into master. |
| `.claude/loop/worktree.sh` | An item's worktree `.claude/worktrees/<id>` with its own database `forest_wt_<id>`; `--remove` cleans all of it up. |
| `.claude/loop/preview.sh` | Runs a checkout's app on :8099 with a fresh scratch database, for Playwright checks. One at a time. |
| `.claude/loop/budget.sh` | Stop check: 5-hour usage ≥ 75 % or context ≥ 40 % (`LOOP_MAX_5H`, `LOOP_MAX_CONTEXT`). |
| `.claude/hooks/git-guard.py` | Blocks `git push`; blocks any `git commit` whose backend/frontend checks fail. |

The usage numbers come from the status line (`~/.claude/statusline-command.sh`), which writes
`.claude/loop/usage/<session id>.json` whenever it renders in a checkout that has `.claude/loop/`. The budget is only
checked between iterations, so one iteration can overshoot the 75 % a little; an agent that hits the limit leaves its
item `interrupted`, not failed.

Watch it live with `/workflows`; read `docs/progress.md` and `git log` afterwards. Items that failed keep their branch
`auto/<id>` and worktree for you; `.claude/loop/worktree.sh --remove <id>` throws one away.
