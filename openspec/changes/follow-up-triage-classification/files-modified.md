- `core/scripts/triage-followup.sh` — new canonical script: parses `description=`/`files=`/`ac_relevant=`/`effort=`/`worktree=`/optional `base=` (defaulting to `${CONCERTINO_BASE_BRANCH:-main}`), computes file overlap via `git -C <worktree> diff --name-only <base>...HEAD`, applies the fixed decision table, and prints a plain-text `context=`-ready block (or `FAIL <reason>` + non-zero exit on bad input).
- `scripts/concertino/triage-followup.sh` — mirrored copy of the above, produced by this repo's own `concertino sync` step (verified byte-identical to `core/scripts/triage-followup.sh`).
- `core/roles/orchestrator.md` — added the new "Triaging a suggested follow-up" shared sub-procedure (identify description/files, state ac_relevant/effort, run `triage-followup.sh`, raise the escalation, branch on fold-in/standalone/discard, with the fold-in re-planning requirement — ticket.md/proposal.md/design.md/tasks.md revision, `openspec validate`, fresh design-gate `CONFIRM`); wired it into both existing call sites (Phase 3 Delivery's non-blocking-suggestion presentation, Phase 4 step 4's post-cleanup observation), replacing the old bare `question=`/`options=` call and its "no kind fits" reasoning at the Phase 4 site.
- `test/scripts/triage-followup.test.sh` — new shell test suite covering the `followup-triage` spec's scenarios (high overlap + small effort → fold-in; `ac_relevant=yes` → fold-in regardless; large effort → standalone; partial/none overlap → standalone; missing required field → `FAIL` + non-zero exit + empty stdout; `files=unknown` → `unknown` overlap, never treated as overlap; out-of-enum `ac_relevant`/`effort` → `FAIL`; non-git-repo `worktree=` → `FAIL`; `base=` defaulting from `CONCERTINO_BASE_BRANCH`) against real throwaway git repos, not mocked git state.
- `package.json` — added `test/scripts/triage-followup.test.sh` to the `test` script, immediately after the existing `gather-escalation-context.test.sh` entry.
- `openspec/changes/follow-up-triage-classification/` — this change's own planning artifacts (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, spec deltas, design-gate skeptic reports) plus `tasks.md`'s checkboxes marked complete as each task finished; no material spec-delta edits were needed (verified against the implementation per task 3.1).
- `core/scripts/README.md` / `scripts/concertino/README.md` — added `triage-followup.sh` to the script table (fold-in from the evaluator/skeptic's non-blocking note; mirrored via this repo's `concertino sync` step).

## Final-gate fix (skeptic round 1 REFUTE, `skeptic-final-1.md`)

- `openspec/changes/follow-up-triage-classification/design.md` — §Decisions/4's fold-in steps renumbered/expanded (1-6): step 1 now states explicitly that the change directory must be moved back from its archive location before editing (both call sites reach this step post-archive); step 6 (re-archive) now states the `specs/` delta collision a naive second `openspec archive` hits and the two-path fix (`--skip-specs` when no new spec requirement was added; prune the delta to just the new scope and re-archive normally otherwise), matching what `core/roles/orchestrator.md` now documents.
- `core/roles/orchestrator.md` — the "Triaging a suggested follow-up" sub-procedure's `fold-in` branch expanded from 3 to 6 numbered sub-steps: (1) move the change directory back from archive, (2) revise the plan, (3) re-validate, (4) re-run the design gate, (5) execute the added scope, (6) re-archive with the `specs/`-collision fix (`--skip-specs` vs. prune-and-re-archive, explicitly tied to whether step 2 introduced a new/modified spec requirement). Re-synced so `.claude/agents/concertino-orchestrator.md` reflects it.

### Root cause / probe / probe output (systematic-debugging.md)

- **Root cause:** the documented fold-in procedure's re-archive step called
  `openspec archive <CHANGE_NAME> --yes` unconditionally after the added
  scope shipped, but the change's `specs/<capability>/spec.md` delta files
  still contained the `## ADDED Requirements` blocks the *first* archive
  pass (Phase 3 step 2) had already merged into the canonical
  `openspec/specs/`; `openspec archive` re-processes those same delta files
  on a second pass and aborts when a requirement header it tries to add
  already exists in the canonical spec.
- **Probe:** in a disposable clone of this worktree, moved the real archived
  `openspec/changes/archive/2026-08-01-force-escalation-ticket-ambiguity`
  back to `openspec/changes/force-escalation-ticket-ambiguity/` (unmodified —
  the exact state the documented step 1 leaves it in) and ran
  `openspec archive force-escalation-ticket-ambiguity --yes`.
- **Probe output (confirms the cause, reproduces the skeptic's finding):**
  ```
  escalation-context ADDED failed for header "### Requirement:
  gather-escalation-context.sh formats structured context for a sixth kind,
  ticket-ambiguity" - already exists
  Aborted. No files were changed.
  ```
- **Fix verified (both paths, same disposable clone, real `openspec` CLI):**
  - `openspec archive force-escalation-ticket-ambiguity --yes --skip-specs`
    → `Change 'force-escalation-ticket-ambiguity' archived as
    '2026-08-01-force-escalation-ticket-ambiguity'.` (exit 0) — the
    no-new-requirement path.
  - For the launchpad-queue-status-action change, rewrote its
    `specs/launchpad-queue-status/spec.md` delta to contain only one new
    fixture requirement (pruning the 4 already-merged ones), then ran
    `openspec archive launchpad-queue-status-action --yes` (no
    `--skip-specs`) → succeeded, and
    `openspec/specs/launchpad-queue-status/spec.md`'s requirement count went
    from 4 to 5, containing exactly the new fixture requirement — the
    new-requirement path merges correctly once the stale duplicates are
    pruned first.

## Manual verification (systematic-debugging.md / task 5.1 evidence)

Not a bug fix — `triage-followup.sh` is new code with no prior failing symptom
to reproduce. Per verification-before-completion.md, the completion claim
below is backed by:
- The full `test/scripts/triage-followup.test.sh` suite (37 assertions, all
  passing) run against throwaway git repos with a real committed diff, not
  mocked git state.
- A manual run against this worktree's own real diff (task 5.1): after
  committing this change's work, `triage-followup.sh` was run with
  `files=core/scripts/triage-followup.sh` and `base=origin/main` (the
  branch's true merge-base — this worktree's local `main` ref happens to be
  stale relative to `origin/main`, an unrelated pre-existing condition; using
  `origin/main` here avoids that noise for a clean manual check). It correctly
  reported `overlap: high` and `recommendation: fold-in` for a file this
  change actually touches — see the executor's return summary for the exact
  command and output.
