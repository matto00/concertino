## 1. `triage-followup.sh` script

- [x] 1.1 Create `core/scripts/triage-followup.sh`: parse `description=`,
      `files=`, `ac_relevant=`, `effort=`, `worktree=`, optional `base=`
      (defaulting to `${CONCERTINO_BASE_BRANCH:-main}` when omitted — the
      same convention already used in `core/scripts/cleanup.sh`/
      `core/scripts/assert-phase.sh` — matching
      `resolve-speed.sh`/`gather-escalation-context.sh`'s k=v parsing
      convention — split on the first `=` only).
- [x] 1.2 Validate inputs: required fields present, `ac_relevant` in
      `yes|no`, `effort` in `small|large`, `worktree` is a valid git repo
      (`git -C <worktree> rev-parse --git-dir` succeeds). On any failure,
      `FAIL <reason>` to stderr, nothing on stdout, non-zero exit.
- [x] 1.3 Compute the current change's modified files via
      `git -C <worktree> diff --name-only <base>...HEAD`.
- [x] 1.4 Compute overlap (`high`/`partial`/`none`/`unknown`) between
      `files=` and that list, per the spec's stated thresholds (`files=unknown`
      always yields `unknown`, never treated as overlap).
- [x] 1.5 Apply the fixed decision table (see design.md §Decisions/1) to
      produce `recommendation=fold-in|standalone`.
- [x] 1.6 Print the structured stdout block: all four inputs, computed
      overlap, recommendation, the one-line rule that fired, and the
      "discard is always a valid choice" note. Exit 0.
- [x] 1.7 Sync `core/scripts/triage-followup.sh` to
      `scripts/concertino/triage-followup.sh` (via this repo's own sync
      step — see design.md §Context on `core/` being canonical).

## 2. Orchestrator role: shared triage sub-procedure

- [x] 2.1 Add a new named sub-procedure to `core/roles/orchestrator.md`,
      "Triaging a suggested follow-up," documenting: identify
      `description`/`files`; state `ac_relevant`/`effort`; run
      `triage-followup.sh`; raise `emit-event.sh escalation --await` with
      `context=<script output>` (or omitted on script failure, per the
      existing `gather-escalation-context.sh` fallback convention) and
      `options=fold-in,standalone,discard`.
- [x] 2.2 Update Phase 3 Delivery's non-blocking-suggestion presentation to
      invoke this sub-procedure, by name, for suggestions naming discrete
      additional work (not one-line style nits), before presenting them for
      approval.
- [x] 2.3 Update Phase 4 step 4 (post-cleanup observation) to invoke this
      sub-procedure, by name, replacing the current bare
      `question=`/`options=` call and its "no kind fits" reasoning.
- [x] 2.4 Document the `fold-in` handling at both call sites: extend
      `ticket.md`'s acceptance criteria plus `proposal.md`/`design.md`/
      `tasks.md` for the added scope, re-run `openspec validate`, re-run the
      design-gate skeptic fresh, and only on
      `CONFIRM` proceed into/resume Execution for the added scope (Phase 3
      call site) or reopen Execution instead of running Phase 4 cleanup
      (Phase 4 call site) — bounded by the run's already-resolved
      `SKEPTIC_DESIGN_ROUNDS`.
- [x] 2.5 Document `standalone` handling: file a new Linear ticket via
      `mcp__linear__save_issue` (no `id`) summarizing the suggestion and
      linking to the current ticket; note the new ticket ID in the summary.
- [x] 2.6 Document `discard` handling: no further action beyond a summary
      note.
- [x] 2.7 Run this repo's sync step so `.claude/agents/concertino-orchestrator.md`
      reflects the updated `core/roles/orchestrator.md`.

## 3. Spec archival prerequisites

- [x] 3.1 Confirm `openspec/changes/follow-up-triage-classification/specs/followup-triage/spec.md`
      and `.../specs/orchestrator-turn-discipline/spec.md` accurately describe
      the implementation once 1-2 are done (adjust either the code or the
      spec delta so they match exactly — the spec is the contract the
      evaluator/skeptic check the code against). Verified line-by-line
      against the implemented script and role prose: no spec edits were
      needed — both deltas' normative text and scenarios match exactly.

## 4. Tests

- [x] 4.1 Add `test/scripts/triage-followup.test.sh` covering: high-overlap
      + small-effort → fold-in; ac_relevant=yes → fold-in regardless of
      other inputs; large effort → standalone; missing required field →
      `FAIL` + non-zero exit + empty stdout; `files=unknown` → `unknown`
      overlap, never treated as overlap. Also added: partial/none overlap,
      an out-of-enum `ac_relevant`/`effort` value, a non-git-repo
      `worktree=`, and `base=` defaulting from `CONCERTINO_BASE_BRANCH`
      (closing the non-blocking gap both design-gate rounds noted).
- [x] 4.2 Add the new test file to `package.json`'s `test` script (append
      after the existing `gather-escalation-context.test.sh` entry, matching
      the existing script-list convention).
- [x] 4.3 Run `npm test` and confirm the full existing suite plus the new
      test file pass.

## 5. Verification

- [x] 5.1 Manually exercise `triage-followup.sh` against this worktree's own
      diff (a file already touched by this change) to confirm `high`
      overlap is detected correctly against real git state, not just the
      unit tests' fixtures. Confirmed: `files=core/scripts/triage-followup.sh
      base=origin/main` (this worktree's local `main` ref is stale relative
      to `origin/main` — an unrelated pre-existing condition, so
      `origin/main` was used for a clean check) reported `overlap: high`,
      `recommendation: fold-in`, exit 0.
- [x] 5.2 Re-run `openspec validate --change follow-up-triage-classification`
      clean. Confirmed: `openspec validate follow-up-triage-classification
      --strict` → "Change 'follow-up-triage-classification' is valid".

## 6. Final-gate fix (skeptic round 1 REFUTE — `specs/` re-archive collision)

- [x] 6.1 Fix `design.md` §Decisions/4 (items 1-2, renumbered 1-6) and
      `core/roles/orchestrator.md`'s fold-in steps: explicitly document that
      the change directory must be moved back from its archive location
      before editing (both call sites reach this step post-archive), and
      that re-archiving afterward requires either `--skip-specs` (no new
      spec requirement was added) or pruning the change's `specs/` delta
      files to just the newly-added scope before a normal re-archive (a new
      spec requirement was added) — the orchestrator must state explicitly
      which applies, never defaulting to `--skip-specs` unconditionally.
      Verified both paths end-to-end in a scratch clone against the same two
      real archived changes the skeptic used
      (`force-escalation-ticket-ambiguity`, `launchpad-queue-status-action`):
      `--skip-specs` succeeds cleanly when no new requirement is added;
      pruning the delta to one new requirement and re-archiving normally
      (no `--skip-specs`) merges exactly that one requirement into the
      canonical spec (`launchpad-queue-status/spec.md`'s requirement count
      went 4 → 5, containing only the new one).
- [x] 6.2 Fold in both non-blocking notes: updated `design.md`'s stale "in
      the *current* change's `openspec/changes/<CHANGE_NAME>/` directory"
      prose to describe the archive/restore handling; added
      `triage-followup.sh` to `core/scripts/README.md`'s script table
      (mirrored to `scripts/concertino/README.md` via this repo's sync step).
- [x] 6.3 Re-run `openspec validate --change follow-up-triage-classification
      --strict` clean, re-sync so `.claude/agents/concertino-orchestrator.md`
      reflects the fix, and re-run `npm test` — all green.
