## 1. persist-evidence.sh (the durability fix)

- [x] 1.1 Add `core/scripts/persist-evidence.sh`: `<TICKET_ID> <SOURCE_PATH>` — resolves the
      main checkout (duplicate `emit-event.sh`'s `git rev-parse --git-common-dir` logic, same
      relative/absolute normalisation), copies `SOURCE_PATH` to
      `<main checkout>/.concertino/runs/<TICKET_ID>/evidence/$(basename SOURCE_PATH)` (creating
      the directory as needed), prints `READY ref=<absolute dest path>` and exits 0 on success.
- [x] 1.2 On a missing/unreadable source or a failed copy, print `FAIL <reason>` to stderr and
      exit non-zero, printing no `READY` line.
- [x] 1.3 Make executable (`chmod +x`), matching the other scripts in `core/scripts/`.
- [x] 1.4 Add `persist-evidence.sh` to `core/scripts/README.md`'s script table.

## 2. Orchestrator: evidence for planning artifacts

- [x] 2.1 In `core/roles/orchestrator.md`, at the point Phase 1 writes `workflow-state.md`
      (PHASE: Execution, CYCLE: 1), add the instruction to run `persist-evidence.sh` for each
      planning artifact just created (`proposal.md`, `design.md`, `tasks.md`, any spec deltas
      under `specs/`), and for each success, emit
      `scripts/concertino/emit-event.sh evidence ticket=$TICKET_ID role=orchestrator
      ref=<persisted path> label=<artifact name>`.
- [x] 2.2 Guard each call so a failed persist skips that artifact's evidence event without
      blocking the phase transition (`|| true` / conditional on the `READY` line, matching the
      existing telemetry call sites' resilience).

## 3. Evaluator and skeptic: durable verdict.ref, no redundant evidence event

- [x] 3.1 In `core/roles/evaluator.md`'s "emit the verdict for the dashboard" step, persist the
      evaluation report via `persist-evidence.sh` first, then use its `ref=` output (not the
      raw `WORKTREE_PATH/<change-dir>/evaluation-<CYCLE>.md` path) in the `verdict` event.
- [x] 3.2 Apply the same change to `core/roles/skeptic.md`'s equivalent step for
      `skeptic-<GATE>-<N>.md`.
- [x] 3.3 Do NOT add a distinct `evidence` event emission to either role doc for these reports —
      confirm the design.md rationale is reflected in a short comment/note in both role docs so
      a future reader doesn't "fix" this into duplication.
- [x] 3.4 Cycle 2 (evaluation-1.md change request): if `persist-evidence.sh` itself fails for the
      evaluator's or skeptic's own report, the `verdict` event MUST still be emitted but MUST
      omit `ref` entirely — never fall back to the raw `WORKTREE_PATH`-relative report path.
      Applied to both `core/roles/evaluator.md` and `core/roles/skeptic.md`; documented as a
      corner case under design.md's Decision 3 and covered by a new spec.md scenario.

## 4. Re-sync this repo's own rendered copies

- [x] 4.1 Run `node bin/concertino sync` from the worktree root so
      `.claude/agents/concertino-{orchestrator,evaluator,skeptic}.md` and
      `scripts/concertino/persist-evidence.sh` (+ updated `scripts/concertino/README.md`) match
      the edited `core/` sources.
- [x] 4.2 Diff the sync output against what's expected (no unrelated files should change) and
      commit the rendered copies alongside the `core/` edits.

## 5. Tests

- [x] 5.1 Add `test/scripts/persist-evidence.test.sh` (pattern-matched on
      `test/scripts/emit-event.test.sh`): a fresh throwaway repo + worktree, persist a file from
      inside the worktree, assert the `READY ref=` path exists under the main checkout's
      `.concertino/runs/<ticket>/evidence/`, assert it still exists and is readable after
      deleting the worktree directory, assert a missing source produces `FAIL` + non-zero exit
      and no `READY` line, assert re-running is idempotent.
- [x] 5.2 Add the new suite to `package.json`'s `test` script (same `&&`-chained pattern as the
      other `test/scripts/*.test.sh` entries).
- [x] 5.3 Run the full `npm test` and confirm the whole suite (including the pre-existing
      `test/drilldown.test.js` evidence-panel tests, which are already green today) still
      passes.

## 6. Verification

- [x] 6.1 End-to-end smoke: in a scratch worktree, run through a fake Planning phase, invoke
      `persist-evidence.sh` + `emit-event.sh evidence` by hand for a dummy `proposal.md`, then
      run `cleanup.sh --phase4` on that worktree and confirm `cat` on the emitted `ref` still
      works.
- [x] 6.2 Confirm no `lib/ui/*.js` file changed (this is an emission-only change; the reducer
      and drill-down already handle `evidence` events).
