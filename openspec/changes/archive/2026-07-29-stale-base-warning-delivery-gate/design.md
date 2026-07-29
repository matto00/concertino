## Context

`assert-phase.sh delivery` already checks two things before the orchestrator opens a PR (Phase 3,
step 3): the branch is pushed to `origin`, and the worktree has no uncommitted changes. Both are
pass/fail — a failure there means Phase 3 must not proceed. This ticket adds a third check that is
deliberately **not** pass/fail: whether the fetched remote base has moved since the branch's common
ancestor with it. `cleanup.sh --phase4`'s fast-forward step and `concertino doctor`'s
local-base-behind-remote check (`bin/concertino`'s `checkBaseBranch`) already solve an adjacent
problem — local `<base>` drifting behind its own remote — using the same "fetch, compare, best-effort"
shape this reuses.

## Goals / Non-Goals

**Goals:**
- At the delivery gate, detect when the fetched remote base carries commits the run's branch's base
  doesn't, and name how many / which commits.
- Never change the gate's pass/fail outcome or exit code on account of this check.
- Produce no output at all when the base is current — silence is the expected common case.
- Degrade silently (no warning, no error) on any environmental failure (offline, unresolvable ref) —
  this check must never be why the delivery gate itself fails or hangs.

**Non-Goals:**
- Rendering the warning in the PR body, the dashboard, or anywhere beyond the gate's own stderr
  output and a telemetry event. The gate's output already reaches the orchestrator (it runs the
  command directly and reads the result before deciding whether to proceed), so that's sufficient
  surfacing for this ticket; richer rendering (PR body, dashboard tile) is a natural follow-up but
  adds scope (orchestrator-role changes, dashboard reducer/screen changes) this ticket doesn't need
  to take on to satisfy its acceptance criteria.
- Acting on the divergence (rebasing, fast-forwarding the branch, blocking delivery). That's
  `cleanup.sh --phase4`'s job for local `<base>` post-merge, not this gate's — see the proposal's
  "Why" for the deliberate asymmetry (Phase 4 acts, this only informs).
- Recording the setup-time base commit anywhere new (e.g. `workflow-state.md`). `merge-base(HEAD,
  fetched remote tip)` recovers the same information without a new persisted field — see Decision 1.

## Decisions

### Decision 1: derive "the base at setup time" from `merge-base`, not a stored SHA

`setup-worktree.sh` cuts each new branch from the fetched remote base at creation time and never
merges/rebases it afterward (by convention across the whole workflow — nothing in Planning,
Execution, or Evaluation touches `<base>`). That means `git merge-base HEAD <fetched-remote-tip>`
recovers exactly the commit the branch was cut from, without needing `setup-worktree.sh` or
`workflow-state.md` to start persisting a base SHA nothing else in the workflow currently reads.
Alternative considered: have `setup-worktree.sh` write the base SHA it branched from into
`workflow-state.md`, and have the delivery gate read it back. Rejected — it's a new persisted field,
a new coupling between two scripts that don't otherwise share state, and it buys nothing
`merge-base` doesn't already give for free under the workflow's actual (never-rebase) usage pattern.

### Decision 2: warn via stderr + telemetry, not a new exit code or a stdout contract change

`assert-phase.sh`'s stdout contract is exactly one of `PASS <phase>` (success) or nothing (failure,
where the reasons went to stderr via `fail()` and the script exits 1). Introducing a third stdout
shape for "passed, but look at this" would be a bigger, riskier change to a contract the orchestrator
already parses verbatim (`Parse its ... lines`, per the orchestrator role for `setup-worktree.sh`,
and a literal `PASS`/`FAIL` string match for `assert-phase.sh`). Instead this reuses the existing
`WARN`-style informational line already established by `cleanup.sh`'s `note:` messages: printed to
stderr, additive, never parsed as part of the pass/fail contract. The Bash tool (or equivalent) the
orchestrator uses to invoke the gate surfaces stdout and stderr together, so the line still reaches
whoever is reading that call's output.
Alternative considered: prepend `WARN` to the `PASS delivery` stdout line itself (e.g.
`PASS delivery (stale base: ...)`). Rejected — any consumer doing an exact `"PASS $PHASE"` string
match (the test suite already does this — see `test/scripts/assert-phase.test.sh`'s
`check "stdout is PASS setup" "$OUT" "PASS setup"`) would break, and the ticket doesn't ask for a
stdout-contract change to deliver this.

### Decision 3: telemetry event kind `gate.warning`, not an extension of `gate.result`

`gate.result` (tier-2, `TIER2_KINDS` in `lib/ui/reducer.js`) represents the outcome of a whole gate
run — the dashboard's gate list keys off `ev.gate` and replaces-or-appends a single row per gate
name. Piggybacking the stale-base fact onto that event would either overload its `status` field
(which is `pass`/`fail`, not `pass-with-warning`) or require a new field the dashboard doesn't yet
render — both are dashboard-reducer scope this ticket doesn't need. A separate `gate.warning` event
(`ticket`, `gate=phase:delivery`, `behind=<N>`, `base=<branch>`, `remote=<remote>`,
`commits=<short-sha,short-sha,...>`) keeps the deterministic pass/fail signal
(`gate.result`) exactly as it is today, and is additive: an unrecognized kind is safely ignored by
`reduce()`'s `default: break` today, and is available for a future ticket to wire into the dashboard
without this change needing to guess at that design.
Alternative considered: no telemetry at all, stderr only. Rejected — the ticket explicitly asks to
"consider whether the warning belongs on ... the run's telemetry", and emitting a structured event
costs one more best-effort `emit-event.sh` call (never fails the gate — `emit-event.sh` already
always exits 0 in normal mode) in exchange for making a future dashboard/PR-body consumer possible
without touching the gate script again.

### Decision 4: commit list capped at 5, with a "+N more" suffix

`emit-event.sh` caps a single event line at `MAX_LINE=4000` bytes and truncates the first field that
overflows it silently. A branch that's hundreds of commits behind (a long-idle run, or a big sibling
merge) could otherwise blow that budget on the `commits=` field alone. Both the stderr line and the
telemetry `commits=` field list at most the 5 most recent commits (short SHA + first line of
subject, `git log --oneline -5`), with the total count (`behind=<N>`) always present in full and a
literal `(+N more)` suffix appended when `N > 5`.

## Risks / Trade-offs

- **[Risk] A branch that has legitimately merged `<base>` into itself mid-run** (uncommon in this
  workflow, but not forbidden) would show `merge-base(HEAD, remote tip) == remote tip`, i.e. no
  warning, even though the merge happened after several sibling merges landed — this undercounts in
  that specific case. → Acceptable: it's a "no false warning" bias (never warns when the branch
  already has everything), and reaches the *correct* silent-when-current behavior the AC explicitly
  requires; a branch that has merged `<base>` is by definition not "behind" it in the sense this
  check cares about.
- **[Risk] Fetching on every delivery-gate call adds a network round-trip.** → Same cost
  `cleanup.sh --phase4` and `doctor` already pay for the same class of check; best-effort with a
  short-circuit on fetch failure keeps it from ever blocking the gate itself (Goal: never hang).
- **[Trade-off] Warning is not yet visible in the PR body or dashboard.** → Deliberate (Non-Goals);
  the gate's own output is a real, already-read surface (the orchestrator invokes this command
  directly), and richer rendering is left for a follow-up rather than growing this ticket's surface
  area into the orchestrator role and the dashboard reducer/screens.
