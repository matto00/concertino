## Context

The fleet dashboard's FAILED section renders exactly the same generic action
set as every other section. Escalated planning decisions (see proposal.md)
settle the shape: `a` (address, full write access, reuses the
executor/evaluator/skeptic loop) and `d` (done, `y`-gated, dashboard-only
bookkeeping), both bound at the fleet screen's top level conditioned on
`runs[selected].status === 'failed'`; `a` opens a new tmux window in the
run's existing worktree and updates the existing row; scope is FAILED-only.

**Revision note (post design-gate round 1):** the first draft of this design
proposed a new FAILED-local focus mode (mirroring QUEUED/QUICK START),
justified by a claim that `a`/`d` were "already claimed at the fleet screen's
top level" per a comment in `keys.js`. The skeptic gate verified that claim
against the actual code and found it false: `d` is unbound anywhere in
`keys.js` today, and `a` is bound only inside `focus === 'quickstart'`, not
unconditionally at the top level. FAILED rows, unlike QUEUED/QUICK START,
already live in the ordinary flat `runs`/`selected` index space — so this
revision drops the focus-mode approach entirely and binds `a`/`d` the same
way `t` (view-ticket) and `l` (drilldown) already do: an ordinary top-level
binding conditioned on `runs[selected]`. This is simpler, requires no new
local-cursor state, no new visual-highlight wiring, and no digit-jump
changes. See Decision 1 below.

Two mechanical facts drive most of the rest of the design:

1. `lib/ui/session.js`'s `spawn(ticket, cmd, env)` addresses tmux windows by
   ticket id and already kills any existing window under that name before
   creating the new one — so "open a new tmux window in the run's existing
   worktree" is not new plumbing, it is calling `session.spawn` again for a
   ticket that already has one (dead) window, with a different command. The
   run's identity (`.concertino/runs/<TICKET>/events.jsonl`) is untouched by
   this — new events simply append to the same log, which is what "updates
   the existing row" means concretely.
2. `sections.js`'s `buildHeadTail` is where `forceStartConfirm`/
   `clearQueueConfirm`/`quitConfirm` actually render their on-screen "are you
   sure?" banners — not just where keypresses get intercepted. `d`'s new
   `markDoneConfirm` gate needs the same treatment: threaded through
   `render.js`'s `render()` and `watch.js`'s `draw()` opts, with its own
   `buildHeadTail` branch printing the confirm text — not just a keypress
   interception, or the gate would be invisible on screen (skeptic gate round
   1, finding 3).

## Goals / Non-Goals

**Goals:**
- A FAILED row gets `a`/`d`, bound at the top level conditioned on
  `runs[selected].status === 'failed'`, discoverable via the existing
  footer-hint convention (shown only when a FAILED row is selected).
- `a` launches `/concertino-address-failure <TICKET>` in a new tmux window in
  the run's existing (or idempotently recreated) worktree, with write access,
  reusing the existing executor/evaluator/skeptic/delivery loop via
  `concertino-orchestrator`'s own resume machinery — not a new parallel role.
- `d` is a `y`-gated, dashboard-only bucket override: FAILED → DONE, without
  rewriting or reinterpreting the run's actual telemetry history.
- While `a`'s redrive is in flight, the row visibly reads as active again
  (not stuck showing FAILED under a stale terminal status).
- NEEDS YOU / RUNNING / DONE are audited (see "Per-pane audit" below) — no
  new actions added to any of them in this change.

**Non-Goals:**
- Codex/OpenCode support for `/concertino-address-failure` — claude-code only
  for this change (see Decision 6), consistent with existing claude-code-only
  precedent elsewhere in the dashboard (session naming, agent-merge).
- A ticket-provider status write-back from `d` — explicitly out of scope
  (escalated decision 5).
- Any new action on NEEDS YOU / RUNNING / DONE (escalated decision 6).
- Reversing a `d` override, or a generic "undo" affordance.
- A read-only "just audit, don't fix" mode for `a` (escalated decision 2
  answer rules this out).

## Decisions

### Decision 1 — `a`/`d` bind at the top level, conditioned on `runs[selected].status === 'failed'` (no new focus mode)

`lib/ui/screens/fleet/keys.js`'s `handleKey`, in its ordinary
runs-selection path (after the `focus === 'queue'`/`focus === 'quickstart'`
blocks, alongside the existing `t`/`l` bindings), gains:

```js
if (key === 'a' && focus === 'runs' && runs[selected] && runs[selected].status === 'failed') {
  return { type: 'address-failure', ticket: runs[selected].ticket };
}
if (key === 'd' && focus === 'runs' && runs[selected] && runs[selected].status === 'failed') {
  return { type: 'open-mark-done-confirm', ticket: runs[selected].ticket };
}
```

**Design-gate round 2 correction:** the round-1 revision above was itself
found incomplete — its prose described this code as living "in the ordinary
`focus === 'runs'` path", implying a guard that the code as drafted did not
actually have. `handleKey` has no `if (focus === 'runs') { ... }` wrapper
anywhere; the region after the `queue`/`quickstart` focus blocks is reached
for ANY `focus` value once neither of those two blocks claims the key.
Unlike `t` (safe because it is separately, explicitly re-bound *inside* both
focus blocks — lines 191/224 — so it always resolves against whatever
section is actually in view) and `l`/`\r`/`n`/`N` (safe because both focus
blocks explicitly suppress them), the new `a`/`d` bindings had no such
protection: entering QUEUED/QUICK START focus never touches `selected`, so a
FAILED row could sit selected-but-off-screen while the operator is looking at
a completely different section, and `a`/`d` would still silently fire against
it. This reproduces the exact class of bug `docs/dashboard.md`'s drill-down
precedent already guards against (`k`/`r` "deliberately unreachable while
EVIDENCE holds focus"). The explicit `focus === 'runs'` condition above closes
this — `a`/`d` now resolve only when the plain run-selection view is what's
actually on screen, exactly like the fix chosen for this finding (rather than
alternative (b), suppressing `a`/`d` inside both focus blocks, which would
need the same fix applied twice instead of once).

Both handlers resolve `ticket` directly off `runs[selected]` at keypress
time, the same way `t`/`l` already do — no controller-side re-resolution
against a stale index is needed, because (unlike QUICK START's eligible-list,
which is `opts`-only and never part of `state`) `runs` is already the live
state `handleKey` receives every call.

**Why not a focus mode (the design's original approach, before design-gate
review):** the original draft proposed a `focus === 'failed'` mode mirroring
QUEUED/QUICK START, on the premise that `a`/`d` were already claimed at the
fleet screen's top level per a stale comment in `keys.js`. That premise does
not hold: `d` is unbound anywhere in `keys.js` today, and `a` is bound only
inside `focus === 'quickstart'`, not unconditionally. QUEUED/QUICK START need
their own focus modes specifically because their items are NOT in the
`runs`/`selected` index space — j/k moving `selected` can never point at a
queued/quick-start entry, so a separate cursor is the only way to select one
at all. FAILED rows have no such problem: they are ordinary entries in
`runs`, already reachable via `selected`. Introducing a focus mode here would
add a new local-cursor field, new visual-highlight wiring in
`grid.js`/`rows.js` (currently absent from this change, and QUEUED/QUICK
START's only precedent for how to add it), and a new digit-jump target — all
to solve a collision that does not exist.

### Decision 2 — `d`: dashboard-only override, new `run.override` event + a new `deriveStatus` precedence branch

`d` (behind a `y`-confirm, mirroring `forceStartConfirm`/`clearQueueConfirm`'s
existing open/cancel/confirm trio shape — `S.markDoneConfirm = { ticket }` on
open, cleared on cancel or confirm) writes a new event directly to
`.concertino/runs/<TICKET>/events.jsonl`, in-process, from the dashboard —
the exact precedent `lib/ui/session.js`'s `writeSpawnEvent` (`run.spawn`,
`role: 'dashboard'`) already establishes for a TUI action recording a fact
about itself without going through `emit-event.sh`:

**The confirm banner must actually render, not just intercept keys.**
`forceStartConfirm`/`clearQueueConfirm`/`quitConfirm` are each threaded
through two places, not one: `fleet.js`'s `handleKey` (intercepting
subsequent keypresses — `y` confirms, anything else cancels) AND
`sections.js`'s `buildHeadTail` (printing the actual "are you sure?" text),
reached via `render.js`'s `render()` and `watch.js`'s `draw()` passing
`state.forceStartConfirm`/`state.clearQueueConfirm` through as render opts.
`markDoneConfirm` needs both: a `buildHeadTail` branch
(`else if (markDoneConfirm) { ... }`, alongside the existing three) printing
which ticket is about to be marked done, and the same `render.js`/`watch.js`
opts-threading `forceStartConfirm` already gets. `controllers/fleet.js`'s
`scrollToShow` also needs `markDoneConfirm` added to its own height-estimate
`winOpts` object, mirroring the existing `forceStartConfirm`/
`clearQueueConfirm` entries there (that object is scroll-math-only and
separate from the real render opts above — both need the new field, for
different reasons).

```json
{"t": <ms>, "kind": "run.override", "project": "...", "ticket": "CON-1",
 "role": "dashboard", "status": "done"}
```

`lib/ui/reducer.js`:
- `emptyRun` gains `override: null`.
- `applyEvent`'s `case 'run.override':` sets `run.override = { status: ev.status, t: ev.t }`.
- `deriveStatus` gets a new FIRST branch (highest precedence — an explicit
  human decision that "this is done" wins over every derived signal,
  including a live escalation on a since-fully-dead run): `if (run.override) return run.override.status;`.
  Placed ahead of the existing live-escalation branch too — deliberately: by
  construction `d` is only reachable from a FAILED row, and a FAILED row can
  never simultaneously be `needs-you` (mutually exclusive statuses per
  `STATUS_ORDER`), so this ordering is never actually competing with a live
  escalation in practice; it is placed first purely so the rule reads as
  unconditional rather than implicitly relying on that mutual exclusion.

This is new behavior gated behind a new event kind — no existing spec
documents `run.override`, so it is captured as a new requirement in this
change's own new `fleet-failed-remediation` spec rather than a delta to an
existing capability.

**Alternative considered:** don't add a new event kind — just filter FAILED
rows out of the FAILED bucket in `sections.js`/`bucketRuns` by ticket id, using
a purely dashboard-in-memory (not persisted) set. Rejected: this would not
survive a dashboard restart (`bucketRuns` re-derives from `reduce()`'s output
fresh every poll, sourced from the on-disk log — nothing dashboard-in-memory
survives a restart today, and this override should), and the ticket's own
description explicitly frames `d` as changing "the bucket" durably, not as a
transient UI filter.

### Decision 3 — `a`: spawn into the existing worktree; the retry-visibility gap

`a` calls `ctx.launcher`'s existing spawn path (`session.spawn(ticket, cmd,
env)` under the hood) with a new command built the same way
`harnessCmd.defaultLaunchCommand` builds the ordinary one, substituting
`/concertino-address-failure` for `/concertino-deliver`. Scoped to
claude-code only (Non-Goals): if the run's own recorded `harness` (already
tracked on `run.harness`) is not `claude-code`, `a` is a no-op that sets an
inline notice ("`/concertino-address-failure` isn't available for
<harness> yet") — the same "explain why rather than doing nothing" discipline
`N`/launch-pad-disabled and the local-provider ticket-draft gate already
follow, not a silent swallow.

Because `session.spawn` addresses windows by ticket id and already kills any
existing (dead) window under that name (see Context above), no new spawn
plumbing is needed — this is an ordinary `commandFor`-style launch, just with
a different slash command and no `n`-prompt/queue involvement.

**The retry-visibility gap.** `reducer.js`'s `deriveStatus` checks
`run.endStatus` before window liveness:
```js
if (run.endStatus) return run.endStatus === 'delivered' ? 'done' : 'failed';
...
if (run.window && run.window.alive) return 'running';
```
A FAILED run, by definition, already has `run.endStatus` set (to something
other than `'delivered'`) — so once `a` respawns the window and the new
`/concertino-address-failure` session starts appending fresh telemetry to the
same log, the row would keep reading FAILED (the stale, already-set
`endStatus`) instead of RUNNING, until (if ever) a new `run.end` lands. This
is a real gap, not cosmetic: an operator watching the fleet has no way to
tell "address-failure is working on this" from "address-failure hasn't
started" or "it silently died again."

Fix: `deriveStatus` gets a refinement to the existing `endStatus` branch,
reusing two fields already tracked (`spawnedAt`, `endedAt`) rather than
adding new state:
```js
if (run.endStatus) {
  if (run.window && run.window.alive && run.spawnedAt != null
      && (run.endedAt == null || run.spawnedAt > run.endedAt)) {
    return 'running';
  }
  return run.endStatus === 'delivered' ? 'done' : 'failed';
}
```
`run.spawnedAt` is already set by `run.spawn` (`writeSpawnEvent`, fired by
every `session.spawn` call, including the one `a` makes) — so this requires
no new event kind, only a reducer change. Once the redrive concludes,
`cleanup.sh`/`setup-worktree.sh`'s own `run.end`/`run.start` emissions
naturally overwrite `endStatus`/`endedAt` again (the reducer's
chronological-fold already lets the LAST `run.end` win — see
`applyEvent`'s existing `case 'run.end'`), so the row settles back to
FAILED or flips to DONE exactly as it would for any other run, with no
further special-casing. Restart (`r`, drilldown-only) never hits this gap
today because it is gated on `isLive(run)` and so never touches an
already-ended run in the first place; `a` is the first affordance that
deliberately re-spawns a ticket that already has a terminal `endStatus`.

This is new behavior with no existing spec — captured as a requirement in
the new `fleet-failed-remediation` spec alongside Decision 2's `run.override`
requirement.

### Decision 4 — `/concertino-address-failure`: audit, then hand off to `concertino-orchestrator`'s own resume machinery

No such command exists anywhere in the repo today. Rather than invent a
second loop-driver, `/concertino-address-failure` is a thin claude-code
command (same shape as `adapters/claude-code/command.md`) whose entire job is
to spawn `concertino-orchestrator` with a new boolean input,
`ADDRESS_FAILURE=true`, alongside the usual `TICKET_ID`. Everything else —
locating/recreating the worktree, resuming the executor/evaluator/skeptic
loop, driving Delivery/Cleanup — is the orchestrator's own existing resume
machinery (`core/roles/orchestrator.md` already documents "read
workflow-state.md, resume from the recorded phase" for a compacted/resumed
session; this is the same machinery, entered from a new trigger instead of a
mid-session compaction) plus one small addition:

**New "Address-Failure entry point" procedure**, added to
`core/roles/orchestrator.md`, run instead of ordinary Setup when
`ADDRESS_FAILURE=true`:
1. **Audit.** Read `.concertino/runs/<TICKET_ID>/events.jsonl` in full:
   the `run.start` event (branch name, prior speed/harness), every
   `phase.enter`/`gate.result`/`verdict`/`escalation.*` event (the timeline),
   and the most recent evaluator/skeptic report path referenced by an
   `evidence` event, if any. This produces the same "what actually happened"
   picture the drill-down's TIMELINE/GATES/EVIDENCE panels already render
   from this exact log — reusing it, not re-deriving it differently.
2. **Restore the worktree, idempotently.** Call
   `scripts/concertino/setup-worktree.sh` with the branch name recorded in
   step 1's `run.start` event — idempotent by design ("re-running for an
   existing worktree reuses it"), so this is safe whether the old worktree
   is still on disk (the common case — a FAILED run never reaches Phase 4,
   so `cleanup.sh` never removed it) or was manually deleted (recreates it
   fresh, checking out the same branch — any committed executor work
   survives on the branch regardless of worktree lifecycle).
3. **Reconstruct planning state if needed.** If
   `WORKTREE_PATH/openspec/changes/<CHANGE_NAME>/workflow-state.md` is
   present (the common case), read it and resume from its recorded `PHASE`
   exactly as an ordinary mid-session resume already does. If it is missing
   (the worktree was recreated AND the change was never committed to the
   branch), reconstruct `ticket.md`/`proposal.md`/`design.md`/`tasks.md` from
   `.concertino/runs/<TICKET_ID>/evidence/` (Phase 1's own
   `persist-evidence.sh` output, durable in the main checkout independent of
   the worktree) and resume from Planning. If evidence is ALSO missing
   (nothing ever got far enough to persist anything), there is nothing to
   remediate — fall back to an ordinary fresh delivery run for this ticket
   (equivalent to the `n` prompt), stated plainly in the audit summary rather
   than silently pretending to resume something that never existed.
4. **Persist the audit as evidence**, via the existing
   `persist-evidence.sh`, so it shows up in the drill-down's EVIDENCE panel
   like every other artifact (`.concertino/runs/<TICKET_ID>/evidence/
   address-failure-audit-N.md`).
5. **Resume.** Continue the ordinary Execution → Evaluation → final gate →
   Delivery → Cleanup loop from the resolved phase, passing the audit's
   findings to the first resumed executor call the same way a normal FAIL
   cycle passes `EVALUATION_REPORT_PATH` — this is the literal "reuses the
   existing executor/evaluator/skeptic loop" the escalated decision calls
   for, not a parallel implementation of it.

`adapters/claude-code/` gets a new `address-failure-command.md` (parallel to
`command.md`) and `lib/cli/emit.js`'s `emitClaude` gets one more `write(...)`
call alongside the existing `concertino-deliver.md` one, writing
`.claude/commands/concertino-address-failure.md`. No new agent/role file —
`concertino-orchestrator`'s existing agent definition already covers this
(it is the same agent, given a different starting instruction).

**Alternatives considered:**
- A wholly new `concertino-address-failure` role/agent, structurally separate
  from the orchestrator. Rejected outright by the escalated decision itself
  ("reuses the existing executor/evaluator/skeptic loop... not a new,
  lighter-weight role").
- Re-deriving the worktree path from `.concertino/worktrees/**/<TICKET_ID>`
  glob instead of reading it from `run.start`. Rejected: the event log
  already records it authoritatively (`run.start`'s `worktree`/`branch`
  fields), so a glob would be a second, weaker source of truth for
  information already on hand.

### Decision 5 (per escalation) — `d` stays dashboard-only bookkeeping

No ticket-provider write-back. `run.override`'s event carries no obligation
beyond the reducer/bucket change in Decision 2 — explicitly not wired to
`core/scripts/set-ticket-state.sh` or any Linear/local-provider mutation.

### Decision 6 (per escalation) — per-pane audit: FAILED-only, rest documented

**NEEDS YOU** — already routes to the escalation screen on `↵`; the answer
keys ARE its section-specific action set already (`docs/dashboard.md`'s "On
the escalation screen" row). No changes.

**RUNNING** — a live run already has `k` kill / `r` restart in the
drill-down (gated on `isLive`), reachable via `l`. No FAILED-style top-level
action is missing at the fleet-row level; drilling in is the existing,
sufficient path. No changes.

**DONE** — no reopen/requeue action exists today. Considered and explicitly
deferred: a DONE row's underlying ticket is normally already merged/closed
(the delivered case) or was `d`-overridden by this very change (the
FAILED-via-override case) — "reopen" would mean materially different things
for those two cases (re-running a delivery vs. reverting a bucket override),
which is exactly the kind of judgment call this ticket's own decision 6
answer says to leave out of scope rather than decide silently inside an
unrelated implementation pass. No changes; noted here so a future ticket
doesn't have to re-discover that DONE was looked at and skipped on purpose.

### Decision 7 (per escalation) — design-ticket-type idea filed standalone

Filed as CON-100, linked back to this ticket. No further action here.

## Risks / Trade-offs

- **[Risk] A FAILED run whose worktree was manually deleted AND whose branch
  was also deleted (e.g. a stale branch-cleanup job) leaves `a` with nothing
  to resume and no evidence to reconstruct from.** → Mitigation: step 3's
  final fallback (fresh delivery run, stated plainly) already covers "nothing
  to remediate"; this is the same fallback, just reached via
  `setup-worktree.sh` failing outright rather than finding an empty
  worktree. The Address-Failure entry point treats a `setup-worktree.sh`
  FAIL here as a `BLOCKER`, surfaced to the human exactly like any other
  environmental failure — never silently downgraded to "just start fresh"
  without saying so, since that would discard whatever the original attempt
  actually got right.
- **[Risk] The retry-visibility `deriveStatus` refinement (Decision 3) could,
  in principle, mask a run that respawned and then immediately died again
  (a very short-lived window).** → Mitigation: `run.window.alive` is
  re-sampled every poll from tmux directly — the moment the window actually
  dies, the `run.window.alive` condition in the new branch goes false and the
  row falls through to the ordinary `endStatus` (or, if no new `run.end`
  ever landed, the pre-existing `if (run.window && !run.window.alive) return
  'failed';` branch) — there is no persistent "stuck running" state possible,
  only ever a reflection of tmux's own current liveness bit, exactly like
  every other status derivation in this file.
- **[Risk] Two operators press `a` on the same FAILED row from two dashboard
  instances.** → Mitigation: `session.spawn`'s existing kill-then-create
  behavior already makes this safe in the same way any double-restart is
  today — the second spawn simply kills and replaces the first window; no
  new race is introduced by this change.
- **[Trade-off] Scoping `/concertino-address-failure` to claude-code only**
  means a codex/opencode FAILED run's `a` key is bound but inert (an inline
  notice). Accepted per Non-Goals — matches existing per-feature harness
  scoping precedent in this codebase (session naming, agent-merge) rather
  than blocking this change on multi-harness prompt-file work.
