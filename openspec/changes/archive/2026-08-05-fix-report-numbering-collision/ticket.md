# CON-81: Fold-in reopen lets a fresh evaluator/skeptic clobber the prior sub-run's historical review reports

## Description

When a `fold-in` follow-up reopens an already-archived change, the second sub-run's evaluator and skeptic write their reports to the **same filenames** the first sub-run already used, overwriting merged review history in place. Nothing in the reopen step guards against it.

### Mechanism

* Review reports are numbered off per-run counters, not off what already exists on disk: the evaluator writes `WORKTREE_PATH/<change-dir>/evaluation-<CYCLE>.md` (`core/roles/evaluator.md`, and the mirrored `.claude/agents/concertino-evaluator.md`), and the skeptic's `skeptic-design-<N>.md` / `skeptic-final-<N>.md` are numbered the same way.
* A `fold-in` answer "reopens Execution for the added scope (via a freshly re-created worktree, since `cleanup.sh --phase4` already removed the original one)" — `core/roles/orchestrator.md`, the one-shot follow-up escalation step. The re-created worktree restores the archived change directory, which **already contains** `evaluation-1.md`, `skeptic-final-1.md`, `skeptic-final-2.md`, … from the first sub-run.
* The new sub-run starts its counters fresh (`CYCLE: 0` → 1). So its first evaluator report is written as `evaluation-1.md` — directly over the first delivery's. `persist-evidence.sh` then re-persists the clobbered file to `.concertino/runs/<TICKET>/evidence/`, propagating the overwrite there too.

Neither the reopen step nor the report-writing contract checks whether the target filename already exists.

### Impact

Silent replacement of the review evidence for an already-merged PR. The audit trail that justified the first delivery — what the evaluator checked, what the skeptic REFUTEd and why — is what gets destroyed, and it is destroyed precisely for tickets that took two deliveries, i.e. the ones with the most review history worth keeping.

Partly mitigated: the change dir is git-tracked, so a clobber is recoverable from history and would surface as an unexpected modified file in the follow-up PR's diff. But it depends on someone noticing.

### Observed

Hit on CON-71 (2026-08-05) during the PR #64 fold-in. The reopened evaluator/skeptic overwrote PR #63's `evaluation-1.md` and `skeptic-final-1.md` in place. The orchestrator caught it before committing, restored the originals from git history, and renumbered the new sub-run's reports to `evaluation-2.md` / `skeptic-final-3.md`. Both generations are intact in the merged archive at `openspec/changes/archive/2026-08-05-shared-widget-layer/` — but only because it was noticed by hand.

## Scope

* Make report numbering collision-proof on reopen. Continue the sequence from the highest existing `evaluation-*.md` / `skeptic-design-*.md` / `skeptic-final-*.md` in the change dir rather than restarting from the run-local counter — the orchestrator's manual fix (renumbering to `evaluation-2.md` / `skeptic-final-3.md`) is the behaviour to make automatic.
* Failing that, or in addition: make writing a review report refuse to overwrite an existing file outright, so a collision is a loud failure rather than silent data loss.
* Apply the same guard to `persist-evidence.sh`'s copy into `.concertino/runs/<TICKET>/evidence/`, so a re-persist can't overwrite a prior sub-run's persisted report either.
* Keep `core/roles/*.md` and their rendered `.claude/agents/*.md` counterparts in sync — the filename contract is stated in both.

## Acceptance Criteria

* A fold-in sub-run on a reopened archived change writes its reports to fresh filenames; no prior-sub-run report is modified or deleted.
* A third sub-run behaves the same — numbering continues, it does not reset.
* The evidence copies under `.concertino/runs/<TICKET>/evidence/` retain one entry per report across all sub-runs.
* If a collision somehow still arises, it fails loudly rather than overwriting.
* Single-sub-run runs are unaffected: numbering still starts at 1 and reads identically to today.

## Related

* CON-51 (follow-up triage — fold-in vs. standalone vs. discard, which introduced this reopen path)
* CON-23 (`persist-evidence.sh` basename collision — same class of bug, different layer)
