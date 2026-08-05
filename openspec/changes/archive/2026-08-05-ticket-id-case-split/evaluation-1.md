## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All four acceptance criteria addressed:
  - "one run directory and one fleet row" — covered by the explicit-argument fix
    (`assert-phase.sh`, `start-servers.sh`) plus the independent `emit-event.sh`
    canonicalisation backstop; regression-tested with the exact `worktrees/con-79` /
    `CON-79` scenario in `test/scripts/assert-phase.test.sh`,
    `test/scripts/start-servers.test.sh`, and `test/scripts/emit-event.test.sh`.
  - "take the ticket id explicitly; any retained inference is a documented fallback" —
    done in both scripts, with fallback comments at each `GATE_TICKET`/`T` assignment.
  - "test coverage mirroring CON-64's" — done; new suites explicitly mirror
    `cleanup.test.sh`'s CON-64 shape (non-ticket-shaped basename + explicit id,
    no-argument fallback, lowercase-suffix regression).
  - "existing split directories... decide whether a migration is warranted" —
    `design.md` Decision 3 makes and documents the explicit decision not to migrate,
    with a stated rationale (telemetry-only, reap-managed, not worth the added surface).
- No AC reinterpreted; no scope creep — `cleanup.sh` itself was correctly left untouched
  (already fixed by CON-64) and no unrelated files were touched beyond the scripts,
  role templates, README, and tests the proposal named.
- No regressions to other specs observed — `assert-phase.sh`'s existing behavior
  (stdout/stderr/exit codes) is preserved per the diff; confirmed by the full
  pre-existing test suites for both scripts still passing unchanged.
- Spec deltas (`ticket-id-path-safety`, `gate-telemetry`) match the implemented
  behavior scenario-for-scenario.
- Planning artifacts (proposal/design/tasks) all reflect what was actually implemented;
  `tasks.md` items are all checked and each corresponds to a real diff hunk.

### Phase 2: Code Review — FAIL
Issues:

1. **Rendered-copy drift left uncommitted for `README.md`.** `core/scripts/README.md`
   was updated (usage table now shows `[TICKET_ID]`), but the corresponding rendered
   copy `scripts/concertino/README.md` was not re-synced — it still shows the old
   3-argument usage strings for `start-servers.sh`/`assert-phase.sh`
   (`scripts/concertino/README.md:51-52`). This is the exact class of drift this
   project has its own tooling to catch: running `node bin/concertino doctor` in this
   worktree reports
   `! differs from core: scripts/concertino/README.md — run 'concertino sync'`
   under "Rendered artifacts". The three modified scripts themselves
   (`assert-phase.sh`, `start-servers.sh`, `emit-event.sh`) were correctly re-synced
   (byte-identical to their `core/scripts/` templates), and the role-template
   re-render (`concertino sync`'s agent-file output) is likewise correct and flagged
   clean by `doctor` — only the README fell through. `files-modified.md` does not
   mention `scripts/concertino/README.md` at all, suggesting the sync step was run
   before the README edit and never re-run afterward.
   - Fix: re-run `concertino sync` (or otherwise copy `core/scripts/README.md` to
     `scripts/concertino/README.md`) and commit the result; confirm
     `node bin/concertino doctor` no longer reports the "Rendered artifacts" warning.

Everything else reviewed clean:
- **DRY**: `GATE_TICKET="${TICKET_ID:-${WORKTREE_PATH##*/}}"` / `T="${TICKET_ID:-${WORKTREE_PATH##*/}}"`
  mirrors `cleanup.sh`'s existing CON-64 pattern exactly (verified against
  `core/scripts/cleanup.sh:44,78`) rather than inventing a new convention. No
  duplicated logic introduced.
- **Readable**: variable names, comments and usage banners are clear and explain the
  fallback rationale at each assignment site (`assert-phase.sh:100-108`,
  `start-servers.sh:73-77`, `emit-event.sh:287-296`).
- **Modular**: canonicalisation lives in one place (`emit-event.sh`), applied
  unconditionally before any branch (`--await`/`--raise-only`/`--wait-only`) reads
  `$TICKET` — verified every later use of `$TICKET`/`$LOG` in the file occurs after
  line 296.
- **Type safety / security**: `tr` is restricted to letters `looks_like_ticket`'s regex
  already permits (`[A-Za-z#][A-Za-z0-9_-]*[0-9]`); canonicalisation runs strictly after
  the shape check, never before it, so it cannot widen what `RUN_DIR` can be built from.
  Confirmed with the "malformed ticket still dropped/warned" test in
  `test/scripts/emit-event.test.sh`.
- **Error handling**: existing `|| true` / `exit 0` telemetry-never-fails-delivery
  contract is untouched by the diff.
- **Tests meaningful**: new tests in all three `test/scripts/*.test.sh` files
  reproduce the ticket's exact regression scenario (`worktrees/con-79` → `CON-79`) and
  would fail against the pre-fix scripts (per the executor's own probe in
  `files-modified.md`); they also cover the fallback-preserved and non-ticket-shaped
  cases, and the "converges on one directory" property directly.
- **No dead code**: no leftover TODOs/FIXMEs, no unused imports/vars introduced.
- **No over-engineering**: no new abstraction; the fix is the minimum diff needed,
  matching an already-established pattern.
- **Behavior-preserving**: `assert-phase.sh`'s and `start-servers.sh`'s existing
  stdout/stderr/exit-code contracts are unchanged with or without the new argument —
  confirmed by the pre-existing test suites (unmodified assertions) still passing.

**Verification gates (fresh run, this evaluation, not the executor's report):**
```
npm test
```
Result: exit 0. `node --test` summary: `# tests 1558 / # pass 1558 / # fail 0`
(`# duration_ms 5939.884373`). All appended bash suites
(`test/scripts/assert-phase.test.sh`, `test/scripts/start-servers.test.sh`,
`test/scripts/emit-event.test.sh`, and every other suite in the `npm test` chain)
each report `N passed, 0 failed`, including the new CON-80 sections
(`assert-phase.sh (CON-80: explicit ticket id)`, `start-servers.sh (CON-80: explicit
ticket id)`, and the CON-80 block in `emit-event.test.sh`).

`CLEAN_WORKTREE` was not set for this run (not `slow` speed), so gates ran directly in
`WORKTREE_PATH` per the standard instructions.

### Phase 3: UI Review — N/A
This is a shell-script/test change with no UI surface.

### Overall: FAIL

### Change Requests
1. Re-sync `scripts/concertino/README.md` from `core/scripts/README.md` (run
   `concertino sync`, or copy the file directly) so its usage-summary table reflects
   the new optional trailing `[TICKET_ID]` argument for `start-servers.sh` and
   `assert-phase.sh` — currently at `scripts/concertino/README.md:51-52`, still showing
   the pre-fix 3-argument usage strings. Confirm `node bin/concertino doctor` reports a
   clean "Rendered artifacts" section afterward (no `differs from core` warning).

### Non-blocking Suggestions
- None beyond the change request above; the core script/test logic itself is solid
  and well-tested.
