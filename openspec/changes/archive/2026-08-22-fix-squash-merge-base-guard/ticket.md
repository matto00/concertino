# CON-129: Delivery squash can stage a mass revert when the base advances mid-run

## Description

During HEL-548's Delivery phase in the helio repo (2026-08-21), the squash step's
`git reset --soft origin/main` staged an 85-file revert of a sibling run's
freshly-merged work (HEL-772, merged to `main` minutes earlier while HEL-548 was
still in its Execution/Evaluation loop). The staged changeset included `DESIGN.md`
and `App.css`.

The orchestrator caught it by reading the staged file list before committing,
restored, and squashed against the true merge-base instead. Nothing was lost. It
was caught by attentiveness, not by any guard.

### Why this is Urgent despite being caught

Had it committed, the outcome would have been near-invisible:

- The PR diff would show a large, plausible-looking changeset — the run
  legitimately touches many files.
- CI would pass, because reverting a merged, self-consistent change leaves a
  self-consistent tree.
- Review gates would examine the run's own work, which is correct, and have no
  reason to question files the run never intended to touch.
- `main` would silently lose a merged feature, discovered later as "this
  shipped and then stopped existing."

The failure mode is worst precisely when parallel delivery is working well: the
more runs merging concurrently, the wider the window in which any run's
`origin/main` reference has moved since it branched.

### Root cause

The squash step resets against `origin/main` as it is at squash time, not
against the commit the branch actually diverged from. When the base has
advanced, everything merged in between becomes staged deletions/reversions.
The step has no guard comparing the reset target to the branch's real
merge-base, and no check on the staged file count against the run's own
declared touched-file list.

### Suggested directions

- Reset against the true merge-base (`git merge-base HEAD origin/main`) rather
  than `origin/main` directly.
- Guard on the staged set against `files-modified.md` — the executor's own
  declaration of what it touched. If the staged file list exceeds that set,
  stop and report rather than commit.
- Detect base advancement explicitly. If `origin/main` has moved since the
  branch point, require an explicit rebase step before squashing rather than
  silently absorbing the difference.
- At minimum, print the staged file count and list before committing.

## Acceptance Criteria

- [ ] The squash step cannot stage changes to files outside the run's own
      touched-file set without stopping and reporting.
- [ ] A base that advanced mid-run is detected explicitly rather than absorbed
      into the squash.
- [ ] Reproducing the scenario — branch, let `origin/main` advance with an
      unrelated merge, then squash — no longer produces a revert of the
      intervening work.
- [ ] The guard surfaces loudly; "staged more than expected" must never be a
      silent outcome.

## Related

Same session, same repo: HEL-764 (`cleanup.sh` intermittently and silently
failing to fast-forward `main`) is the same family — a git step that does the
wrong thing without saying so. Both were caught only because an orchestrator
verified state independently instead of trusting the script's exit. **Do not
scope-creep into HEL-764 — separate ticket.**

## Verification standard (orchestrator directive, binding on executor/evaluator/skeptic)

- The acceptance test must REPRODUCE the scenario in a THROWAWAY repo: branch,
  let `origin/main` advance with an unrelated merge, then squash — and show
  the revert no longer occurs. Red-before-green, demonstrated. NEVER run this
  against `/home/matt/Development/concertino` or `/home/matt/Development/helio`.
- Before any experiment, state what it would do to a real repository if the
  guard were absent.
- A guard that cannot fire is worse than none. Prove each guard goes red by
  removing the fix, not by observing a pass.
- Beware self-referential tests: a prior skeptic caught a selftest asserting
  against an INLINE COPY of a pattern rather than the real script, so
  reverting the real line still passed. Couple assertions to the actual file
  under test and prove it by reverting only that file.
- "Staged more than expected" must never be a silent outcome — this is an
  explicit acceptance criterion.

## Scope guardrails

- Do NOT scope-creep into: CON-128 (stale-global root cause REFUTED — no
  version-stamping), CON-131 (cleanup.sh exits 0 having done nothing when git
  ops fail), CON-132, CON-121, HEL-764 (cleanup.sh fast-forward
  false-positives — same family, separate ticket).
- Recently landed CON-133 (merged as 6699214): ported HEL-805's `GIT_*`-prefix-
  strip hardening into `core/` templates (`core/scripts/lib/git-child-env.sh` +
  selftest, four call sites), added `listFilesRecursive` to
  `lib/cli/{shared,emit,doctor,resolve-core}.js`, introduced
  `CONCERTINO_CLEANUP_SKIP_SYNC`. Do not regress any of this. The squash logic
  lives in the Delivery section of the orchestrator flow (today executed
  inline by the orchestrator, per `concertino-orchestrator.md` Phase 3 step 1)
  — check whether it should become its own canonical script under
  `core/scripts/` (consistent with the "canonical procedure scripts" pattern
  used by `setup-worktree.sh`/`cleanup.sh`/`assert-phase.sh`) rather than
  inline prose steps, since this is exactly the kind of git procedure that
  benefits from a real, testable script instead of being recalled from a
  markdown prompt.
