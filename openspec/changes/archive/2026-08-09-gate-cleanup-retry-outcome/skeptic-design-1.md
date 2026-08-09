## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Root-cause mechanism claim** (ticket.md, proposal.md "Why", design.md "Context"): read
  `core/scripts/cleanup.sh:164-196` directly. Confirmed line-for-line: on `retry`,
  `attempt_fast_forward` is called once more; if `FF_STATUS` lands on `fetch-failed`/`no-local-base`
  it echoes a stderr note (line 189 in the file, `:181-194` range as referenced by design/tasks — the
  relative line numbers in the retry block match exactly what design.md/tasks.md cite); if it lands on
  `dirty`/`diverged`/`failed` it echoes a different stderr note (line 193). Neither path emits any
  event, and nothing re-raises or blocks. `run.end status=delivered` fires unconditionally at line
  267-268, `echo "READY cleaned..."` at 270. This matches the ticket's own event-tail evidence and the
  design doc's description precisely — not embellished, not hand-waved.

- **Precedent pattern claim** (`assert-phase.sh delivery`'s `gate.warning`, CON-80): read
  `core/scripts/assert-phase.sh:130-176`. Confirmed the exact call site the design leans on (line 169):
  `looks_like_ticket "$GATE_TICKET" && ... emit-event.sh gate.warning ticket=... gate=phase:delivery
  behind=... base=... remote=... commits=... || true` — additive, best-effort, non-blocking, alongside
  the existing stderr warning. Cross-checked against `openspec/specs/delivery-stale-base-warning/spec.md`,
  which formalizes this exact shape (`Requirement: A stale base emits a gate.warning telemetry event`).
  The proposed cleanup.sh extension (`gate=phase:cleanup`, `resolved=false`, `reason=`) is a faithful,
  structurally analogous reuse — not a stretch.

- **`lib/ui/reducer.js` "no dedicated case needed" claim**: read `reducer.js:96-175`. Confirmed
  `run.events.push(ev)` runs unconditionally at line 97, before the `switch (ev.kind)` — so any event
  kind, including a novel `gate.warning` payload shape, lands in `run.events` regardless of whether the
  switch has a case for it. The switch itself has no `'gate.warning'` case (falls to `default: break` at
  line 222+), consistent with the design's claim that no reducer change is required for dashboard
  visibility via the drill-down/timeline.

- **"Synced copy" claim**: `diff core/scripts/cleanup.sh scripts/concertino/cleanup.sh` and the
  `assert-phase.sh` pair are both byte-identical today, confirming the proposal's stated impact
  (edit `core/scripts/cleanup.sh`, re-sync the copy) is accurate to the current repo state.

- **Base spec fidelity**: read `openspec/specs/main-fast-forward/spec.md`'s current (pre-change)
  `Requirement: An unresolvable fast-forward escalates with a bounded retry/skip loop`. The change's
  MODIFIED requirement in `specs/main-fast-forward/spec.md` is a strict, faithful extension of this
  text (same escalate/retry/note language preserved verbatim, `gate.warning` clause appended) — not a
  silent rewrite of unrelated behavior.

- **Non-Goals vs. ticket's escalation resolution**: `design.md`'s Context/Decisions explicitly record
  that the human corrected an initial "re-raise a second escalation" answer to the final "non-blocking
  telemetry, still `status=delivered`" decision. This is consistent with the ticket's own AC #2 wording
  ("...can no longer result in a run silently reaching delivered/done" — satisfied by making it
  non-silent, not by blocking it) and doesn't contradict AC #1 (root cause is written up in
  proposal.md/design.md's Context, confirmed above against the real file).

- **Test feasibility**: read `test/scripts/cleanup.test.sh` (existing "still-dirty retry exhaustion" and
  "fetch-failed retry" scenarios already exist, asserting on stderr text) and
  `test/scripts/assert-phase.test.sh` (existing `gate.warning` assertions for the delivery-stale-base
  case, e.g. lines 314-346, asserting `behind=`, `gate=`, `base=`, etc. via the same `node -e` JSON-parse
  pattern). Confirmed the new coverage tasks.md asks for (4.1-4.4) slot naturally into the existing test
  structure rather than requiring new scaffolding — low implementation risk.

- **`openspec validate` sanity check**: ran `openspec validate gate-cleanup-retry-outcome --strict` →
  `Change 'gate-cleanup-retry-outcome' is valid`. (Note: tasks.md 5.1 cites the command as
  `openspec validate --change gate-cleanup-retry-outcome --strict`, which errors — `unknown option
  '--change'`. Non-blocking, see notes below.)

### Verdict: CONFIRM

The design is sound, internally consistent, and every load-bearing claim in proposal.md/design.md/
tasks.md/spec.md checked out against the actual current code — not just plausible-sounding, but
verified line-by-line. The scope is tightly bounded (no exit-code change, no re-escalation, no
`run.end` status change), matches the human's recorded resolution of the ticket's own escalation, and
reuses a genuinely identical, already-shipped, already-tested pattern rather than inventing a new one.
No placeholders, no TBDs, no contradictions between proposal/design/tasks/spec, no scope drift beyond
the ticket's two ACs, and the AC around "no longer silently reaching delivered/done" is satisfiable by
telemetry alone per the ticket's own wording.

### Non-blocking notes

1. `tasks.md:61` (task 5.1) cites `openspec validate --change gate-cleanup-retry-outcome --strict`,
   which is not a valid CLI invocation (`--change` doesn't exist; verified via direct run — the error is
   `unknown option '--change' (Did you mean --changes?)`). The correct form, confirmed working, is
   `openspec validate gate-cleanup-retry-outcome --strict`. Trivial to self-correct at execution time,
   but worth fixing in tasks.md so the written task doesn't hand the executor a command that errors.
2. `tasks.md:22-23` (task 2.1) tells the implementer to "reuse `FF_REASON` from the existing branch,
   same as the stderr `NOTE` text" for the confirmed-still-behind case's `reason=` field. Taken
   literally this could produce `reason="$FF_REASON"` alone (e.g. just "main is checked out at
   /path with uncommitted changes"), which doesn't itself contain a "remains behind" phrase and so
   wouldn't self-evidently satisfy spec.md's own scenario wording ("a `reason=` value ... stating `main`
   remains behind") or the equivalent test assertion tasks.md itself asks for in 4.2 ("a `reason=`
   naming `main` as still behind"). The spec.md scenarios and tasks 4.2/4.3 are unambiguous and will
   catch a too-literal reading at test time, so this isn't blocking — but tightening task 2.1's wording
   to explicitly say the `reason=` text must state "remains behind" (optionally appending `FF_REASON`
   as parenthetical detail, mirroring the existing `NOTE` construction at cleanup.sh:191-192) would
   remove the ambiguity before an implementer hits it.
