## Why

A `fold-in` follow-up reopens an already-archived change in a freshly re-created worktree that
restores the change directory's existing files — including any `evaluation-*.md` /
`skeptic-design-*.md` / `skeptic-final-*.md` reports the first sub-run already wrote. The new
sub-run's evaluator/skeptic number their reports off a run-local counter (`CYCLE`/`N`) that always
restarts at 1, so the second sub-run's first report is written to the exact same filename the
first sub-run already used — silently overwriting the review history that justified the earlier,
already-merged delivery. `persist-evidence.sh` then re-persists that clobbered file into
`.concertino/runs/<TICKET>/evidence/`, propagating the loss there too. This was hit for real on
CON-71 (PR #64's fold-in overwrote PR #63's `evaluation-1.md` / `skeptic-final-1.md`) and only
survived because the orchestrator noticed and hand-fixed it before committing.

## What Changes

- New `core/scripts/next-report-number.sh`: given a change directory and a report "kind"
  (`evaluation` | `skeptic-design` | `skeptic-final`), scans the directory for existing
  `<kind>-<N>.md` files and returns the next number strictly greater than the highest one found
  (or `1` if none exist) — collision-safe by construction, and correct across any number of prior
  sub-runs since it is derived purely from what's actually on disk, not from a run-local counter.
  Also verifies its own answer: if the computed target filename somehow already exists (it never
  should, given the scan), it fails loudly (`FAIL`) instead of returning a number that would
  overwrite something.
- `core/roles/evaluator.md` and `core/roles/skeptic.md`: before writing a report, call
  `next-report-number.sh` to get the collision-safe filename number, and write to
  `<kind>-<that number>.md` instead of `<kind>-<CYCLE>.md` / `<kind>-<GATE>-<N>.md` directly. The
  report body's own "Cycle N" / "round N" label keeps using the orchestrator-supplied `CYCLE`/`N`
  (unchanged run-local semantics — still what bounds `EXECUTION_CYCLES`/`SKEPTIC_FINAL_ROUNDS`/etc
  and what the orchestrator's Final-cycle-behavior check reads); only the **filename** — the thing
  that actually collides on reopen — becomes disk-derived. Both roles already return the literal
  path they wrote to the orchestrator, so nothing on the orchestrator's side needs to change.
- `core/scripts/persist-evidence.sh`: add an optional `--no-clobber` flag. When passed, and the
  destination already exists with content that differs from the source, the script fails loudly
  (`FAIL`) instead of overwriting; if the destination doesn't exist yet, or exists with identical
  content (a genuine re-run of the same call), behavior is unchanged. The evaluator's and
  skeptic's `verdict.ref` persist call passes `--no-clobber` (reports are write-once); every other
  caller (planning artifacts, which are legitimately revised and re-persisted in place during
  planning) is unaffected — the flag is opt-in and defaults to today's overwrite behavior.
- `scripts/concertino/next-report-number.sh` (new) and `scripts/concertino/persist-evidence.sh`
  (updated) are kept byte-identical copies of their `core/scripts/` sources, per this repo's
  existing `concertino sync`/`doctor` contract. `.claude/agents/concertino-{evaluator,skeptic}.md`
  are generated from `core/roles/*.md` at sync time (gitignored, not part of this change's diff).

## Capabilities

### New Capabilities
- `gate-report-numbering`: collision-safe, disk-derived filename numbering for evaluator and
  skeptic reports, so a fold-in reopen (or any later sub-run) never overwrites an earlier
  sub-run's report.

### Modified Capabilities
- `evidence-telemetry`: `persist-evidence.sh` gains an opt-in `--no-clobber` mode used by the
  evaluator's/skeptic's `verdict.ref` persist call, so a report re-persist can't silently
  overwrite a prior sub-run's persisted evidence copy either.

## Impact

- `core/scripts/next-report-number.sh` (new), `core/scripts/persist-evidence.sh`,
  `core/roles/evaluator.md`, `core/roles/skeptic.md`.
- `scripts/concertino/next-report-number.sh` (new, byte-identical copy),
  `scripts/concertino/persist-evidence.sh` (byte-identical copy, kept in sync).
- No change to the orchestrator role, `workflow-state.md`'s schema, or any event contract —
  `verdict`/`evidence` events are unaffected; only which literal path a report/evidence copy lands
  at changes when a collision would otherwise have occurred.
