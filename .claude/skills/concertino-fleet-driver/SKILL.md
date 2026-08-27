---
name: concertino-fleet-driver
description: Drive multiple concertino orchestrator runs concurrently from directly within a Claude Code session, without the concertino watch TUI. Use when a user asks to work a batch of tickets, run an epic end-to-end, or otherwise wants several concertino deliveries coordinated in parallel by the current session rather than one at a time or via the dashboard.
license: MIT
metadata:
  author: concertino
  version: "1.0"
---

Coordinate several concertino ticket-delivery runs at once as their **driver** —
the layer above the orchestrator that `concertino watch`'s TUI (fleet view,
launch pad, `NEEDS YOU` queue) plays for a human operator, replayed here as
Claude Code session discipline instead: `Agent` calls instead of tmux panes,
`SendMessage` instead of approve/deny keys, `gh pr checks`/`gh pr merge`
yourself instead of a merge-confirmation screen.

Every rule below exists because skipping it caused a real, specific incident in
production driving (helio, 2026-08-16/17 — one session, seven tickets, three
near-misses). This is not theoretical hardening; it is what actually broke.

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
