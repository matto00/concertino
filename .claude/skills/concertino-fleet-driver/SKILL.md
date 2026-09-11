---
name: concertino-fleet-driver
description: Drive multiple concertino orchestrator runs concurrently from directly within a Claude Code session, without the concertino watch TUI. Use when a user asks to work a batch of tickets, run an epic end-to-end, or otherwise wants several concertino deliveries coordinated in parallel by the current session rather than one at a time or via the dashboard.
license: MIT
metadata:
  author: concertino
  version: "1.2"
---

Coordinate several concertino ticket-delivery runs at once as their **driver** —
the layer above the orchestrator that `concertino watch`'s TUI (fleet view,
launch pad, `NEEDS YOU` queue) plays for a human operator, replayed here as
Claude Code session discipline instead: `Agent` calls instead of tmux panes,
`SendMessage` instead of approve/deny keys, `gh pr checks`/`gh pr merge`
yourself instead of a merge-confirmation screen.

Every rule below exists because skipping it caused a real, specific incident in
production driving (helio, 2026-08-16/17 — one session, seven tickets, three
near-misses; and 2026-09-07/09 — two nights, five lanes, 19 merged PRs, which
added §§11-15). This is not theoretical hardening; it is what actually broke.

---

## 1. Concurrency: hold a target count, never force a slot

Default to 2 concurrent orchestrator runs unless the user specifies otherwise.
When one finishes, dispatch the next queued ticket to refill the slot — but
**do not dispatch just to keep the count full** if every remaining candidate
has a concrete reason to wait (a migration-number claim it would collide with,
a file it would conflict with on a still-open sibling PR). Holding at N-1 for
a while is cheaper than resolving an avoidable merge conflict later. When a
user explicitly overrides this ("launch it anyway, in parallel"), follow the
instruction, but brief the new orchestrator on the specific collision risk
before it starts (see §4) rather than launching it blind.

## 2. Relay pattern: sub-agents without SendMessage need you as the wire

The executor, evaluator, and skeptic roles do not carry a `SendMessage` tool —
only the orchestrator does. When one of them reports a finding directly to you
(because it has no other way to reach its own orchestrator), your job is to
**relay it verbatim, with full technical detail, to that ticket's
orchestrator** via `SendMessage`, not to summarize-and-move-on. The
orchestrator cannot act on a report it never received. Preserve exact numbers,
file paths, and root-cause reasoning in the relay — the orchestrator will
often need to make a downstream decision (spawn the next phase, resume with
specific change requests) that depends on those details.

## 3. Verify PR mergeability yourself before merging — never trust "clean merge expected"

**This is the single highest-value rule in this document.** An orchestrator
that asserts a PR is conflict-free based on shallow signals (commit-list file
names, a belief that a sibling ticket doesn't touch the same files) can be
wrong, and the failure mode is worse than an ordinary merge conflict: GitHub
cannot materialize a `pull_request`-triggered CI run's merge ref when the PR
actually conflicts, so the real test-gate jobs (`backend`/`frontend` in a
typical setup) **never even queue** — only separately-managed checks that
don't need a merge ref (CodeQL, a security-analysis workflow) go green. `gh pr
checks` on such a PR looks mostly-passing unless you know to notice the
specific jobs that are missing entirely, not just pending.

Hit twice in one day (HEL-412, HEL-703) driving helio. Both times the
orchestrator's own claim was wrong; both times independently checking caught
it before a bad merge.

**Before merging any PR, always:**

```bash
gh pr view <N> --repo <owner>/<repo> --json mergeable,mergeStateStatus
gh pr checks <N> --repo <owner>/<repo>
```

- `mergeable != MERGEABLE` → do not merge. See §5 for how to hand the
  conflict back for resolution.
- `mergeable == MERGEABLE` but the checks list is missing jobs you expect
  (e.g. only `CodeQL`/`Analyze` show, no `backend`/`frontend`) → the merge
  ref may have failed to materialize moments ago; re-check, and if the real
  gates never queue at all even after the conflict clears, treat it as
  suspicious rather than assuming they'll show up eventually.
- Only once the *specific* jobs you know are the real gates show `pass` do
  you merge. `gh pr merge --squash` on this repo's convention — never
  `--auto` (a repo with no branch protection merges `--auto` instantly on
  green, which defeats the point of watching for it).

## 4. Shared numbered resources: you are the coordinator until CON-123 exists

Concertino has no atomic claim mechanism for shared numbered resources (e.g.
Flyway migration numbers) as of this writing (tracked: CON-123). A fresh
worktree's "highest number in my checkout" check cannot see a number an
unmerged sibling branch has already claimed — that branch's file doesn't
exist in a checkout of the base branch yet. Until CON-123 ships, **you are the
ledger**: track every number claimed by every in-flight run, and when
dispatching a new orchestrator whose ticket needs one, tell it explicitly
which number is free and which numbers are already spoken-for by unmerged
siblings, don't let it derive the number itself from a filesystem check. Also
tell it the merge order this implies (a branch holding a lower number
generally needs to merge before one holding a higher number, or the higher
one may need to renumber).

Also brief on real file-overlap risk the same way: if two tickets you're about
to run concurrently are both going to touch the same file (e.g. both modify a
shared route file, or both extend the same auth flow), say so explicitly
before dispatch, including which specific functions/call sites are likely
contended. An orchestrator briefed this way can shape its own diff to
minimize the eventual conflict (see the AuthService `finishLogin` pattern
below) — one briefed blind cannot.

## 5. A real conflict needs context-aware resolution, not a blind merge

When you find `mergeable: CONFLICTING` (§3), do not resolve business-logic
conflicts yourself by hand, and do not have the orchestrator squash through
them blindly. Do a **local merge-check only** to see the shape of the
conflict, then abort and hand it back with the specifics:

```bash
git fetch origin <branch>
git checkout -b tmp-mergecheck origin/<branch>
git merge origin/<base>   # do NOT resolve — just see what conflicts
# note the conflicting files, then:
git merge --abort
git checkout <base>
git branch -D tmp-mergecheck
```

Send the orchestrator the exact file list and, if you can tell from the diff,
what each side's intent was — this is what lets its executor make the kind of
judgment call that actually held up in practice (e.g. HEL-703's resolution:
a replayed idempotent send must not consume a beta-tier cap unit, because the
model is genuinely never called for a replay — a fact only visible by reading
both tickets' actual code, not by taking either side of a text conflict). An
orchestrator that pre-planned its own diff to be conflict-resistant (writing
out the exact merge recipe during Planning, once it knows a collision is
likely — see §4) will resolve real conflicts fast and correctly when they
land; one that didn't will need more of your context to do the same.

If a warm executor stalls or dies mid-resolution (a very large accumulated
transcript is a plausible cause), a fresh spawn with the worktree's actual
`git status`/`MERGE_HEAD` state as its starting context can usually finish
cleanly — the git-level merge state persists on disk independent of any
agent's own memory.

## 6. Deploy pipeline: the script that "obviously" deploys may not be what runs

A project's manual deploy script (e.g. `infra/deploy-backend.sh`) can look
authoritative but not actually be what an automatic CD workflow invokes. If
CD is a separate hardcoded flags string in a GitHub Actions workflow file
(e.g. `--update-env-vars=...` baked directly into a `deploy-cloudrun` step),
a new environment variable added only to the manual script's config example
will silently never reach production via the automatic path. This bit twice
in one day (a missing `ANTHROPIC_API_KEY`, then a missing
`HELIO_OWNER_EMAILS`) before the pattern was recognized. When a ticket's
acceptance criteria says "set X in prod" or "deploy with Y configured,"
**trace the actual CD trigger path yourself** before assuming the ticket's own
post-deploy checklist points at the right file — grep the CD workflow's own
flags/env list, not just the manual script.

## 7. Escalation calibration: two tracks, applied consistently

- **Decide directly** (narrow, precedented, low product/architecture stakes):
  migration-number picks, `fold-in`/`standalone`/`discard` triage on a
  suggested follow-up, whether a disclosed pre-commit bypass is acceptable,
  whether to trust a self-correcting orchestrator's own re-verification over
  your first read.
- **Escalate to the human** (genuine architectural/product fork with real
  tradeoffs, or a new external dependency/vendor): a scope-widening decision
  that changes what "done" means, a new third-party service the ticket didn't
  already assume, a security-mechanism choice (MFA method, abuse-prevention
  strategy) with real cost/complexity tradeoffs between options. Present
  options with a stated recommendation, not an open-ended question — the
  human's job at this point is to pick or redirect, not to design from
  scratch.

Getting this split wrong in either direction has a cost: escalating narrow
decisions burns the human's attention on things they don't need to weigh in
on; deciding genuine forks yourself removes a choice that was actually theirs
to make.

## 8. Known concertino tooling gaps to route around until fixed

- **CON-121** — `cleanup.sh`'s `other_runs_live()` check has no staleness
  bound: a run that ends on an unanswered escalation timeout stays "live"
  forever and silently blocks `concertino sync` for every subsequent run.
  Confirmed recurring (twice in one week as of this writing). Before assuming
  a "run X is still live" message is real, check whether it actually is:
  ```bash
  tail -5 .concertino/runs/<TICKET>/events.jsonl   # stale if the last event is old and terminal-looking (escalation.timeout, not run.end)
  ps aux | grep <worktree-path>                     # confirm no live dev-server process is actually attached
  ```
  If genuinely stale, unstick it by hand (do **not** wait for the fix to
  land):
  ```bash
  echo "{\"t\":$(date +%s%3N),\"kind\":\"run.end\",\"project\":\"<project>\",\"ticket\":\"<TICKET>\",\"role\":\"script\",\"status\":\"abandoned-stale\"}" >> .concertino/runs/<TICKET>/events.jsonl
  ```
  If a live process **is** attached (a real dev server, an in-progress
  worktree), leave it alone — that's a true positive, not the bug.

- **HEL-657** (or your project's equivalent) — an openspec-hygiene pre-commit
  check that fires "complete but not archived" on every executor
  implementation commit, before the orchestrator's own later archive commit
  resolves it — expected and disclosed, not a real problem, but expect to see
  a `git commit -n` with a documented reason on essentially every cycle-1+
  commit in this workflow until it's fixed at the source.

- **CON-125** (or your project's equivalent) — concurrent evaluator/skeptic
  Playwright sessions can share one browser context and hijack each other's
  tabs mid-verification, including session/cookie loss. If a live-verification
  report mentions losing its tab or needing to re-verify, this is very likely
  why — not a defect in the change under review.

## 9. What "genuinely complete" means for you as driver

A ticket is not done when its orchestrator reports the PR is up — it is done
when: (1) you have independently verified real CI green (§3), (2) you have
merged and fast-forwarded whatever release branch actually deploys, (3) any
deploy-side configuration the ticket's acceptance criteria implies has been
traced and applied (§6), and (4) you have sent the "merged" confirmation back
so the orchestrator can run its own Phase 4. Treating the PR-created moment as
the finish line is the single most common way to let a real problem (an
unresolved conflict, a missing env var) slip through unnoticed.

## 10. A "waiting" completion is a stall — nudge it, never wait for it

This is the single highest-frequency failure in headless driving: **seven
occurrences across one two-session batch** (helio, 2026-08-26/27), every one
recovered by a nudge, none self-recovering.

An orchestrator ends its turn with a line like:

- "Executor resumed for cycle 2. Waiting for it to complete."
- "Waiting for the executor's response to the fix request."
- "Waiting for CI checks to complete before squash-merging."
- "I'll continue driving Evaluation ... as soon as it reports back."

Ending a turn is not waiting. Nothing wakes a subagent when its own child
finishes, so the run is dead until a human intervenes. Upstream this is
CON-140 / CON-146.

### The rule

When a task-completion notification arrives whose result text describes
*waiting, monitoring, or intending to continue* rather than a finished
outcome, **treat it as a stall and nudge immediately.** Do not wait to see
whether it resumes. It will not.

Terminal results read like outcomes — "merged as `abc1234`", "verdict PASS",
"escalating: need a decision on X". Non-terminal results read like intentions.

### Why you cannot automate this away

An external watchdog can *detect* a stall from `events.jsonl` (an
`agent.spawn` with no terminal record past a timeout) but cannot *act* on
one. A stalled orchestrator has ended its turn, so it polls nothing —
`concertino answer` and every other file-based channel reach only an agent
that is still running and blocked in-turn. The only things that can resume a
stalled subagent are `SendMessage` from its parent session and a human typing.
Both live inside a session; neither is available to an external process. That
is why this is driver discipline rather than tooling.

### The nudge that works

Send, to the stalled agent:

1. `RESUME — do not start over. Read workflow-state.md and continue from the
   phase recorded there.`
2. Quote its own yielding sentence back and name the failure explicitly, so it
   does not re-derive the situation from scratch.
3. Replace the rule with a *procedure*: poll inside your own turn — read
   `events.jsonl`, check the worktree with `git log` / `git status` / the
   change-dir artifacts; for CI use `gh pr checks <n> --watch`, which blocks
   in-turn and is the right tool.
4. Restate the standing constraints (models, escalation threshold, merge
   policy). A resumed agent has lost none of its context, but restating is
   cheap and it costs a whole cycle if one has drifted.
5. Where you can, hand it the state you already verified — PR number, head
   SHA, which checks are green — so it does not spend a turn re-deriving what
   you already know.

### Warning it in advance does not work

Across this batch every orchestrator was given an explicit, specific warning
about this exact failure mode in its spawn prompt — several also with concrete
polling instructions — and stalled anyway. Prose has now failed at four
escalating strengths (role doc ×8, a targeted doc fix, a bespoke per-run
warning, warning plus procedure). Budget for nudging as a normal cost of
driving; do not assume a better-worded brief removes it.


## 11. Dispatch one orchestrator per ticket — never a queue to one lane

The orchestrator role is built around **single-ticket, single-worktree
delivery**. Its entire state machine is keyed to one run: `run.start`,
`.concertino/runs/<TICKET>/`, `workflow-state.md`, phase assertions,
`squash-branch.sh`, `cleanup.sh --phase4`. Handing one orchestrator a
multi-ticket queue makes it re-enter that machine repeatedly inside a single
context, and the context is what breaks first.

Measured on helio, 2026-09-07/09:

| lane shape | tokens |
|---|---|
| one ticket, long-lived lane | **630k** |
| three tickets, one lane | 369k and degrading |
| **one ticket, fresh orchestrator** (incl. a cold resume of a half-finished run) | **154k** |

A batch lane compacts around ticket two or three — and what it loses is exactly
the accumulated constraint knowledge that makes the *later* tickets good. A
fresh per-ticket orchestrator starts at zero and receives those constraints from
your spawn prompt, which is cheap and lossless.

Three further reasons, each observed:

- **Failure isolation.** A lane stopped by accident took its whole remaining
  queue with it. Per-ticket, that loses one run.
- **Staleness.** Long-lived orchestrators are precisely what goes stale (§10).
  A short-lived one has less turn surface on which to yield.
- **Reconstruction.** A replacement orchestrator, given only the ticket and the
  worktree, recovered a run whose `workflow-state.md` was **three phases stale**
  by reading `events.jsonl` — and did it for a quarter of the long-lived lane's
  token cost.

**So: you hold the queue.** Dispatch the next ticket on each merge notification.
That is the loop, and it costs you one `Agent` call per ticket.

The exception is scale, not preference: a run of small mechanical tickets pays
60–70% orchestrator overhead (setup, planning artifacts, gate rounds, delivery,
cleanup) on each one. For a genuinely mechanical, cross-cutting, or urgent
change — a lockfile bump unblocking every lane, a release cut — do it yourself
directly and say so.

## 12. Everything you assert to a lane is a claim it must verify

You will be wrong, and lanes will act on it. Across one batch the driver was
wrong **six times**:

- attributed an e2e race to a ticket before measurements existed (it was
  pre-existing, and reproduced at a *higher* rate on the prior commit);
- called a fix "one line" without reading the file — the conditional also
  wrapped a Load-more button, so the "fix" would have shipped a visible,
  focusable, dead control;
- amplified a false rationale from one ticket into a new one, raised its
  priority on that basis, and specified a verification target that passes
  *without* the fix;
- endorsed a guard whose mutation exercised a branch that cannot leak;
- handed an executor a citation mapping that was backwards;
- relayed a ticket's "plausibly one token" premise as a reason a fix would be
  tractable — it was 17 sites across 8 stylesheets.

**Every single one was caught by a lane checking rather than executing.** None
was caught by the driver re-reading its own message.

The mitigation is structural, not resolve: **brief every lane that driver
statements are claims to verify, and say so in the spawn prompt.** Then treat a
lane correcting you as the system working, not as friction. When it happens,
say so plainly and move on — a lane that has been thanked for correcting you
corrects you again.

## 13. Record the owner's answer durably, not just in a message

A ruling relayed by `SendMessage` exists only in a transcript. Twice in one
batch a decision shipped to production with **no durable provenance**: the run's
event log showed `escalation.raised` with no `escalation.answered`, and the
reasoning survived nowhere a later reader would look.

When the owner rules on an escalation:

```bash
concertino answer <TICKET> <answer-value>
```

...**and** record the reasoning where the artifact lives — a ticket comment, the
PR body — not only in the relay. Say *why*, not just *what*: the value of the
record is that whoever later observes the consequence ("the Yellow focus ring
isn't yellow") closes it as an accepted decision rather than reopening it as a
bug.

Check this at close-out. One run finished with **three escalations raised and
zero answered**.

## 14. Verify your own instruments

The tools you use to watch the fleet lie in specific, learnable ways.

- **A background watchdog can report "completed" while still running** — that
  is the wrapper shell exiting, not the `nohup`'d process. Confirm with
  `kill -0 "$(cat watchdog.pid)"`. Trusting the notification once produced five
  concurrent watchdogs with stale lane maps.
- **The agent list's status text is a frozen label, not current activity.** A
  lane can read "Commenting on HEL-1046" while working something unrelated
  hours later. **The token count is the reliable identifier** — match it against
  each lane's last reported usage before acting on a row. Getting this wrong
  means stopping the wrong lane.
- **A reused dev server may be serving another branch.** `start-servers.sh`
  reports "already healthy, reusing" without checking what that process is
  serving. Confirm with `readlink /proc/<pid>/cwd` before anything is judged
  against it — including anything you put in front of the owner.
- **Use `scripts/concertino/watchdog.sh <tasks-dir> <lanes-file>` — do not
  rebuild this from prose.** It was reconstructed from scratch at least three
  times before CON-177 shipped it as a real, tested core script; every rebuild
  reintroduced bugs the previous one had already found. It already implements
  the two-signal design (a tight fleet-wide check, default 15 min, no
  transcript anywhere written; and a much looser per-lane backstop, default
  at least 3h — one mtime is wrong, because children write their own
  transcripts and a legitimate executor can run for hours), the lockfile
  singleton (never pgrep-and-kill, which has matched and killed the wrapper
  shell instead of a prior instance), and stat-only `-L` reads (it never opens
  a transcript's content).
- **The lanes file is the watchdog's liveness input — keep it current.**
  `<lanes-file>` is a plain "`<agentId> <label> [<TICKET>]`" list you
  maintain and the script re-reads on every poll: remove a line the moment
  that lane completes or is deliberately parked, and add a line the moment a
  new lane is dispatched — the watchdog runs whenever any lane is dispatched,
  not only for multi-lane batches. Edit it atomically (write a temp file,
  then `mv` over the original) rather than truncating and rewriting in place
  — a mid-poll read of a truncated-but-not-yet-rewritten file is
  indistinguishable from "no lanes live" and will read as an unintended
  stand-down for that one poll.
  **Stop the watchdog process in the same turn you remove the last live
  lane.** The script stands down silently (exit 0, no trip) when the file is
  empty, but its own lifetime should still match the lanes' lifetime rather
  than relying on that fallback — a watchdog pointed at an empty lanes file
  for a batch that's actually still running is just as wrong as one pointed
  at finished tickets it still thinks are live.
- **Add the ticket id when you have one — it makes "forgot to remove a
  finished line" survivable.** The optional 3rd field on a lane's line names
  the Linear ticket that lane is delivering. The watchdog then checks that
  ticket's own `events.jsonl` for a terminal `run.end` and treats the lane as
  complete the moment that appears, independent of whether you ever edited
  the lanes file — this is the actual fix for the 2026-09-10 incident (a
  watchdog that tripped FLEET 15 minutes after a ticket had already merged,
  because the operator forgot to stop it and the file still named a finished
  lane). Removing the line remains the primary mechanism; the ticket id is a
  second, independent line of defense against forgetting to.

## 15. Knowing when to stop a review loop

Gate rounds that keep finding real defects are not automatically worth
continuing. One ticket ran **eight design rounds and two document
regenerations** before writing a line of implementation code, and every round
found something real — but the findings changed *kind*, and that is the signal.

Stop when **the remaining risk moves from a person to a mechanism.** Concretely,
these together are enough:

- **Substance has been independently confirmed** more than once, by a reader
  that did not write it.
- **Findings have migrated into the loop's own repairs.** When the last rounds
  find zero defects in the artifact and only defects in the edits to it, the
  loop is no longer converging on the artifact — it is orbiting. Watch the base
  rate: "my own fix introduced the next finding" reached **5 of 7**.
- **The failure mode that caused the last round is now covered by a machine**,
  not by an intention to be careful.
- **Findings changed kind**: 6, 4, 4, 4, 1 across five rounds, where the early
  rounds each found a new *class* of defect and the late ones found only
  clerical errors. Converged-on-kind is a much better stopping signal than
  "the budget ran out."

Two instruments matter more than another round:

- **When the fixer and the checker are the same context, the loop does not
  converge.** Use a cold reader that **reports and does not edit**; the fixer
  fixes; the cold reader re-reads.
- **Push the residual check into a gate that was going to run anyway** — the
  evaluator, the final gate — rather than spending a fresh round on it. No
  extra round, no lost coverage.

## 16. Know which agent owns each lane — a nudge can create a second driver

The most expensive process failure of the 2026-09-09 batch, and both halves were
silent.

### A nudge is not guaranteed to resume the agent you think it is

A lane looked stalled (idle 3h33m). It was nudged. The original orchestrator had
**never stopped** — so the lane then ran with **two orchestrators alive in the
same worktree**, each believing it owned the run. The peer merged before the
escalation asking who owned the lane was answered.

From the outside, a `SendMessage` that resumed the wrong agent is
indistinguishable from one that resumed the right one: both return
`Resuming agent …`. Elapsed transcript age is *not* evidence of a stall — a
legitimately-running child produces exactly the same silence. Before nudging:

- Establish the lane is actually stalled, not waiting on a live child. Check the
  worktree (`workflow-state.md` phase, `git log`, `git status`), and check
  whether a child process is genuinely running (elapsed vs CPU time — an
  orphaned hang shows minutes of wall clock at ~0% CPU).
- Establish the agent you are about to nudge is the one that **owns** the lane.
  Keep the dispatch agentId per lane and nudge that id, not a name or a ref.
- If two agents may be live on one lane, resolve ownership **before** either
  merges. Ask each which run it believes it owns; stop the duplicate explicitly.

Related, same family: a spawned agent inherits the **driver session's** cwd, not
its orchestrator's, and a mis-spawned agent that is redirected will then work
*invisibly to its own orchestrator*, because the reporting address is bound at
spawn time (CON-174). Your picture of which agents exist and what they are doing
can be wrong in both directions at once — invisible work you do not know about,
plus spawns you think failed.

**Driver habit that prevents the cwd half:** use `git -C <path>` for diagnostics.
Never `cd` into a lane's worktree — the session cwd is inherited by everything
you spawn afterwards.

### An orchestrator must always escalate; the driver decides

That duplicate then ran **8 executor cycles against a bound of 3, 4 final-gate
rounds against 2, 2 auditor attempts against 1, ~4.3M subagent tokens** —
**without ever raising the budget-exhaustion escalation.** Every round found a
real defect, so each extension was retroactively defensible. That is exactly why
it is easy to wave through, and why it must not be.

**Retroactively justified is not authorised.** Self-authorisation is a defect
independent of whether the extra rounds found anything, because what is lost is
not a formality — it is the only outside view of the run.

The owner's standing position, which is the rule:

> Orchestrators should always escalate and it is the responsibility of the driver
> (agent or human, though more likely agent) to determine whether another round
> or a few more rounds would lead to convergence, or if the effort is futile and
> a follow-up is warranted, or if we should just continue to the next step. [...]
> it's why I almost always approve +1 round when presented by drivers as
> recommended option, and it's why the orchestrator, plagued by
> orchestration-related context, may not be fit to spot whether another round
> should be afforded.

So: **an escalation is not a request for permission. It is the handoff of a
judgment the orchestrator is structurally unfit to make.** An orchestrator deep
in its own run is the most context-loaded and least impartial reader of its own
progress; it cannot tell converging from thrashing. Escalating is cheap and is
almost always answered "+1 round". Not escalating costs the run its only outside
view, and **nothing detects that it happened.**

### What this means for you as driver

- **Brief every lane that budget exhaustion is a mandatory escalation**, never a
  self-approval — and that surfacing a real defect plainly is *not* the same as
  lobbying for another round. One lane got this exactly right: told not to ask
  for a fifth round, it reported a genuine new defect without recommending an
  extension, which is what made the decision easy to make well.
- **You own the convergence call.** §15 is your instrument for it: are findings
  changing *kind*, or is the loop orbiting its own repairs? Recommend a specific
  option with the evidence, and say which you would pick.
- **Put it to the owner, and relay the answer as theirs, not yours.** Say
  explicitly in the message that the owner ratified it — a lane must be able to
  tell an owner ruling from a driver opinion.
- **Record the ratification durably** on the ticket (see §13), including *why*
  it qualified: an extension still finding genuinely new defects each round is
  legitimate; one justified by "I think there is more here" is not.

Four lanes the same night escalated properly and were answered within minutes.
The cost of asking is a few seconds. The cost of not asking is unbounded and
invisible.
