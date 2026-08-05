## 1. assert-phase.sh: explicit ticket id

- [x] 1.1 Add an optional trailing `TICKET_ID` argument to every phase case (`setup`, `servers`,
      `delivery`, `cleanup`); update the usage comment block accordingly.
- [x] 1.2 Replace `GATE_TICKET="${WORKTREE_PATH##*/}"` with
      `GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"`, resolved after the phase-specific
      positional args are parsed (each phase's trailing arg lands in a different `$N`).
- [x] 1.3 Verify no other behavior (stdout/stderr/exit code) changes.

## 2. start-servers.sh: explicit ticket id

- [x] 2.1 Accept an optional 4th positional argument `TICKET_ID`; update the usage comment block.
- [x] 2.2 In `start_one()`, replace `local T="${WORKTREE_PATH##*/}"` with
      `local T="${TICKET_ID:-${WORKTREE_PATH##*/}}"` (passed in from the outer scope).
- [x] 2.3 Verify no other behavior changes.

## 3. emit-event.sh: unconditional case canonicalisation

- [x] 3.1 After the existing `looks_like_ticket "$TICKET"` validation passes, canonicalise
      `TICKET` to uppercase (e.g. `TICKET="$(printf '%s' "$TICKET" | tr '[:lower:]' '[:upper:]')"`)
      before `RUN_DIR` is computed and before it is written into any event.
- [x] 3.2 Confirm the malformed-ticket degradation path (silent drop / loud `run.end` warning) is
      unaffected — canonicalisation must run strictly after the existing shape check, never widen
      it.

## 4. Role template call sites

- [x] 4.1 Update every `assert-phase.sh` / `start-servers.sh` call site in
      `core/roles/orchestrator.md` to pass `$TICKET_ID` as the trailing argument.
- [x] 4.2 Update the `start-servers.sh` / `assert-phase.sh servers` call sites in
      `core/roles/evaluator.md` and `core/roles/skeptic.md` likewise.
- [x] 4.3 Re-render the rendered role/agent files (`concertino sync` or the project's equivalent
      render step) so the rendered copies match the updated templates.

## 5. Tests

- [x] 5.1 Extend `test/scripts/assert-phase.test.sh` with the CON-64-style regression case: an
      explicit ticket id passed alongside a lowercase/non-matching worktree basename tags
      `gate.result` with the explicit id, for at least the `setup` phase; and a no-argument call
      still falls back to basename inference unchanged.
- [x] 5.2 Extend `test/scripts/start-servers.test.sh` with the analogous explicit-ticket-id case.
- [x] 5.3 Extend `test/scripts/emit-event.test.sh` with case-canonicalisation cases: a lowercase
      ticket writes to the uppercase run directory; a mixed-case ticket does too; two invocations
      differing only by case converge on one directory; an already-uppercase ticket is unaffected.
- [x] 5.4 Run the full shell test suite and confirm no regressions.

## 6. Documentation

- [x] 6.1 Update `core/scripts/README.md`'s usage summary for `assert-phase.sh` and
      `start-servers.sh` to reflect the new optional trailing argument.
