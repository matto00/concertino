## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/escalation-context/spec.md`, and `workflow-state.md` in full.
- Confirmed the described bug against real source: `core/scripts/emit-event.sh`
  line 244 does `prefix="$(printf '%s' "$CONTEXT" | LC_ALL=C cut -b "1-${mid}")"`
  inside `write_escalation_raised()` (lines 196-280), and the marker text at
  line 249/251 embeds `${mid}` (the requested byte budget), matching the
  proposal/design's description exactly.
- Confirmed `core/scripts/assert-phase.sh:40` does
  `FIRST_ERROR="${msg:0:200}"`, matching the design's claim of
  locale-dependent bash substring slicing.
- Confirmed `scripts/concertino/emit-event.sh` and
  `scripts/concertino/assert-phase.sh` are currently byte-for-byte identical
  to their `core/` counterparts (`diff` exit 0 both ways), so task 1.4's
  "re-render via `concertino sync`" premise is accurate.
- Confirmed `core/scripts/check-merge-readiness.sh`'s `fail()` (lines
  53-58) only does `echo "FAIL $*" >&2` and never calls `emit-event.sh` —
  validates the design's Non-Goal 2 justification for excluding its
  `cut -c1-200` truncation from scope.
- Ran `openspec validate --changes utf8-safe-context-truncation --strict` →
  `✓ change/utf8-safe-context-truncation`, `1 passed, 0 failed`. Syntactically
  valid delta.
- Confirmed the base `openspec/specs/escalation-context/spec.md`'s
  "Oversized context is truncated visibly..." requirement heading matches the
  delta's `## MODIFIED Requirements` heading verbatim, so that half of the
  delta applies cleanly.
- Traced the binary-search monotonicity concern (backing off a candidate's
  byte length to a character boundary changes `line_try`'s length as a
  function of `mid` from "exactly `mid` bytes" to a step function) — this
  stays non-decreasing in `mid`, so the existing `lo`/`hi` binary-search
  invariant still holds. Not a defect.
- **Checked capability placement of the new `assert-phase.sh`/`first_error`
  requirement.** `openspec/specs/gate-telemetry/spec.md` already exists as
  its own capability (`ls openspec/specs/` confirms the directory) and its
  Purpose line reads: "Defines the `gate.result` telemetry event contract
  emitted by `assert-phase.sh` and `start-servers.sh` — the `duration_ms` and
  `first_error` fields...". It already contains a normative requirement,
  "Failing gate.result events carry the first error line" (spec.md:37), with
  an existing scenario "Oversized failure message is trimmed at the source"
  (spec.md:50-56) describing exactly the trimming behavior this ticket is
  correcting.
  Yet this change's only spec delta file is
  `openspec/changes/utf8-safe-context-truncation/specs/escalation-context/spec.md`,
  and inside it the `## ADDED Requirements` section adds "gate.result's
  first_error trimming never splits a multi-byte character" (spec.md:57-72) —
  a requirement entirely about `assert-phase.sh`'s `gate.result` event, bolted
  onto the escalation-context capability, whose own Purpose statement is about
  letting a human decide an *escalation* from the dashboard. `grep -rn
  "gate-telemetry" openspec/changes/utf8-safe-context-truncation/` returns
  nothing — the change's `proposal.md` "Modified Capabilities" section also
  never lists `gate-telemetry` as touched, even though `assert-phase.sh`'s
  `fail()` behavior (governed by that capability) is exactly what's being
  changed.

### Verdict: REFUTE

### Change Requests

1. **Capability misplacement (spec.md, design.md, proposal.md).** The new
   `first_error`/UTF-8 requirement and its two scenarios
   (`specs/escalation-context/spec.md:57-72`) describe `assert-phase.sh`'s
   `gate.result` event contract, which is already normatively owned by the
   `gate-telemetry` capability (`openspec/specs/gate-telemetry/spec.md`,
   which already has a "Failing gate.result events carry the first error
   line" requirement with an "Oversized failure message is trimmed at the
   source" scenario). Move this requirement out of
   `specs/escalation-context/spec.md` and into a new
   `openspec/changes/utf8-safe-context-truncation/specs/gate-telemetry/spec.md`
   delta, expressed as a `## MODIFIED Requirements` amendment to that
   capability's existing "Failing gate.result events carry the first error
   line" requirement (strengthening its existing "trimmed at the source"
   language with the UTF-8-safety guarantee), not as a disconnected `ADDED`
   requirement under an unrelated capability. Update `proposal.md`'s
   "Capabilities" section to list `gate-telemetry` as a modified capability
   alongside `escalation-context`, and update its "Impact" section to include
   `openspec/specs/gate-telemetry/spec.md`. Leaving this as-is means a future
   reader looking for the `first_error` contract in `gate-telemetry/spec.md`
   will not find the UTF-8 guarantee there, and `escalation-context/spec.md`
   will carry a requirement with nothing to do with escalations.

### Non-blocking notes

- The ticket's AC #4 literally says "the same boundary in `emit-event.sh`'s
  existing `msg` / `first_error` truncation" — but `emit-event.sh` has no
  `msg`/`first_error` field at all (`grep` confirms). The design/proposal
  correctly redirect this to `assert-phase.sh`'s `fail()` instead, which is
  the right call — just flagging that the ticket's own wording is imprecise
  and the design silently corrects it without calling out the correction
  explicitly. Worth a one-line note in `design.md`'s Context section for a
  future reader comparing the ticket text against the design.
- `tasks.md` 3.2 says `openspec validate --change "utf8-safe-context-truncation"`;
  the actual CLI flag is `--changes` (plural) — trivial, the executor will
  likely notice immediately, but worth fixing so the task is copy-pasteable.
