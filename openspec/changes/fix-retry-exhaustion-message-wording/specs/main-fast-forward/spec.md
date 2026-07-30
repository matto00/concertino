## MODIFIED Requirements

### Requirement: An unresolvable fast-forward escalates with a bounded retry/skip loop
`cleanup.sh --phase4` SHALL call `emit-event.sh escalation --await` and block on the result
whenever it cannot fast-forward local `main` cleanly (dirty tree, diverged base, or the
fast-forward attempt itself failing unexpectedly), passing `ticket=<the ticket being cleaned
up>`, a `question=` naming the reason, and `options=retry,skip`. An answer of exactly
`retry` SHALL cause the fast-forward algorithm to run once more; any other answer (including a
free-text reply, or a timeout) SHALL be treated as `skip`. Across one `cleanup.sh --phase4`
invocation, this SHALL escalate and retry at most once more (two total fast-forward attempts) —
a second unresolved failure SHALL log a note and proceed without re-escalating. That note SHALL
distinguish what the retry actually established: when the retried attempt itself could not fetch
the remote or resolve the local base branch (i.e. it landed on `fetch-failed` or
`no-local-base`, never reaching a local-vs-remote comparison), the note SHALL state that the
base state could not be determined and why, rather than asserting that local `main` remains
behind; when the retried attempt did complete its comparison and found the tree still dirty, the
base still diverged, or an actual merge/update-ref attempt failed (`dirty`, `diverged`, or
`failed`), the note SHALL keep stating that local `main` remains behind, as today. Regardless of
outcome, the rest of Phase 4 (already-completed worktree removal, and whatever the caller does
afterward) SHALL proceed — `cleanup.sh --phase4` SHALL NOT fail or exit non-zero solely because
the fast-forward could not complete.

#### Scenario: A retry answer re-attempts and succeeds
- **WHEN** the fast-forward escalates due to a dirty tree, the human stashes their work out of
  band and answers `retry`
- **THEN** `cleanup.sh` re-runs the fast-forward algorithm, and if the tree is now clean and still
  a strict ancestor, the fast-forward completes silently and `cleanup.sh --phase4` still prints
  its normal `READY cleaned worktree=...` line

#### Scenario: A skip answer proceeds without touching main
- **WHEN** the fast-forward escalates and the human answers `skip` (or any reply other than
  exactly `retry`, or the escalation times out)
- **THEN** local `main` is left exactly as it was, and `cleanup.sh --phase4` still completes and
  prints its normal `READY cleaned worktree=...` line

#### Scenario: A second consecutive confirmed-behind failure does not escalate a third time
- **WHEN** the human answers `retry` and the re-attempted fast-forward completes its comparison
  and still fails to resolve cleanly (still dirty, still diverged, or an unexpected
  merge/update-ref failure)
- **THEN** `cleanup.sh --phase4` logs a note that `main` remains behind, includes the reason when
  one is available, and completes without raising a second escalation

#### Scenario: A retry whose own fetch fails reports an unknown state, not "behind"
- **WHEN** the human answers `retry` and the re-attempted fast-forward cannot fetch the
  configured remote (or cannot resolve the local base branch), so it never reaches a
  local-vs-remote comparison
- **THEN** `cleanup.sh --phase4` logs a note stating that whether local `main` is behind could
  not be determined, states the reason (the fetch/lookup did not succeed), does NOT state that
  `main` remains behind, and completes without raising a second escalation
