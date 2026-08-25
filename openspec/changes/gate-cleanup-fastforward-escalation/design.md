## Context

`core/scripts/cleanup.sh --phase4`'s fast-forward step (`attempt_fast_forward` + the escalation
block immediately after it, around line 336-346) raises a blocking `emit-event.sh escalation
--await` whenever the local base branch can't be fast-forwarded cleanly. CON-126 established the
pattern for gating this kind of blocking call on `tui-attached.sh`, but only applied it inside
`core/roles/orchestrator.md`'s prose procedure and `adapters/claude-code/command.md` — not inside
any script. `cleanup.sh` is the one place in `core/scripts/` that itself calls
`--await`/`--raise-only`/`--wait-only` directly — task 1.1 below produces the two-direction grep
audit that establishes this as fact (not yet performed as of Planning); a preliminary check run
during Planning found no other executable call site, but that preliminary check is not itself the
required deliverable — see task 1.1.

Unlike the orchestrator, `cleanup.sh` is a synchronous shell script with no chat channel, no
resumable agent state, and no human "watching" it directly. It cannot fall back to "present in
chat and wait for a reply" the way `core/roles/orchestrator.md`'s no-TUI branch does.

## Goals / Non-Goals

**Goals:**
- Never let `cleanup.sh --phase4` block on `--await` when no TUI can possibly answer it.
- Preserve the exact existing behavior when a TUI is attached — no observable change to the
  retry/skip contract in that case.
- Make the no-TUI outcome visible (dashboard-facing telemetry), not just another silent `|| true`.
- Keep "a timeout is never an approval" true on both branches.

**Non-Goals:**
- Building a new liveness-detection mechanism — `tui-attached.sh` (CON-126) already exists and is
  reused as-is, unmodified.
- Extending gating to any other script — pending task 1.1's audit, no other script-level call site
  is currently known to exist; if the audit surfaces one, that is new information requiring a
  design update, not something this design presupposes.
- Giving `cleanup.sh` a way to actually notify a human out-of-band (e.g. desktop notification) —
  out of scope; the orchestrator/dashboard's own escalation-relay machinery (CON-76) is the
  existing mechanism for eventually surfacing this to a person, when applicable.

## Decisions

**Decision 1: Gate with the same `if tui-attached.sh; then ... else ... fi` shape CON-126 uses,
but invoked `$SCRIPT_DIR`-relative, never cwd-relative.** `cleanup.sh` already sources
`SCRIPT_DIR` and calls every sibling script by that path (`"${SCRIPT_DIR}/emit-event.sh"`), so the
gate reads `if "${SCRIPT_DIR}/tui-attached.sh"; then AWAIT ... else SKIP ... fi` — the same
`if <check>; then TUI_ATTACHED branch ... fi` shape `core/roles/orchestrator.md` documents, but
with the path resolved the way every other sibling call in this script already is. This is a
deliberate, necessary deviation from copying `orchestrator.md`'s literal
`scripts/concertino/tui-attached.sh` text: that form is cwd-relative and is only correct there
because the orchestrator always runs from the repo root. `cleanup.sh` runs against an arbitrary
worktree cwd (the orchestrator invokes it with an absolute worktree path as an argument, not as
its cwd), so a cwd-relative invocation would fail to resolve the script, `tui-attached.sh` would
be reported non-zero for the wrong reason (file not found, not "no TUI"), and the no-TUI branch
would fire unconditionally regardless of whether a TUI is actually attached — silently breaking
the TUI-attached contract while looking, from the outside, like the fix works (both branches
"appear" to behave, because the no-TUI branch always wins). `$SCRIPT_DIR`-relative resolution
avoids this entirely.

**Decision 2: No-TUI defaults to `skip` (leave the base exactly as found), not a new answer
value.** The proposal already states this is the ticket's own recommended option. Rationale:
`skip` is already the fully-specified, already-tested default outcome for "no usable answer"
(it's what a timeout already produces today) — reusing it means the no-TUI path exercises code
that's already correct and covered, rather than adding a new terminal state (like a distinct
"escalation deferred" status) that the rest of the script, and every consumer of its telemetry,
would need to learn to handle. Rejected alternative: returning a distinct status for the
orchestrator to resolve later — this would need a new resumable-escalation contract for a
synchronous script that has already exited by the time any orchestrator could act on it
(`cleanup.sh --phase4` is the last thing Phase 4 runs), so there's no live caller left to hand a
"resolve me later" token to. `skip` is the only outcome that's actually actionable at this point
in the run.

**Decision 3: Report the no-TUI skip via the existing `gate.warning` telemetry event, not a new
event kind.** The script already emits `gate.warning ticket=$T gate=phase:cleanup resolved=false
reason=...` for the "still behind after retry" and "unknown after retry" cases just below this
block. The no-TUI case gets a third `reason=` value in that same family
(`reason="skipped fast-forward escalation: no TUI attached (<FF_STATUS>: <FF_REASON>)"`), so the
dashboard's existing event-log rendering for this gate needs no new-case handling. Emitted
unconditionally when the block is skipped for lack of a TUI — never gated further on `FF_STATUS`
sub-cases, since by construction we're already inside the `dirty`/`diverged`/`failed` branch.

**Decision 3b: Do NOT also call `emit-event.sh escalation --raise-only` on the no-TUI branch —
considered and rejected.** CON-126's own no-TUI branch (`orchestrator.md`'s `TUI_ATTACHED=0` case)
does not simply skip: it still calls `--raise-only` (non-blocking) specifically "so the run's
bookkeeping stays consistent with the TUI-attached path and a dashboard that attaches later finds
a real, timestamped escalation to poll against." This design deliberately does NOT mirror that
half here. Rationale: `--raise-only` writes an `escalation.raised` event with no matching
`escalation.answered` unless a human (or `concertino answer`) later resolves it — and this
ticket's own Related list cites CON-121, where exactly that shape (an unresolved escalation left
open at the very end of Phase 4) makes `other_runs_live()` false-positive *forever*, because
`cleanup.sh --phase4` is the last thing that runs for this ticket and nothing downstream ever
gets a chance to resolve or expire it. Raising a real escalation here, for an outcome this design
has already decided is always `skip` and never blocks or waits, would manufacture exactly the
kind of stuck-open escalation CON-121 exists to describe as a problem, for zero behavioral
benefit (nothing is waiting on an answer). `gate.warning` gives the same "a later-attaching
dashboard can still see this" property CON-126's `--raise-only` was for, without leaving a
pending-forever escalation record. Rejected alternative: raise `--raise-only` and immediately
`concertino answer ... skip` it inline to close the loop — rejected as needless complexity (two
event-log entries and a write-path dependency) for information `gate.warning` already conveys in
one.

**Decision 4: The TUI check happens once, immediately before the `--await` call, not cached
earlier in the script.** `attempt_fast_forward` can run twice within one `cleanup.sh` invocation
(the `retry` path calls it a second time), but the TUI gate only wraps the *first* `--await` call
— there is no second `--await` call in the retry path (the requirement's own text: "does NOT
raise a second escalation"), so there's exactly one call site to gate, matching today's control
flow exactly.

**Decision 5: `core/roles/orchestrator.md:1060-1067`'s prose describing this call as
unconditionally blocking is left unchanged by this change, deliberately, not by oversight.** That
passage currently tells the orchestrator "`cleanup.sh` ... may itself block on an `emit-event.sh
escalation --await` call exactly like the ones described below. Give this Bash call the same
long, explicit timeout guidance ... it may now block for as long as a human takes to answer." That
statement becomes only conditionally true after this change (it's still exactly true when a TUI
is attached; on the no-TUI path `cleanup.sh` never blocks at all, so the "give it a long timeout"
guidance becomes unnecessary — though not actively wrong, since a longer-than-needed timeout on a
call that resolves in milliseconds is harmless). Editing it is explicitly out of scope for this
change: `core/roles/orchestrator.md` is a role doc, and this run's coordinator has directed that
role docs are owned by a separate, concurrently-live run (CON-130) working in this same repo on
`core/roles/orchestrator.md` and other role docs — editing it here would risk a direct merge
collision with that run, and the ticket-delivery workflow's own guidance is to escalate rather
than touch another live run's files. This design instead leaves the passage as a known, narrow,
non-misleading staleness (the orchestrator's Bash-call timeout is a `timeout: 600000` (10 minute)
budget already far larger than the no-TUI path's sub-second cost, so an unnecessarily generous
timeout on a call that no longer blocks causes no harm — it just times a fast call with a budget
sized for a call that used to be able to block) and records a standalone follow-up ticket to
update that passage once CON-130 has merged, filed via this run's own Delivery-phase follow-up
triage (see tasks — this is not itself a task in this change, since it targets a file this change
must not touch).

## Risks / Trade-offs

- [Risk] A no-TUI run that hits a dirty/diverged base now silently proceeds without ever pausing,
  where before a human watching a TUI could catch and fix it interactively → Mitigation: this is
  the ticket's explicit intent (never block a no-TUI run), and the outcome is not silent — it's
  visible via `gate.warning` telemetry in `events.jsonl`, exactly as the existing "still behind
  after retry" case already is, so a person reviewing the run (or a fleet dashboard that attaches
  later) still sees it.
- [Risk] Someone reads the `gate.warning reason=` string and can't tell "no TUI" apart from
  "TUI was attached but the human said skip" → Mitigation: the reason strings are deliberately
  distinct (`"no TUI attached"` vs. the existing "remains behind after retry" wording); no
  behavior change is needed beyond wording review during the evaluator/skeptic gates.
- [Trade-off] Before this change, "TUI attached, human eventually answers `skip`" and "no TUI
  attached at all" could both take up to the full escalation timeout. After this change only the
  first case can still take that long; the no-TUI case now resolves in milliseconds — this
  divergence in wall-clock cost between the two cases is the entire point of the ticket, not an
  accidental side effect.

## Migration Plan

No data migration. This is a pure control-flow change to one already-idempotent script. Rollback
is a plain revert of the `core/scripts/cleanup.sh` + `openspec/specs/main-fast-forward/spec.md`
diff; no state anywhere depends on the new `gate.warning reason=` wording.
