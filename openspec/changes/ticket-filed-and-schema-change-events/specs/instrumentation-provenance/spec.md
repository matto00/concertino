## ADDED Requirements

### Requirement: run.start records a digest of the instrumentation that will measure the run

`setup-worktree.sh` SHALL compute a content digest over the rendered procedure scripts it is itself running from, and SHALL record that digest on the run's `run.start` event, so that two runs can be told apart by whether they were measured by the same instrumentation. The digest SHALL be computed from the rendered copies actually present in the repository being operated on — never from the framework's own `core/` templates — because a locally patched rendered copy is precisely the case this exists to detect.

Computing the digest SHALL NOT fail a run: if it cannot be computed for any reason, `run.start` SHALL be emitted without it, exactly as before this change.

#### Scenario: Two runs measured by identical instrumentation agree
- **WHEN** two runs are started in a repository whose rendered scripts have not changed between them
- **THEN** both `run.start` events record the same instrumentation digest

#### Scenario: A locally patched rendered script changes the digest
- **WHEN** a rendered procedure script in the repository is locally edited, and a new run is started
- **THEN** that run's `run.start` event records a digest differing from the digest recorded before the edit

#### Scenario: A digest that cannot be computed never fails the run
- **WHEN** the digest cannot be computed
- **THEN** `run.start` is still emitted, without the digest field, and worktree setup succeeds

### Requirement: Drift between rendered scripts and their recorded render emits schema.change

`concertino sync` SHALL record, at render time, the digest of the rendered procedure scripts it wrote. When a run starts and the live digest disagrees with that recorded render-time digest, a `schema.change` event SHALL be appended to that repository's own event log, naming the affected scripts, so that a local patch to a rendered copy in a consuming repository is detectable from that repository's event log alone.

This SHALL hold for rendered copies in a consuming repository, not only for the framework's own checkout: a `schema.change` emitted only from the framework repository would not have detected the change that motivated this requirement, which was committed in the consuming repository.

#### Scenario: A local patch in a consuming repository is detectable from that repository's log alone
- **WHEN** a rendered procedure script in a consuming repository is patched locally after the last sync, and a run is started
- **THEN** a `schema.change` event appears in that repository's own event log naming the affected script, with no reference to the framework repository's history required to detect it

#### Scenario: No drift emits no schema.change
- **WHEN** a run is started in a repository whose rendered scripts are identical to what the last sync recorded
- **THEN** no `schema.change` event is emitted for that run

### Requirement: A repository that has not re-synced degrades gracefully

When no render-time digest has been recorded for a repository — the expected state for any repository that has not re-synced since this change — the live digest SHALL still be recorded on `run.start`, no `schema.change` SHALL be emitted, and the run SHALL proceed normally. An absent render-time digest SHALL NOT be reported as drift, since absence of a baseline is not evidence of a change.

#### Scenario: No recorded baseline yields a digest but no drift event
- **WHEN** a run starts in a repository with no render-time digest recorded
- **THEN** `run.start` carries the live digest, no `schema.change` event is emitted, and the run proceeds normally

#### Scenario: A run is never failed by the absence of a baseline
- **WHEN** a run starts in a repository with no render-time digest recorded
- **THEN** worktree setup exits successfully, exactly as before this change
