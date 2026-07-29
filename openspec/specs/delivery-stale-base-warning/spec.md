# delivery-stale-base-warning Specification

## Purpose
Warn, at the delivery gate, when a run's branch has fallen behind the fetched remote base since
setup — naming the commits it's behind by, on a best-effort basis, without ever blocking delivery
or raising a blocking escalation.
## Requirements
### Requirement: assert-phase.sh delivery warns when the fetched remote base has moved
`core/scripts/assert-phase.sh delivery` SHALL, after its existing pass/fail checks (branch pushed,
no uncommitted changes), perform a best-effort comparison between the run's branch and the
configured base remote/branch (`CONCERTINO_BASE_REMOTE`/`CONCERTINO_BASE_BRANCH`, same defaults as
`setup-worktree.sh`: `origin`/`main`). It SHALL fetch that remote/branch, compute the merge-base of
`HEAD` and the fetched tip, and, when the fetched tip is not equal to that merge-base (i.e. the
fetched remote carries at least one commit the branch's base doesn't), print a line to stderr
naming the number of commits the branch's base is behind by and up to 5 of those commits (most
recent first, short SHA + subject line), with a `(+N more)` suffix when there are more than 5. This
check SHALL NOT set the gate's outcome to failing, SHALL NOT change the gate's exit code, and SHALL
NOT alter the existing `PASS delivery` stdout line on success.

#### Scenario: Branch's base is behind the fetched remote
- **WHEN** `assert-phase.sh delivery` runs, the branch's existing checks (pushed, clean) pass, and
  the fetched `origin/main` carries 3 commits the branch's merge-base with it does not
- **THEN** the gate still exits 0 and prints `PASS delivery`, and a warning naming "3" and the 3
  commits (short SHA + subject) is printed to stderr

#### Scenario: More than 5 commits behind truncates the list
- **WHEN** the fetched remote base carries 12 commits the branch's merge-base with it does not
- **THEN** the warning names "12" as the total count, lists the 5 most recent commits, and appends
  `(+7 more)`

### Requirement: A current base produces no output for this check
`assert-phase.sh delivery` SHALL NOT print anything for this check when the branch's merge-base
with the fetched remote base equals the fetched remote tip (the branch's base is current, including
the case where the branch has since merged the base into itself).

#### Scenario: Base is current
- **WHEN** `assert-phase.sh delivery` runs and the branch's merge-base with the freshly fetched
  `origin/main` equals `origin/main`'s fetched tip
- **THEN** no warning is printed for this check, and the gate's output is unchanged from before this
  check existed

### Requirement: The check degrades silently on any environmental failure
`assert-phase.sh delivery` SHALL NOT print a warning, raise an error, or change the gate's exit code
for this check when the fetch fails (e.g. offline, remote unreachable), when the configured base
branch/remote cannot be resolved after fetching, or when any git command this check depends on fails
unexpectedly. In every such case the gate SHALL proceed exactly as if this check did not exist.

#### Scenario: Fetch fails
- **WHEN** `assert-phase.sh delivery` runs and fetching the configured base remote/branch fails
  (e.g. no network)
- **THEN** no warning is printed for this check, no error is raised, and the gate's existing
  pass/fail outcome is unaffected

#### Scenario: Base ref cannot be resolved after fetch
- **WHEN** the fetch itself succeeds but the configured base remote/branch does not resolve to a
  ref afterward
- **THEN** no warning is printed for this check and the gate proceeds unaffected

### Requirement: A stale base emits a gate.warning telemetry event
When `assert-phase.sh delivery` prints the stale-base warning described above, it SHALL also emit a
best-effort `gate.warning` event via `emit-event.sh` carrying the ticket, `gate=phase:delivery`, the
behind-count, the base branch and remote names, and the (up to 5) short commit SHAs. This event
SHALL NOT be emitted when the base is current or when the check is skipped for an environmental
reason, and a failure to emit it SHALL NOT affect the gate's exit code (`emit-event.sh` already
exits 0 in normal mode).

#### Scenario: Telemetry emitted alongside a stale-base warning
- **WHEN** `assert-phase.sh delivery` detects the branch's base is 3 commits behind the fetched
  remote and prints the stderr warning
- **THEN** a `gate.warning` event is appended to the run's event log carrying `behind=3` and the
  base/remote/commit details

#### Scenario: No telemetry when the base is current
- **WHEN** `assert-phase.sh delivery` runs and the base is current
- **THEN** no `gate.warning` event is emitted

