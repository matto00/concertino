## Purpose
Guarantees that the self-hosted rendered scripts under `scripts/concertino/` stay identical to the `core/scripts/` templates they are generated from, so a Concertino run delivering its own tickets is guarded by the guards Concertino currently defines rather than by a stale snapshot of them.

## ADDED Requirements

### Requirement: The repo's own test suite fails on rendered-script drift
The repository SHALL carry a check that, for every file under `core/scripts/**`, compares it byte-for-byte against the correspondingly-named file under `scripts/concertino/**`, and separately asserts that every rendered file whose name ends in `.sh` is executable, and fails when either check fails. The check SHALL NOT compare the two files' modes for equality: the renderer forces every rendered `.sh` to mode 0755 irrespective of the core file's own mode, so mode equality would report a correctly-rendered file as drifted and its stated remedy could not clear the report. That check SHALL be registered in the `test` script of `package.json` so it runs as part of routine verification, not only in an on-demand diagnostic command.

The check SHALL enumerate the files to compare from `core/scripts/**` only. A file present under `scripts/concertino/` with no `core/scripts/` counterpart — `.concertino.env` and `speeds.json`, which are config-derived render products — SHALL therefore be out of scope by construction, without needing to be named in any exclusion list.

#### Scenario: Trees agree
- **WHEN** every file under `core/scripts/**` is byte-identical to its `scripts/concertino/**` counterpart
- **THEN** the check SHALL exit zero

#### Scenario: A rendered copy has gone stale
- **WHEN** a file under `core/scripts/**` differs in content from its rendered counterpart
- **THEN** the check SHALL exit non-zero and SHALL name the offending path

#### Scenario: A rendered script is not executable
- **WHEN** a rendered `scripts/concertino/**` file ending in `.sh` is not executable
- **THEN** the check SHALL exit non-zero and SHALL name the offending path, whatever the mode of its core counterpart

#### Scenario: A non-executable core file with an executable render is not reported
- **WHEN** a `core/scripts/**` file is not executable, its rendered counterpart is executable, and their contents are identical
- **THEN** the check SHALL NOT report that file, since this is exactly what the renderer produces

#### Scenario: Config-derived render products are not reported
- **WHEN** `scripts/concertino/.concertino.env` or `scripts/concertino/speeds.json` is present with no `core/scripts/` counterpart
- **THEN** the check SHALL NOT report either file, at any content

### Requirement: The failure message states the remedy and does not invite a hand-edit
When the check fails it SHALL instruct the reader to run `concertino sync` and commit the resulting render as its own reviewable diff. It SHALL NOT instruct or suggest editing a file under `scripts/concertino/` directly, since that directory is a render target whose local edits the next `concertino sync` silently erases.

#### Scenario: Remedy is named on failure
- **WHEN** the check fails for any reason
- **THEN** its output SHALL name `concertino sync` as the remedy and SHALL describe committing the render as a separate reviewable diff

### Requirement: A missing rendered counterpart is a distinct, separately-reported failure
A file present under `core/scripts/**` with no counterpart under `scripts/concertino/**` SHALL be reported as a missing-counterpart failure, distinct in the output from a content mismatch, because the two are different problems: one file never arrived, the other arrived and then went stale.

The check SHALL honour an exemption list that suppresses the missing-counterpart failure for named files only. Every entry SHALL carry a written reason naming a tracked open question, not merely a free-text remark, so the exemption cannot sit inert indefinitely without that question being visible outside the script. The check SHALL accept exemption entries supplied by the environment in addition to its built-in table, so that the exemption mechanism can itself be tested without editing the script under test. An exemption SHALL NOT suppress a content mismatch for a file that is in fact present, so an exempt file that is later rendered is still held to byte-identity.

#### Scenario: An unrendered core script is caught
- **WHEN** a file under `core/scripts/**` has no counterpart under `scripts/concertino/**` and is not exempt
- **THEN** the check SHALL exit non-zero and SHALL report it as missing rather than as a content mismatch

#### Scenario: An exempt file is not reported as missing
- **WHEN** an exempt file under `core/scripts/**` has no rendered counterpart
- **THEN** the check SHALL NOT fail on account of that file

#### Scenario: Exemption evidence never writes to an owner-protected path
- **WHEN** the behaviour that an exemption cannot suppress a content mismatch is demonstrated
- **THEN** it SHALL be demonstrated with a synthetic exemption entry over an ordinary rendered file, and SHALL NOT create, overwrite or delete `scripts/concertino/pricing-table.json` or `scripts/concertino/report-cost.sh` in any checkout

#### Scenario: An exemption does not license drift
- **WHEN** an exempt file has a rendered counterpart whose content differs from core
- **THEN** the check SHALL fail with a content mismatch for that file, exactly as for a non-exempt file

### Requirement: The check is failable by mutation and demonstrated to be
The check SHALL be accompanied by evidence that mutating either tree makes it fail: a mutation applied to a rendered copy, and a core-side file with no rendered counterpart, each SHALL be shown to produce a non-zero exit and the corresponding message. A passing run against the unmutated tree SHALL NOT by itself be treated as evidence that the check works.

#### Scenario: Mutation of a rendered copy is detected
- **WHEN** an arbitrary byte is appended to a file under `scripts/concertino/**` that has a core counterpart
- **THEN** the check SHALL exit non-zero and name that file as a content mismatch

#### Scenario: A synthetic unrendered core file is detected
- **WHEN** a new file is created under `core/scripts/**` with no rendered counterpart and no exemption
- **THEN** the check SHALL exit non-zero and name that file as missing

### Requirement: Existing drift is cleared so the gate is green on arrival
The change introducing this check SHALL also re-render the rendered copies that are stale at its base commit — `squash-branch.sh`, `check-merge-readiness.sh`, `cleanup.sh` and `README.md` — from `core/scripts/`, so that the check passes on the delivered branch. Shipping a check that is red on arrival SHALL NOT satisfy this requirement.

The re-render SHALL be a faithful copy of the core content and SHALL NOT hand-edit either tree to make the comparison agree.

#### Scenario: The gate passes on the delivered branch
- **WHEN** the check is run against the branch delivering this change
- **THEN** it SHALL exit zero

#### Scenario: The re-rendered scripts carry the merged core fixes
- **WHEN** `scripts/concertino/squash-branch.sh` is inspected on the delivered branch
- **THEN** it SHALL be byte-identical to `core/scripts/squash-branch.sh`, and SHALL therefore carry the validate-before-reset behaviour, the staged-blob validation, the `DRY_RUN=1` mode, and the grouped-bullet declaration parser
