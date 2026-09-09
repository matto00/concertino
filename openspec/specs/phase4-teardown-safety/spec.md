# phase4-teardown-safety Specification

## Purpose
Guarantee mechanically that Phase-4 teardown never destroys a worktree while the auditor — bracketed by a script-owned lease that no role-document instruction has to be followed to hold — is still working inside it, and complement that guarantee with a best-effort process-cwd probe for any other live holder, so a run cannot lose evidence it actually produced to a race between an out-of-band merge observation and a still-running auditor.

## Requirements

### Requirement: The auditor's lifetime is bracketed by a script-owned lease

`check-merge-readiness.sh` SHALL acquire a lease for the run at `.concertino/runs/<TICKET_ID>/locks/auditor.lease` in the main checkout, idempotently on every invocation including the CI-`PENDING` re-invocations the auditor is required to make, and `emit-event.sh` SHALL release that lease on recognising a `verdict` invocation with `role=auditor`, for every terminal verdict value. The lease SHALL be acquired and released by these scripts themselves, so that no role document instruction has to be followed for the bracket to hold. The lease SHALL record the acquiring script, the ticket, the absolute worktree path it was given, the acquiring pid, and a timestamp. A run that never invokes `check-merge-readiness.sh` SHALL never acquire a lease.

#### Scenario: the lease is taken before any merge can occur

- **WHEN** `check-merge-readiness.sh` runs for a ticket
- **THEN** the auditor lease for that ticket exists afterwards, regardless of whether the readiness checks passed

#### Scenario: a lowercase ticket id is released by the canonical release path

- **WHEN** a lease is acquired with a non-canonically-cased ticket id and the auditor's `verdict` event is later emitted for that ticket
- **THEN** the lease is released, and teardown proceeds

#### Scenario: a malformed ticket id creates no lease

- **WHEN** `check-merge-readiness.sh` is invoked with a ticket id that fails its shape validation
- **THEN** no lease is created, rather than one the release path could never address

#### Scenario: repeated acquisition during CI-pending re-invocation

- **WHEN** `check-merge-readiness.sh` is re-invoked after returning `PENDING`
- **THEN** acquisition succeeds again without error and the lease remains held

#### Scenario: the lease is released even when the event write is skipped

- **WHEN** an auditor `verdict` invocation is recognised but the underlying event write is skipped or fails internally
- **THEN** the lease is still released, and the call still exits successfully

#### Scenario: every terminal verdict releases the lease

- **WHEN** `emit-event.sh verdict role=auditor verdict=<MERGE|ESCALATE|BLOCKER|ESCALATION-RAISE>` is emitted for that ticket
- **THEN** the lease no longer exists

#### Scenario: a non-auditor verdict does not release the lease

- **WHEN** a `verdict` event is emitted with a role other than `auditor`
- **THEN** any held auditor lease is left in place

#### Scenario: a run without agent-merge never takes a lease

- **WHEN** a delivery completes without ever invoking `check-merge-readiness.sh`
- **THEN** no auditor lease exists and Phase-4 teardown is unaffected

### Requirement: The lease root is resolved by the shared helper, and an unresolvable root fails closed

The shared lease helper SHALL resolve the run root itself, by the same main-checkout resolution both writers use, rather than accepting a root from its caller — in particular `cleanup.sh` SHALL NOT supply its own cwd-relative repository root, which can disagree. `cleanup.sh` SHALL identify a held lease by matching the worktree path recorded in the lease against the worktree it is about to destroy, and SHALL NOT key that lookup on an inferred ticket id. Where the run root cannot be resolved at all, `cleanup.sh` SHALL refuse rather than proceed, and SHALL report that the lease could not be checked.

#### Scenario: the lease is found regardless of the checking process's working directory

- **WHEN** the lease is acquired from one working directory and checked from another, including a working directory inside the worktree
- **THEN** the held lease is still detected and teardown refuses

#### Scenario: the lease is found when the ticket id argument is omitted

- **WHEN** `cleanup.sh --phase4` is invoked without the optional ticket-id argument, on a worktree whose directory basename is not a ticket id, while a lease recording that worktree is held
- **THEN** the held lease is still detected and teardown refuses

#### Scenario: an unresolvable run root refuses rather than proceeding

- **WHEN** the run root cannot be resolved
- **THEN** `cleanup.sh --phase4` exits non-zero reporting that the lease could not be checked, and the worktree still exists

### Requirement: `cleanup.sh --phase4` refuses to tear down while the auditor lease is held

`cleanup.sh --phase4` SHALL check for a held auditor lease before invoking `git worktree remove`, and SHALL exit non-zero without having removed the worktree, deleted any branch, or attempted the base fast-forward when one is held. The lease check SHALL NOT be subject to the settle window applied to the process probe: a held lease is a durable statement that an agent's bracketed lifetime has not closed, and SHALL refuse immediately.

#### Scenario: an auditor was killed before emitting its verdict

- **WHEN** `cleanup.sh --phase4` runs after `check-merge-readiness.sh` acquired a lease that was never released
- **THEN** the script exits non-zero, the worktree directory still exists, and the failure output names the held lease, its recorded pid and its timestamp

#### Scenario: teardown proceeds once the verdict has been emitted

- **WHEN** `cleanup.sh --phase4` runs after the auditor's verdict event released the lease
- **THEN** the lease check passes and teardown proceeds

#### Scenario: refusal leaves the run fully retryable

- **WHEN** the guard refuses for any reason
- **THEN** no branch has been deleted and no base fast-forward has been attempted, and a later re-run can complete teardown normally

#### Scenario: refusal is reported on the machine-parseable summary line

- **WHEN** the guard refuses
- **THEN** the `RESULT` line reports the worktree field as not removed, consistent with the script's existing failure reporting

### Requirement: A complementary process probe catches live holders of the worktree directory

`cleanup.sh --phase4` SHALL additionally enumerate processes whose working directory resolves to `WORKTREE_PATH` or a path beneath it, and refuse when any remain, reporting each holder's pid and command line. This probe SHALL be documented as best-effort and complementary rather than load-bearing: it does not detect an agent that is live but momentarily holds no process inside the worktree. Where the probe cannot be performed on the host platform, it SHALL report no holders and allow teardown rather than blocking.

#### Scenario: a live process holds the worktree as its cwd

- **WHEN** `cleanup.sh --phase4` runs while a process has `WORKTREE_PATH` as its working directory and no lease is held
- **THEN** the script exits non-zero, the worktree still exists, and the failure output names the holding pid and its command line

#### Scenario: no holder and no lease

- **WHEN** `cleanup.sh --phase4` runs with neither a lease nor a cwd holder
- **THEN** teardown proceeds exactly as it does today

#### Scenario: the probe cannot run on this platform

- **WHEN** per-process working directories cannot be enumerated on the host
- **THEN** the probe reports no holders and teardown proceeds, rather than refusing

### Requirement: The process probe excludes only the literal ancestor pid chain

The probe SHALL exclude the cleanup process itself and the literal chain of its ancestors (self, then PPid, then that pid's PPid, to pid 1), and SHALL NOT exclude siblings or other descendants of those ancestors. The probe SHALL tolerate processes disappearing mid-scan without aborting.

#### Scenario: the guard never refuses on its own process tree

- **WHEN** `cleanup.sh --phase4` is invoked from a shell whose working directory is inside `WORKTREE_PATH`
- **THEN** the guard does not count the cleanup process or its ancestors as holders

#### Scenario: a sibling of an excluded ancestor is still detected

- **WHEN** a holding process shares a common ancestor with the cleanup process but is not itself on its ancestor chain
- **THEN** that process is reported as a holder

#### Scenario: a process exits mid-scan

- **WHEN** a process disappears while the probe is enumerating working directories
- **THEN** the probe completes without error

### Requirement: The process probe is bounded by a settle window

The probe SHALL re-probe at a short interval up to a hard upper bound, and SHALL refuse only if the holder set is non-empty at the moment that bound elapses. It SHALL NOT wait beyond the bound.

#### Scenario: a holder exits during the settle window

- **WHEN** the only cwd holder terminates shortly after `cleanup.sh --phase4` begins its check
- **THEN** the holder set is empty at the bound and teardown proceeds without refusing

#### Scenario: a holder persists for the whole window

- **WHEN** a holder is still live when the bound elapses
- **THEN** the guard refuses, rather than waiting further

### Requirement: The refusal is overridable by an explicit operator flag

`cleanup.sh` SHALL accept a `--force-teardown` flag that bypasses both the lease check and the process probe, so a leaked lease or an unkillable holder cannot permanently strand a delivered run. The override SHALL report what it is overriding rather than skipping the checks silently, and SHALL NOT be reachable by any environment variable, default, or implicit condition. The existing `--phase4`-first / `CONCERTINO_PHASE4=1` opt-in semantics SHALL be unchanged, with `--force-teardown` accepted only after that opt-in. An unrecognised leading `--`-prefixed argument SHALL fail with a usage error rather than being bound as `WORKTREE_PATH`.

#### Scenario: an operator forces teardown past a leaked lease

- **WHEN** `cleanup.sh --phase4 --force-teardown` runs while a lease is held
- **THEN** the script reports the overridden lease and proceeds with teardown

#### Scenario: the override works under the environment-sentinel entry form

- **WHEN** `CONCERTINO_PHASE4=1 cleanup.sh --force-teardown <WORKTREE_PATH> ...` runs
- **THEN** the flag is consumed as a flag and `WORKTREE_PATH` binds to the path argument

#### Scenario: the override is not implicit

- **WHEN** `cleanup.sh --phase4` runs without `--force-teardown`
- **THEN** no environment variable or default causes either check to be skipped

#### Scenario: a mistyped flag fails loudly

- **WHEN** an unrecognised `--`-prefixed argument is passed where `WORKTREE_PATH` is expected
- **THEN** the script exits with a usage error rather than treating it as a path

### Requirement: The guard's behavior is covered by tests that fail if it is removed

The repository SHALL carry test coverage under `test/scripts/` exercising lease acquisition and release, refusal on a held lease, refusal on a cwd holder, settle-window tolerance, ancestor-chain self-exclusion, and the `--force-teardown` override, such that deleting either signal from `cleanup.sh` makes the suite fail.

#### Scenario: removing a signal turns the suite red

- **WHEN** either the lease check or the process probe is removed from `cleanup.sh`
- **THEN** the `test/scripts/` suite reports a failure rather than passing

### Requirement: Rendered copies stay byte-identical to their core sources

Any change to a file under `core/scripts/` SHALL be accompanied in the same commit by an identical update to its rendered counterpart under `scripts/concertino/`, keeping `test/scripts/rendered-scripts-drift.test.sh` green.

#### Scenario: the drift gate stays green

- **WHEN** `test/scripts/rendered-scripts-drift.test.sh` runs on this change's branch
- **THEN** it exits zero
