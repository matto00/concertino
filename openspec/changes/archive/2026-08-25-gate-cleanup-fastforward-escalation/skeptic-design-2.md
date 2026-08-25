## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Spawned cold; re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/main-fast-forward/spec.md` and re-derived every check from the files.

**Round-1 change requests, each verified against the file (not the claim):**

1. **CR 1 (requirement header) — FIXED.** Extracted the live requirement block from
   `openspec/specs/main-fast-forward/spec.md` and the delta's block programmatically and
   compared the header strings: both are exactly
   `### Requirement: An unresolvable fast-forward escalates with a bounded retry/skip loop`
   (`IDENTICAL_HEADER True`). The `, gated on TUI liveness` suffix is gone. I also diffed
   the **whole** requirement body live-vs-delta: every existing paragraph survives (the
   two-attempt cap, the fetch-failed/no-local-base unknown-state distinction, the CON-99
   `gate.warning` telemetry, the narrowed non-zero-exit exemption, the
   `cleanup-failure-visibility` cross-reference) — the only removals are re-flows, and the
   only scenario changes are two `(TUI attached)` title qualifiers plus one added scenario.
   No content is silently dropped by the replacement.

2. **CR 2 (gate path) — FIXED, consistently in all three places.**
   - `design.md:39-54` Decision 1: `if "${SCRIPT_DIR}/tui-attached.sh"; then ... fi`, with the
     cwd-relative form named explicitly as rejected and the failure mode spelled out.
   - `tasks.md:2.1`: normative `"${SCRIPT_DIR}/tui-attached.sh"`, "NOT the cwd-relative
     `scripts/concertino/tui-attached.sh` form".
   - `specs/main-fast-forward/spec.md:5-8`: names the *signal* (`tui-attached.sh`, CON-126's
     authority) and requires `$SCRIPT_DIR`-relative invocation, "never a cwd-relative path".
   No remaining occurrence of a bare cwd-relative `scripts/concertino/tui-attached.sh` as the
   prescribed invocation anywhere in the change dir.

3. **CR 3 (`--raise-only` half of CON-126) — FIXED.** `design.md:78-96` is a new
   **Decision 3b** that states CON-126's no-TUI branch does call `--raise-only`, that this
   design deliberately does not, and gives the CON-121 rationale (an unresolved
   `escalation.raised` at the very end of Phase 4 has nothing downstream left to resolve it,
   so it would make `other_runs_live()` false-positive forever). It also rejects the
   raise-then-self-answer variant. The round-1 "leans on a later-attaching dashboard" tension
   is now addressed explicitly (`gate.warning` supplies that property).

4. **CR 4 (`core/roles/orchestrator.md:1060-1067`) — FIXED.** `design.md:105-125` Decision 5
   states the passage is left unedited deliberately, why it becomes only conditionally true,
   why the residual staleness is non-misleading (a 10-minute Bash budget on a call that now
   resolves in ms), the CON-130 concurrent-ownership rationale, and a Delivery-phase
   follow-up-ticket plan. `proposal.md`'s Impact section carries the matching note pointing at
   Decision 5. Both exist as claimed.

5. **CR 5 (audit deliverable) — FIXED.** `design.md:8-12` no longer asserts a completed audit:
   it says task 1.1 produces it, "not yet performed as of Planning", and demotes the Planning
   check to "preliminary ... not itself the required deliverable". Non-Goals (`:30-32`) is
   reworded to "pending task 1.1's audit". `tasks.md:1.1` now names the concrete deliverable —
   site list, both grep directions, result — written into this run's Delivery report.

**Independent ground-truth re-checks (not taken from any report):**
- `core/scripts/cleanup.sh:343-349`: the defect is exactly as ticketed — an ungated
  `"${SCRIPT_DIR}/emit-event.sh" escalation --await ... || true` inside the
  `dirty|diverged|failed` branch. `grep -n 'tui-attached' core/scripts/cleanup.sh` → nothing.
- The `gate.warning` pattern Decision 3 reuses genuinely exists just below, twice
  (`CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.warning ticket="$T"
  gate=phase:cleanup resolved=false "reason=..." || true`), so the design's "third `reason=`
  in the same family" is real, not invented.
- Re-ran the forward grep myself: `grep -rn -- '--await\|--raise-only\|--wait-only'
  core/scripts/*.sh` → the only executable call site outside `emit-event.sh`'s own
  implementation/usage text is `cleanup.sh:345`; the other hits are comments in
  `gather-escalation-context.sh:23`, `triage-followup.sh:52`, `tui-attached.sh:9`. Consistent
  with what task 1.1 is expected to produce (and 1.1 correctly still owns producing it).
- `openspec validate gate-cleanup-fastforward-escalation --strict` →
  `Change 'gate-cleanup-fastforward-escalation' is valid`.
- AC coverage traced: AC1→2.1, AC2→2.2, AC3→2.3, AC4→spec delta:48-49 + unchanged TUI branch,
  AC5→4.1 (measured wall clock, CON-126 precedent), AC6→proposal Impact + task 2.1 both target
  `core/scripts/cleanup.sh`, AC7→1.1. No AC uncovered; no task outside the ACs.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md:2.2` cites "design.md Decision 3" for the no-`--raise-only` rationale; that
  rationale now lives in **Decision 3b**. Harmless (they are adjacent) but worth correcting
  when the task is touched.
- Neither the design nor `tasks.md:2.2` mentions the `CONCERTINO_ROLE=script` prefix the two
  existing `gate.warning` emissions in this same function carry. The executor should mirror the
  sibling calls exactly (prefix included, plus the trailing `|| true` so telemetry can never
  fail the run) — the design's "same event family" intent already implies this.
- Round 1's note about `openspec validate --change` is resolved: `tasks.md:4.4` now prescribes
  the working form and documents why.
- `design.md`'s previously-garbled third Risks bullet (`:139-143`) now reads cleanly.
- Decision 5's CON-130 concurrent-ownership premise is a coordinator-supplied fact I cannot
  verify from this worktree; I accept it as a documented, bounded deferral with a named
  follow-up, which is all this gate requires.
