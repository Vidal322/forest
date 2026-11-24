export const meta = {
  name: 'forest-step',
  description: 'Forest backlog loop: work through the todo backlog items, up to 3 at a time, each implemented on its own branch, independently reviewed and fixed, then squash-merged into master locally',
  whenToUse: 'The Forest backlog loop (.claude/loop/README.md). args: {date: "YYYY-MM-DD", session: "<session id>", items: <output of python3 .claude/loop/items.py>, maxConcurrent?: 3, limit?: N}',
  phases: [
    { title: 'Plan', detail: 'read the todo items; budget check before each item starts', model: 'haiku' },
    { title: 'Implement', detail: 'one agent per item, in its own worktree on branch auto/<id>' },
    { title: 'Review', detail: 'fresh agent: diff vs acceptance criteria, rules, e2e browser tests', model: 'sonnet' },
    { title: 'Fix', detail: 'fix the findings, at most 2 rounds' },
    { title: 'Land', detail: 'one item at a time: rebase, squash-merge into master, backlog + progress, commit', model: 'sonnet' },
  ],
}

const MAX = args.maxConcurrent || 3
const MAX_BAD = 3
const date = args.date
const wt = (id) => `.claude/worktrees/${id}`
const br = (id) => `auto/${id}`
const show = (id) => `\`python3 .claude/loop/items.py --show ${id}\` (run it from the main repo root)`

const PLAN = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          areas: { type: 'array', items: { type: 'string' } },
          alone: { type: 'boolean' },
        },
        required: ['id', 'title', 'areas', 'alone'],
      },
    },
  },
  required: ['items'],
}
const BUDGET = {
  type: 'object',
  properties: { output: { type: 'string', description: 'the exact, complete output of the script' } },
  required: ['output'],
}
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
    checks: { type: 'string', description: 'what was run and the result' },
    browser: { type: 'string', description: 'e2e tests run and screenshots looked at, or why not needed' },
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

const CHECKS = `Checks: while working, run only the tests related to your change (frontend:
\`nix develop -c pnpm exec vitest run <files>\`; backend: \`cd backend && set -a && . ./.env && set +a &&
nix develop -c go test ./internal/<pkg> -run <Test>\`). Don't run the full \`make check\` / \`pnpm check\` yourself: the
commit hook runs them once on every commit and tells you what failed.`

const BROWSER = `Browser tests: anything a user sees gets an e2e test in frontend/e2e/<name>.e2e.ts (Playwright, phone
emulation; helpers in frontend/e2e/helpers.ts: ensureField, putPlot, putZone, rect, shot). Run them with
\`.claude/loop/e2e.sh [spec]\` from inside the worktree: it starts a fresh preview of that worktree on its own port and
database, runs the tests and stops it (about 10 s). Take screenshots with \`shot(page, name)\` and look at
frontend/e2e-results/<name>.png with the Read tool. Don't use the Playwright MCP tools (one browser, shared).`

// ---- one item ----

const implement = (it) =>
  agent(
    `Implement backlog item ${it.id} — ${it.title} of the Forest app. Read the item first: ${show(it.id)}.

Setup: from the repo root run \`.claude/loop/worktree.sh ${it.id}\`. It creates (or reuses) the worktree ${wt(it.id)}
on branch ${br(it.id)} and prints its absolute path; its backend/.env points at its own database, so tests and
migrations there never touch the dev database. If the branch already has commits beyond master, an earlier attempt was
interrupted: read them and continue that work. Work ONLY inside that worktree (cd into it in every command, or use
absolute paths): the main checkout and other worktrees belong to other agents working at the same time.

- Read what you need (docs/data-model.md; docs/mockups/ for UI). Keep to this item: no drive-by refactors.
- Add or update tests. Anything a user touches must work well on a phone in the field.
- ${CHECKS}
- ${BROWSER}
- Commit on the branch with \`git -C <absolute worktree path> commit\`. Conventional message, no Claude attribution.
  Several commits are fine: they get squashed when landing.
- If the item needs a decision only the owner can make (a product choice, not a technical one), don't guess:
  commit nothing and return status "blocked" with the question.`,
    { label: `impl:${it.id}`, phase: 'Implement', schema: IMPL },
  )

const review = (it, summary, round) =>
  agent(
    `Review a change another agent made for backlog item ${it.id} — ${it.title}. Read the item: ${show(it.id)}.
You did not write the change: be skeptical and concrete.

The work is on branch ${br(it.id)} in the worktree ${wt(it.id)}: \`git -C ${wt(it.id)} log master..HEAD\` and
\`git -C ${wt(it.id)} diff master...HEAD\`. What the author says they did:
${summary}

Check:
1. Every acceptance criterion is met. Say which ones you verified and how.
2. Correctness, and the rules in CLAUDE.md that apply (SRID 0 geometry writes, field_today(), version owned by the DB,
   upsert / tombstone 410 / 409 semantics, store lock order, writes through the outbox).
3. Tests cover the new behaviour. The full checks already passed in the commit hook; run related tests only if you
   doubt something.
4. If anything a user sees changed: run \`.claude/loop/e2e.sh\` from inside the worktree (all e2e tests, ~10 s),
   and look at the screenshots in frontend/e2e-results/ with the Read tool as someone in the field on a phone would.
   Missing e2e coverage of the item's flow is a finding. Don't use the Playwright MCP tools.

Do not edit files. "blocking" = wrong behaviour, a missed acceptance criterion, a broken CLAUDE.md rule, new logic
without tests, or a real phone-usability problem. Everything else is "minor".`,
    { label: `review${round}:${it.id}`, phase: 'Review', schema: REVIEW, model: 'sonnet' },
  )

const fix = (it, findings, round) =>
  agent(
    `Fix the review findings for backlog item ${it.id} (${it.title}) on branch ${br(it.id)} in the worktree
${wt(it.id)}. Work only inside that worktree. The item: ${show(it.id)}.

Findings:
${JSON.stringify(findings, null, 2)}

Fix every blocking finding, and the minor ones that are cheap and clearly right. If you think a finding is wrong, say
why instead of changing code.
${CHECKS}
${BROWSER}
Commit on the branch with \`git -C <absolute path of ${wt(it.id)}> commit\` (conventional message, no Claude
attribution). Return what you did per finding.`,
    { label: `fix${round}:${it.id}`, phase: 'Fix' },
  )

// Set when the usage limit is reached or an agent died: running items stop at their next step (their branch keeps
// the work and the item stays todo), and no new item starts.
let halt = null

async function work(it) {
  const impl = await implement(it)
  // An agent that dies (usually the usage limit) interrupts the item: it stays todo and the branch keeps the work.
  if (!impl) return { it, state: 'interrupted', note: 'the implementing agent died' }
  if (impl.status === 'blocked') return { it, state: 'blocked', note: impl.question || impl.summary, impl }
  let summary = impl.summary
  const fixes = []
  for (let round = 1; round <= 3; round++) {
    if (halt) return { it, state: 'interrupted', note: `halted before review ${round}: ${halt}`, impl, fixes }
    const rev = await review(it, summary, round)
    if (!rev) return { it, state: 'interrupted', note: 'the reviewing agent died', impl, fixes }
    const blocking = rev.findings.filter((f) => f.severity === 'blocking')
    log(`${it.id}: review ${round} — ${blocking.length} blocking, ${rev.findings.length - blocking.length} minor`)
    if (!blocking.length) return { it, state: 'ready', impl, rev, fixes }
    if (round === 3) {
      return { it, state: 'failed', note: `${blocking.length} blocking finding(s) left after 2 fix rounds`, impl, rev, fixes }
    }
    if (halt) return { it, state: 'interrupted', note: `halted before fix ${round}: ${halt}`, impl, rev, fixes }
    const f = await fix(it, rev.findings, round)
    if (!f) return { it, state: 'interrupted', note: 'the fixing agent died', impl, rev, fixes }
    fixes.push(f)
    summary = `${summary}\n\nFix round ${round}:\n${f}`
  }
}

const land = (r) =>
  agent(
    `Land the result of one backlog-loop item in master, in the main checkout (the repo root, branch master).
Date: ${date}. Other items may be in progress in other worktrees: touch only this item's worktree and master.

Item: ${r.it.id} — ${r.it.title}
Outcome: ${r.state}${r.note ? ` — ${r.note}` : ''}
Work branch: ${br(r.it.id)} in the worktree ${wt(r.it.id)} (may not exist if the item was blocked early).
Author's summary: ${r.impl ? r.impl.summary : '-'}
Last review: ${r.rev ? JSON.stringify(r.rev) : '-'}
Fix rounds: ${r.fixes ? r.fixes.length : 0}

First: the main checkout must be on master with no uncommitted changes to tracked files. If not, return "failed" with
that reason and touch nothing. Commit with \`git -C <absolute repo root> commit\` (the hook runs the full checks).

Outcome "ready":
1. If master moved since the branch was made, rebase the branch onto master inside the worktree. Resolve conflicts
   only if they are mechanical (the review is not re-run, so behaviour may not change): imports, both sides adding
   entries next to each other, or documentation (docs/*.md, README) where you keep both sides' text. Otherwise abort
   the rebase and handle the item as "failed" below. Two items changing the same table or column is never mechanical.
2. Migrations: run \`.claude/loop/renumber-migrations.sh\` inside the worktree (always, it does nothing when not
   needed). It moves the branch's new migrations after master's highest number in their order, commits, and resets
   the item's database. If it lists files still mentioning an old name, update them and commit.
3. Only after a rebase or a renumbering: run the full checks in the worktree for the parts the branch touches
   (\`nix develop -c make check\` and, if a migration was renumbered, \`nix develop -c make db-smoke\` in backend/;
   \`nix develop -c pnpm check\` in frontend/).
4. In the main checkout: \`git merge --squash ${br(r.it.id)}\`. After the rebase this cannot conflict; if it does
   anyway, undo it with \`git restore --staged --worktree -- .\` plus deleting the files it added (git status), and
   handle the item as "failed".
5. If the change touched frontend/package.json or the lockfile, run \`nix develop -c pnpm install --frozen-lockfile\`
   in the main checkout's frontend/ first.
6. docs/backlog.md: set the item's status to \`done (${date})\`. docs/progress.md: append an entry in the format at
   the top of that file (change, review findings and what happened to them, browser check, follow-ups). If the review
   left a follow-up that matters for correctness or for use in the field, add it as a new \`todo\` item at the end of
   its section in docs/backlog.md, in the same format (Status, Touches, Area, Acceptance).
7. Commit once: a conventional commit describing the change as a user would see it, in the style of
   \`git log --oneline -15\`; no Claude attribution.
8. \`.claude/loop/worktree.sh --remove ${r.it.id}\` (removes worktree, branch and its database).
Outcome "blocked": set the status to \`blocked: <the question>\`, append a short progress entry, commit
(\`chore(loop): ${r.it.id} blocked\`), then run \`.claude/loop/worktree.sh --remove ${r.it.id}\` if the branch holds
no commits beyond master (otherwise keep it and say so in the status).
Outcome "failed": keep the branch and worktree for the owner. Set the status to
\`failed: <one line> (branch ${br(r.it.id)})\`, append a progress entry with the findings left, and commit
(\`chore(loop): ${r.it.id} failed\`).

Return the status ("merged", "blocked" or "failed"), the commit hash, and one line for the owner.`,
    { label: `land:${r.it.id}`, phase: 'Land', schema: LAND, model: 'sonnet', effort: 'low' },
  )

// ---- the queue ----

// The coordinator passes items.py's output; reading it through an agent is only a fallback.
let all = Array.isArray(args.items) ? args.items : null
if (!all) {
  const plan = await agent(
    'Run `python3 .claude/loop/items.py` from the repo root. Return its JSON list unchanged as "items".',
    { label: 'plan', phase: 'Plan', schema: PLAN, model: 'haiku', effort: 'low' },
  )
  if (!plan) return { stop: 'could not read the backlog', results: [], notStarted: [] }
  all = plan.items
}
const queue = all.slice(0, args.limit || all.length)
log(`${queue.length} todo item(s): ${queue.map((i) => i.id).join(', ')}`)

const NO_DATA_ITEMS = 3 // without usage data, start at most this many items

// The agent only runs the script; the decision is made here from the numbers in its output.
async function budgetOk(it, started) {
  const b = await agent(
    `Run \`.claude/loop/budget.sh ${args.session}\` from the repo root. Return its exact, complete output.`,
    { label: `budget:${it.id}`, phase: 'Plan', schema: BUDGET, model: 'haiku', effort: 'low' },
  )
  if (!b) return { go: false, reason: 'the budget check died' }
  const out = b.output.trim()
  const m = out.match(/5h usage (\d+(?:\.\d+)?)% \(stop at (\d+)%\), context (\d+(?:\.\d+)?|\?)% \(stop at (\d+)%\)/)
  if (/STOP:/.test(out)) return { go: false, reason: out }
  if (m) {
    if (Number(m[1]) >= Number(m[2])) return { go: false, reason: `5-hour usage ${m[1]}%` }
    if (m[3] !== '?' && Number(m[3]) >= Number(m[4])) return { go: false, reason: `context ${m[3]}%` }
    return { go: true }
  }
  if (started < NO_DATA_ITEMS) return { go: true } // no usage data yet
  return { go: false, reason: `no usage data (${out})` }
}

const running = new Map()
const results = []
let landing = Promise.resolve()
let stop = null
let bad = 0
let started = 0

const clashes = (it) => {
  if (it.alone) return running.size > 0
  for (const r of running.values()) {
    if (r.alone || r.areas.some((a) => it.areas.includes(a))) return true
  }
  return false
}

async function runItem(it) {
  const r = await work(it)
  if (r.state === 'interrupted') return { id: it.id, status: 'interrupted', note: r.note }
  const p = landing.then(() => land(r))
  landing = p.catch(() => null)
  const l = await p
  return { id: it.id, ...(l || { status: 'interrupted', note: 'the landing agent died' }) }
}

while (queue.length || running.size) {
  while (!stop && running.size < MAX && queue.length) {
    // Priority order; an item that must run alone waits at the head until the others finish.
    const idx = queue[0].alone ? (running.size ? -1 : 0) : queue.findIndex((it) => !it.alone && !clashes(it))
    if (idx < 0) break
    const it = queue[idx]
    const b = await budgetOk(it, started)
    if (stop) break // something finished badly while the budget was being checked
    if (!b.go) {
      stop = halt = `budget: ${b.reason}`
      break
    }
    queue.splice(idx, 1)
    started++
    log(`start ${it.id} (${running.size + 1} running)`)
    const p = runItem(it)
      .catch((e) => ({ id: it.id, status: 'interrupted', note: `workflow error: ${e}` }))
      .then((res) => {
        running.delete(it.id)
        results.push(res)
        log(`${it.id}: ${res.status}${res.commit ? ` ${res.commit}` : ''}`)
        if (res.status === 'blocked' || res.status === 'failed') bad++
        if (res.status === 'interrupted') stop = halt = halt || `${it.id} was interrupted (${res.note})`
        if (bad >= MAX_BAD) stop = stop || `${bad} items blocked or failed`
      })
    running.set(it.id, { ...it, p })
  }
  if (!running.size) break
  await Promise.race([...running.values()].map((r) => r.p))
}

const notStarted = queue.map((i) => i.id)
if (notStarted.length) log(`not started: ${notStarted.join(', ')}${stop ? ` — ${stop}` : ''}`)
return { stop, results, notStarted }
