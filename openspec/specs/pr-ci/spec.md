# pr-ci Specification

## Purpose
Ensure every pull request against `main` and every push to `main` runs the
test suite via a real GitHub Actions check, across the declared
`engines.node` floor and the version `publish.yml` publishes from, so
`core/scripts/check-merge-readiness.sh`'s "CI green" condition reflects a
genuine result instead of passing vacuously on an empty status-check
rollup.
## Requirements
### Requirement: Test suite runs on pull requests and pushes to main
The system SHALL run a GitHub Actions workflow that executes `npm test` on
every `pull_request` event targeting `main` and on every `push` to `main`,
so that `main`'s branch protection / merge-readiness checks receive a
non-empty status-check rollup instead of the vacuous empty-rollup pass
`core/scripts/check-merge-readiness.sh` previously observed.

#### Scenario: PR opened against main
- **WHEN** a pull request is opened or updated targeting `main`
- **THEN** a GitHub Actions check run is created and reports the result of
  `npm test`

#### Scenario: Push directly to main
- **WHEN** a commit is pushed directly to `main`
- **THEN** a GitHub Actions check run is created and reports the result of
  `npm test`

#### Scenario: Failing suite reports a real failure
- **WHEN** `npm test` fails on a PR branch
- **THEN** the corresponding GitHub check run's conclusion is `failure`, and
  `check-merge-readiness.sh` condition 1 ("CI green") reports FAIL for that
  PR rather than passing on an empty rollup

### Requirement: Declared Node engines range is exercised in CI
The workflow SHALL run the test job across a matrix including at least the
`engines.node` floor declared in `package.json` and the Node version
`publish.yml` uses to publish, so the declared support range is verified
rather than only asserted.

#### Scenario: Floor version is exercised
- **WHEN** the workflow runs on a pull request or push to main
- **THEN** one matrix job runs `npm test` under the Node version matching
  `package.json`'s `engines.node` floor (16)

#### Scenario: Publish version is exercised
- **WHEN** the workflow runs on a pull request or push to main
- **THEN** one matrix job runs `npm test` under the same Node version
  `publish.yml` uses (22)

