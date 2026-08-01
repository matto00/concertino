## Context

CON-16's orchestrator ran Phase 4 to completion (worktree removed via
`cleanup.sh --phase4`, ticket set to Done, closing comment posted, hygiene
check reported) and then, in plain chat with zero telemetry, asked a
follow-up question ("want a follow-up ticket for the sync drift?"). The
session then idled forever once answered. Nothing in `core/roles/
orchestrator.md` currently tells the orchestrator what "done" means for
*itself* (as opposed to the ticket/run), or what to do with a leftover
observation once it gets there.

Investigating how `run.end` interacts with the escalation telemetry surfaced
a second, deeper problem that a prose-only fix cannot close: `run.end` is
emitted by `core/scripts/cleanup.sh` itself, at the *start* of Phase 4 (its
last line, right after the worktree is removed and local `<base>` is
fast-forwarded) — not at the end of the orchestrator's Phase 4 tail (ticket
Done + closing comment + hygiene check), which runs afterward, in the same
turn. `lib/ui/reducer.js`'s `deriveStatus` checks `run.endStatus` FIRST,
unconditionally returning `done`/`failed` the instant `run.end` has been
logged, and `escalationStale` is computed as `!!run.escalation &&
(run.endStatus != null || window dead)` — i.e. it treats "`run.end` has
fired" as equivalent to "nobody is here to answer this," even when the
window is provably still alive. So if the orchestrator raised its follow-up
suggestion as a proper `escalation.raised` event *today*, exactly where Phase
4's tail already runs (after `cleanup.sh`, which is where `run.end` fires),
the dashboard would immediately mark it stale and keep showing the row under
`DONE`, never `NEEDS YOU`. The prose half of this ticket's fix would be
inert without also correcting this.

## Goals / Non-Goals

**Goals:**
- Define, precisely, the point at which the orchestrator's own Phase 4 work
  is "genuinely complete," narrow enough that it cannot be read as license to
  stop early during Planning/Execution/Evaluation/Delivery (CON-15's hazard,
  mirrored).
- Once genuinely complete, route any further suggestion through the existing
  escalation mechanism instead of bare chat, and make that escalation
  actually visible as `NEEDS YOU` on the dashboard rather than silently
  stale.
- Guarantee the orchestrator's turn actually ends afterward — no lingering
  idle prompt, no second unstructured question.

**Non-Goals:**
- Changing when `run.end` is emitted, or moving it to the end of Phase 4's
  tail. `cleanup.sh` emitting it right after the worktree/fast-forward work
  is deliberate (CON-25/CON-34): it is the one synchronous point the
  procedure script *knows* the merge happened, and `docs/dashboard.md`
  already documents "a run that has emitted `run.end` but is still alive
  (finishing up Phase 4's tail)" as a normal, expected state. This design
  works *with* that fact, not against it.
- A new escalation "kind" in `gather-escalation-context.sh`. A post-cleanup
  suggestion doesn't fit any of the five existing kinds (dependency,
  api-change, budget, blocker, contradiction) — `core/roles/orchestrator.md`
  already documents the "not every escalation fits one of the five kinds...
  raise it anyway, without `context=`" fallback for exactly this shape of
  case.
- A new circuit breaker/counter for this escalation. It is one-shot by
  construction (raised at most once per run, only after Phase 4's tail is
  otherwise complete) and does not re-enter any phase or loop, so it needs no
  bound beyond the existing per-call `--await` timeout.
- Any change to `window-reaping`'s own reap condition (`endStatus != null &&
  window dead`) — reaping already keys on window liveness, independent of
  `run.end`, and is unaffected by this design.

## Decisions

### Decision 1: "Genuinely complete" = all three Phase 4 steps done, not `run.end` alone

The orchestrator's own work is genuinely complete only once **all** of:
1. `cleanup.sh --phase4` has run and printed `READY cleaned worktree=...`
   (worktree removed, `run.end` emitted as a side effect of that script),
2. the ticket has been set to Done and a closing comment posted, and
3. the hygiene check (step 3 of Phase 4) has been run and reported.

This is deliberately the existing end of Phase 4 as already written in
`core/roles/orchestrator.md` — no new phase, no new gate. The only change is
naming this point explicitly as the boundary past which the "never linger"
rule applies, so it cannot be misread as applying to, say, the moment
`cleanup.sh` prints `READY` (step 1) — that would reopen exactly the "ends
too early" hazard CON-15 closed, since steps 2–3 are real, required work.

**Alternative considered:** tie "genuinely complete" to `run.end` itself,
since that's the dashboard's own terminal signal. Rejected: `run.end` fires
before steps 2–3 by construction (Decision above, Non-Goals), so treating it
as the completion boundary would tell the orchestrator to stop *before*
updating the ticket and running hygiene — silently reintroducing a different
instance of the exact bug this ticket exists to fix (real work left undone
because the orchestrator considered itself finished).

### Decision 2: The follow-up suggestion is raised through the standard `--await` escalation, once, as the last thing before ending the turn

If and only if the orchestrator has an observation to raise once "genuinely
complete" (Decision 1) — e.g. "should I file a follow-up ticket for X?" —
it raises it with the same `emit-event.sh escalation --await` call already
documented in "How to raise one," using generic `question=`/`options=`
(no `gather-escalation-context.sh` kind applies — Non-Goals). This is
capped at exactly one such call per run: whatever the outcome (answered,
timed out and answered via chat fallback, or timed out and left
unanswered), the orchestrator does not raise a second one — there is no
further phase for a second suggestion to be about.

**Alternative considered:** skip escalation and just always ask in chat,
relying on a human to notice. Rejected — this is the literal CON-16 bug
being fixed.

**Alternative considered:** never allow any post-cleanup suggestion at all
(hard-stop with no exception). Rejected by the ticket's own proposed change
2, which explicitly asks for the *suggestion* to survive, just structured —
losing legitimate follow-up observations (like CON-16's sync-drift ticket,
which became CON-45) is a real cost the ticket does not ask for.

### Decision 3: Fix `deriveStatus`/`escalationStale` so a live post-`run.end` escalation shows as `NEEDS YOU`, not stale `DONE`

`lib/ui/reducer.js` changes so that an escalation raised while the run's
tmux window is still alive is never considered stale merely because
`run.end` already fired, and such a run's `status` is `needs-you` (not
`done`/`failed`) for as long as that holds:

- `escalationStale` becomes: stale iff the window is confirmed **not**
  alive (`run.window && !run.window.alive`) — no longer additionally forced
  stale by `run.endStatus != null` on its own. A run with no window data at
  all (`run.window` absent) is still treated as stale, preserving today's
  conservative default for a log with no matching tmux entry.
- `deriveStatus` checks for a **live** escalation (`run.escalation` present
  and the window confirmed alive) before the `run.endStatus` short-circuit,
  so it returns `needs-you` even after `run.end`, for as long as the window
  stays alive. Once the window dies (answered and the orchestrator exited,
  or timed out and the process ended some other way), the existing
  `endStatus`/window-dead branches take back over unchanged, and the
  now-stale escalation stops forcing `needs-you`.

This is additive/backward-compatible: every run that never raises an
escalation after `run.end` (the overwhelming majority, and every run
predating this feature) is completely unaffected — the new branches simply
never fire for it. `computeLiveEscalations` (`lib/ui/watch.js`, backing the
cross-screen banner) and the fleet screen's Enter-key routing already key
off `escalation && !escalationStale` directly, independent of `status` —
those needed no change; only the two `reducer.js` fields feeding them did.

**Alternative considered:** leave `reducer.js` untouched and rely solely on
the cross-screen banner (`computeLiveEscalations`) for visibility, since it
already filters on `escalation && !escalationStale` regardless of `status`.
Rejected on its own: the banner would still show the escalation (once
`escalationStale` is fixed — it has the same dependency), but the fleet's
own pinned `NEEDS YOU` section (`bucketRuns`, keyed on `r.status ===
'needs-you'`) would keep silently filing the row under `DONE` instead,
which is precisely the "falsely-idle DONE row" the ticket calls out by name.
Both call sites read from the same two `reducer.js` fields, so both needed
the fix, not just one.

## Risks / Trade-offs

- **[Risk]** Changing `deriveStatus`'s precedence touches a function several
  screens depend on. → **Mitigation**: the new branch only fires when
  `run.escalation` is present AND the window is confirmed alive — a
  narrow, additive condition. Existing `test/reducer.test.js` cases (a
  stale escalation with no window data, a dead window holding an
  escalation, a plain delivered run) are re-verified unchanged by tracing
  them against the new logic in this design; new cases cover the
  previously-impossible-to-express "live escalation after `run.end`" state.
- **[Risk]** An LLM cannot be made to literally terminate a process; "end
  your turn" is a behavioral instruction, not an enforceable mechanism.
  → **Mitigation**: match CON-15's own precedent (also prose-only, also
  unenforceable at the code level) — state the rule precisely, explain why,
  and give it a single well-defined trigger point (Decision 1) rather than
  leaving "are we done yet" to per-run judgment.
- **[Trade-off]** The one-shot escalation can still fall back to an
  unbounded bare-chat wait if `--await` times out (today's universal
  fallback for every escalation kind). This is not a new hazard specific to
  this ticket — it's the existing, project-wide `--await` timeout fallback
  behavior (CON-47) — but it is worth naming: even after this change, a
  human who walks away mid-timeout will still find the session waiting in
  chat, just now preceded by a durable `escalation.raised`/`escalation.
  timeout` event trail instead of no telemetry at all. This is progress, not
  a complete elimination of "an agent can end up waiting a while for a
  human," which no synchronous chat interface can fully eliminate.

## Migration Plan

No data migration. `lib/ui/reducer.js`'s changed fields are pure derived
state recomputed from the event log on every poll — no persisted schema
changes, no changes to `events.jsonl`'s shape. Existing run logs (with or
without a trailing bare-chat question, which by definition carries no
`escalation.raised` event and so is unaffected either way) render exactly as
before.

## Open Questions

None outstanding — the scope-note dependency on the `--await` timeout bug
(CON-47) has already landed (`daeaf0c CON-47 Escalation --await reliability:
source .concertino.env + a trust off-ramp`), so this change is not blocked.
