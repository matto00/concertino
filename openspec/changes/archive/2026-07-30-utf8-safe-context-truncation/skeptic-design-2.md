## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/escalation-context/spec.md`, `specs/gate-telemetry/spec.md`, and
  `skeptic-design-1.md` (round 1's REFUTE) in full, cold — no assumptions
  carried over from round 1's narrative.

- **Round-1 Change Request #1 (capability misplacement) — verified fixed.**
  - `specs/gate-telemetry/spec.md` now exists as a change delta and contains
    exactly one `## MODIFIED Requirements` section amending `### Requirement:
    Failing gate.result events carry the first error line` — the heading is
    byte-for-byte identical to the base capability's heading
    (`openspec/specs/gate-telemetry/spec.md:37`, confirmed by direct read of
    both files side by side), so it applies as a genuine amendment, not a
    disconnected addition.
  - `grep -n "gate.result\|first_error\|assert-phase"
    openspec/changes/utf8-safe-context-truncation/specs/escalation-context/spec.md`
    returns nothing — the gate-telemetry content has been fully removed from
    the escalation-context delta, not merely duplicated. `escalation-context/spec.md`
    now contains only the one `## MODIFIED Requirements` section for
    "Oversized context is truncated visibly..." plus its four scenarios, all
    genuinely about escalation context.
  - `proposal.md`'s "Modified Capabilities" section now lists both
    `escalation-context` and `gate-telemetry`, and its "Impact" section lists
    both `openspec/specs/escalation-context/spec.md` and
    `openspec/specs/gate-telemetry/spec.md` — matches the actual delta files
    on disk.
  - Ran `openspec validate --changes utf8-safe-context-truncation --strict` →
    `✓ change/utf8-safe-context-truncation`, `Totals: 1 passed, 0 failed`. This
    confirms both delta files' MODIFIED-requirement headings match their
    respective base capabilities' existing requirement headings verbatim
    (openspec's strict validation would fail a MODIFIED delta whose heading
    doesn't match an existing requirement).

- **Re-checked AC coverage (ticket.md) end to end, independent of round 1:**
  1. "Truncation never emits a partial UTF-8 sequence, back off to previous
     character boundary" — `design.md` Decision 1 gives a concrete backward-scan
     algorithm (lead-byte + expected-length check), `tasks.md` 1.1/1.2 implement
     it, both spec deltas normatively require it with matching scenarios.
  2. "Marker reports honest byte counts, full text still persists via
     persist-evidence.sh with context_ref, exactly as now" — `design.md`
     Decision 2 explicitly changes the marker to report the actual backed-off
     byte length instead of the requested `mid`; `escalation-context/spec.md`'s
     MODIFIED requirement text states this normatively and preserves the
     unchanged persist-evidence.sh/context_ref language verbatim from the base
     requirement (confirmed by diffing base vs delta requirement prose — the
     persistence/context_ref paragraph is untouched, only the new UTF-8
     paragraph is appended).
  3. "A test truncates context with multi-byte chars across the boundary,
     asserts valid JSON and a whole-character-ending decode" — `tasks.md` 2.1
     specifies this exactly (4-byte emoji, JSON validity, `Buffer.from` round
     trip, marker byte-count equality).
  4. "Worth checking the same boundary in emit-event.sh's msg/first_error
     truncation" — the ticket's literal wording (`emit-event.sh`'s
     `msg`/`first_error`) doesn't match any real field (confirmed again:
     `grep -n "first_error" core/scripts/emit-event.sh` returns nothing);
     design correctly redirects this to `assert-phase.sh`'s `fail()`, which is
     the actual `first_error` producer, and now expresses that fix through the
     correctly-owned `gate-telemetry` capability. `core/scripts/assert-phase.sh:40`
     still reads `FIRST_ERROR="${msg:0:200}"` — confirmed unfixed pre-execution,
     consistent with this being the design gate.

- **Traced binary-search monotonicity concern again independently** (not just
  trusting round 1's note): backing a candidate's shown length off to a
  character boundary makes `len(prefix(mid))` a non-decreasing step function of
  `mid` (never overshoots `mid`, never decreases as `mid` grows), which
  preserves the existing `lo`/`hi` binary-search invariant in
  `write_escalation_raised()`. Not a defect.

- **Checked for new contradictions introduced by the round-2 restructuring.**
  `design.md`'s Decision 3 and `tasks.md` 1.3/2.2 consistently describe one
  node helper usable in two modes (byte budget for `emit-event.sh`, codepoint
  budget for `assert-phase.sh`) — no drift between design and tasks after the
  capability move.

- **Checked round 1's two non-blocking notes for regression/persistence:**
  - `tasks.md:40` still reads `openspec validate --change
    "utf8-safe-context-truncation"` (singular `--change`, should be
    `--changes`) — unchanged from round 1, still a trivial copy-paste nit, not
    re-escalating it to blocking.
  - The ticket-wording imprecision (AC #4 naming `msg`/`first_error` on
    `emit-event.sh`) is still not called out explicitly in `design.md`'s
    Context section — still non-blocking, the design's redirection to
    `assert-phase.sh` is correct regardless.

- **New check this round: the ticket's `## Notes` item is unaddressed by
  design/tasks.** The ticket says the `blocker` context kind's reliance on
  callers pre-trimming command output (rather than
  `gather-escalation-context.sh` doing it) is "cheaper to fold in here than to
  file separately." `grep -in "blocker\|pre-trim\|gather-escalation-context"`
  across `design.md`/`proposal.md`/`tasks.md` finds no reference to this at
  all — no implementation, and no explicit Non-Goal excluding it (contrast
  with Non-Goal 2, which explicitly and by name scopes out
  `check-merge-readiness.sh`'s unrelated truncation with a stated reason).
  This is a real gap in the design's completeness, but it's in the ticket's
  `## Notes` section, not `## Acceptance Criteria` — non-blocking rather than
  a REFUTE reason, flagged below for the executor/orchestrator's attention so
  it isn't silently dropped or silently expanded into scope without a
  decision either way.

### Verdict: CONFIRM

Round 1's sole Change Request (capability misplacement) has been correctly
resolved: the `first_error`/UTF-8 requirement now lives in a `gate-telemetry`
MODIFIED delta amending the capability's existing requirement, the
escalation-context delta no longer carries any gate-telemetry content, and
`proposal.md` was updated to match. `openspec validate --strict` confirms both
deltas apply cleanly. No new contradictions, ambiguities, or scope gaps
against the ticket's formal Acceptance Criteria were found on independent
re-review.

### Non-blocking notes

1. `tasks.md:40` — `openspec validate --change "utf8-safe-context-truncation"`
   should be `--changes` (plural); trivial, carried over from round 1,
   worth a one-character fix before the executor copy-pastes it.
2. The ticket's `## Notes` paragraph about `gather-escalation-context.sh` vs.
   caller-side pre-trimming for the `blocker` context kind is neither
   implemented nor explicitly scoped out anywhere in `design.md`/`tasks.md`.
   Given the ticket frames it as "cheaper to fold in here than to file
   separately," the executor should get an explicit decision (implement it,
   or add it to `design.md`'s Non-Goals with a one-line reason) rather than
   silently doing either.
