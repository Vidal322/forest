export const meta = {
  name: 'forest-step',
  description: 'Forest backlog loop: implement 1-2 items on branches, independent review + fix, squash-merge into master locally',
  whenToUse: 'One iteration of the Forest backlog loop (.claude/loop/README.md). args: {items: [{id, title, text}], date: "YYYY-MM-DD"}',
  phases: [
    { title: 'Implement', detail: 'one agent per item, in its own worktree on branch auto/<id>' },
    { title: 'Review', detail: 'fresh agent: diff vs acceptance criteria, checks, phone-browser check' },
    { title: 'Fix', detail: 'fix the findings, at most 2 rounds' },
    { title: 'Land', detail: 'one item at a time: squash-merge into master, backlog + progress, commit' },
  ],
}

const items = args.items
const date = args.date
const wt = (id) => `.claude/worktrees/${id}`
const br = (id) => `auto/${id}`
const itemText = (it) => `Backlog item ${it.id} — ${it.title}\n\n${it.text}`

const IMPL = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    summary: { type: 'string', description: 'what changed and why, for the reviewer and the progress log' },
    question: { type: 'string', description: 'when blocked: the question for the owner' },
  },
  required: ['status', 'summary'],
}
const REVIEW = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'minor'] },
          where: { type: 'string', description: 'file:line or screen' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'where', 'problem'],
      },
    },
    checks: { type: 'string', description: 'which checks ran and their result' },
    browser: { type: 'string', description: 'what was exercised in the phone browser + screenshot paths, or why not needed' },
  },
  required: ['findings', 'checks', 'browser'],
}
const LAND = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['merged', 'blocked', 'failed', 'interrupted'] },
    commit: { type: 'string' },
    note: { type: 'string', description: 'one line for the owner' },
  },
  required: ['status', 'note'],
}

const implement = (it) =>
  agent(
    `Implement one backlog item of the Forest app.

${itemText(it)}

Setup: from the repo root run \`.claude/loop/worktree.sh ${it.id}\`. It creates (or reuses) the worktree ${wt(it.id)}
on branch ${br(it.id)} and prints its absolute path; its backend/.env points at its own database, so tests and
migrations there never touch the dev database. If the branch already has commits beyond master, an earlier attempt was
interrupted: read them and continue that work. Work ONLY inside that worktree (cd into it in every command, or use
absolute paths): the main checkout and other worktrees belong to other agents.

- Read what you need first (docs/data-model.md; docs/mockups/ for UI). Keep to this item: no drive-by refactors.
- Add or update tests. Anything a user touches must work well on a phone in the field.
- Run the checks for what you touched, inside the worktree: \`nix develop -c make check\` in backend/,
  \`nix develop -c pnpm check\` in frontend/.
- For UI work, or an item that is itself a walkthrough: run the app with \`.claude/loop/preview.sh start\` from
  inside the worktree (fresh scratch database, http://127.0.0.1:8099; it waits while another preview runs) and use
  the Playwright MCP tools (phone emulation). An empty database needs a field photo: generate a PNG (python or
  ImageMagick) under .claude/loop/run/. Offline: \`browser_run_code_unsafe\` with
  \`await page.context().setOffline(true)\`. ALWAYS finish with \`.claude/loop/preview.sh stop\`.
- Commit on the branch with \`git -C <absolute worktree path> commit\` (a hook re-runs the checks and shows why if it
  blocks). Conventional message, no Claude attribution. Several commits are fine: they get squashed when landing.
- If the item needs a decision only the owner can make (a product choice, not a technical one), don't guess:
  commit nothing and return status "blocked" with the question.`,
    { label: `impl:${it.id}`, phase: 'Implement', schema: IMPL },
  )

const review = (it, summary, round) =>
  agent(
    `Review a change another agent made for this backlog item. You did not write it: be skeptical and concrete.

${itemText(it)}

The work is on branch ${br(it.id)} in the worktree ${wt(it.id)}: \`git -C ${wt(it.id)} log master..HEAD\` and
\`git -C ${wt(it.id)} diff master...HEAD\`.
What the author says they did:
${summary}

Check:
1. Every acceptance criterion is met. Say which ones you verified and how.
2. Correctness, and the rules in CLAUDE.md that apply (SRID 0 geometry writes, field_today(), version owned by the DB,
   upsert / tombstone 410 / 409 semantics, store lock order, writes through the outbox).
3. Tests cover the new behaviour. Run the checks yourself inside the worktree (\`nix develop -c make check\` in
   backend/, \`nix develop -c pnpm check\` in frontend/).
4. If anything a user sees changed: from inside the worktree run \`.claude/loop/preview.sh start\` (fresh scratch
   database, app on http://127.0.0.1:8099; it waits while another preview runs). Use the Playwright MCP tools (phone
   emulation) to go through the item's flow like someone in the field, take screenshots, and ALWAYS finish with
   \`.claude/loop/preview.sh stop\` (run from inside the worktree), even on failure. An empty database needs a field
   photo first: generate a PNG (python or ImageMagick) under .claude/loop/run/. Offline: \`browser_run_code_unsafe\`
   with \`await page.context().setOffline(true)\`.

Do not edit files. "blocking" = wrong behaviour, a missed acceptance criterion, a broken CLAUDE.md rule, new logic
without tests, or a real phone-usability problem. Everything else is "minor".`,
    { label: `review${round}:${it.id}`, phase: 'Review', schema: REVIEW },
  )

const fix = (it, findings, round) =>
  agent(
    `Fix the review findings for backlog item ${it.id} (${it.title}) on branch ${br(it.id)} in the worktree
${wt(it.id)}. Work only inside that worktree.

Findings:
${JSON.stringify(findings, null, 2)}

Fix every blocking finding, and the minor ones that are cheap and clearly right. If you think a finding is wrong, say
why instead of changing code. Run the checks, then commit on the branch with
\`git -C <absolute path of ${wt(it.id)}> commit\` (conventional message, no Claude attribution). If you start a
preview to check a fix, finish with \`.claude/loop/preview.sh stop\` from inside the worktree.
Return what you did per finding.`,
    { label: `fix${round}:${it.id}`, phase: 'Fix' },
  )

async function work(it) {
  const impl = await implement(it)
  // An agent that dies (usually the usage limit) interrupts the item: it stays todo and the branch keeps the work.
  if (!impl) return { it, state: 'interrupted', note: 'the implementing agent died' }
  if (impl.status === 'blocked') return { it, state: 'blocked', note: impl.question || impl.summary, impl }
  let summary = impl.summary
  const fixes = []
  for (let round = 1; round <= 3; round++) {
    const rev = await review(it, summary, round)
    if (!rev) return { it, state: 'interrupted', note: 'the reviewing agent died', impl, fixes }
    const blocking = rev.findings.filter((f) => f.severity === 'blocking')
    log(`${it.id}: review ${round} — ${blocking.length} blocking, ${rev.findings.length - blocking.length} minor`)
    if (!blocking.length) return { it, state: 'ready', impl, rev, fixes }
    if (round === 3) {
      return { it, state: 'failed', note: `${blocking.length} blocking finding(s) left after 2 fix rounds`, impl, rev, fixes }
    }
    const f = await fix(it, rev.findings, round)
    if (!f) return { it, state: 'interrupted', note: 'the fixing agent died', impl, rev, fixes }
    fixes.push(f)
    summary = `${summary}\n\nFix round ${round}:\n${f}`
  }
}

const land = (r) =>
  agent(
    `Land the result of one backlog-loop item in master, in the main checkout (the repo root, branch master).
Date: ${date}.

Item: ${r.it.id} — ${r.it.title}
Outcome: ${r.state}${r.note ? ` — ${r.note}` : ''}
Work branch: ${br(r.it.id)} in the worktree ${wt(r.it.id)} (may not exist if the item was blocked early).
Author's summary: ${r.impl ? r.impl.summary : '-'}
Last review: ${r.rev ? JSON.stringify(r.rev) : '-'}
Fix rounds: ${r.fixes ? r.fixes.length : 0}

First: the main checkout must be on master with no uncommitted changes to tracked files. If not, return "failed" with
that reason and touch nothing. Commit with \`git -C <absolute repo root> commit\`.

Outcome "ready":
1. If master moved since the branch was made, rebase the branch onto master inside the worktree. Resolve conflicts
   only if they are mechanical (the review is not re-run, so nothing else may change); otherwise abort the rebase
   and handle the item as "failed" below. After a rebase, re-run the checks in the worktree.
2. In the main checkout: \`git merge --squash ${br(r.it.id)}\`. After the rebase this cannot conflict; if it does
   anyway, undo it with \`git restore --staged --worktree -- .\` plus deleting the files it added (git status), and
   handle the item as "failed".
3. If the change touched frontend/package.json or the lockfile, run \`nix develop -c pnpm install --frozen-lockfile\`
   in the main checkout's frontend/ so the commit hook checks against the right dependencies.
4. docs/backlog.md: set the item's status to \`done (${date})\`. docs/progress.md: append an entry in the format at
   the top of that file (change, review findings and what happened to them, browser check, follow-ups).
5. Commit once (the hook runs the checks). The message is a conventional commit describing the change as a user would
   see it, in the style of \`git log --oneline -15\`; no Claude attribution.
6. \`.claude/loop/worktree.sh --remove ${r.it.id}\` (stops its preview, removes worktree, branch and its database).
Outcome "blocked": set the status to \`blocked: <the question>\`, append a short progress entry, commit
(\`chore(loop): ${r.it.id} blocked\`), then run \`.claude/loop/worktree.sh --remove ${r.it.id}\` if the branch holds
no commits beyond master (otherwise keep it and say so in the status).
Outcome "failed": keep the branch and worktree for the owner. Set the status to
\`failed: <one line> (branch ${br(r.it.id)})\`, append a progress entry with the findings left, and commit
(\`chore(loop): ${r.it.id} failed\`).
Outcome "interrupted": an agent died (most likely the usage limit). Change nothing, commit nothing, keep the branch,
and return status "interrupted".

Return the status ("merged", "blocked", "failed" or "interrupted"), the commit hash, and one line for the owner.`,
    { label: `land:${r.it.id}`, phase: 'Land', schema: LAND },
  )

// Items run concurrently; landing is serialised because every item ends in a commit on master.
let landing = Promise.resolve()
const landed = await parallel(
  items.map((it) => async () => {
    const r = await work(it)
    if (r.state === 'interrupted') return { id: it.id, outcome: r.state, status: 'interrupted', note: r.note }
    const p = landing.then(() => land(r))
    landing = p.catch(() => null)
    const l = await p
    return { id: it.id, outcome: r.state, ...(l || { status: 'interrupted', note: 'the landing agent died' }) }
  }),
)
return landed.map((l, i) => l || { id: items[i].id, status: 'interrupted', note: 'workflow error for this item' })
