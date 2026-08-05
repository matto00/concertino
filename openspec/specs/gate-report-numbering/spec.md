# gate-report-numbering Specification

## Purpose
Gives the evaluator and skeptic collision-safe, disk-derived filename numbering for their reports, so a fold-in reopen of an archived change never overwrites an earlier sub-run's `evaluation-*.md` / `skeptic-*-*.md` history.
## Requirements
### Requirement: next-report-number.sh computes a collision-safe filename number from disk state
`core/scripts/next-report-number.sh <change-dir> <kind>` (`kind` SHALL be one of `evaluation`,
`skeptic-design`, `skeptic-final`) SHALL scan `<change-dir>` for existing files matching
`^<kind>-([0-9]+)\.md$`, compute `next` as one greater than the highest matched number found (or
`1` if none exist), and:
- if `<change-dir>/<kind>-<next>.md` does not already exist, print `READY number=<next>
  path=<change-dir>/<kind>-<next>.md` to stdout and exit 0;
- if it unexpectedly does already exist, print `FAIL <reason>` to stderr, print no `READY` line,
  and exit non-zero.

A `<change-dir>` that does not exist, or is not readable, SHALL also print `FAIL <reason>` to
stderr and exit non-zero.

#### Scenario: Empty change directory starts numbering at 1
- **WHEN** `next-report-number.sh <change-dir> evaluation` is run against a change directory
  containing no `evaluation-*.md` files
- **THEN** it prints `READY number=1 path=<change-dir>/evaluation-1.md` and exits 0

#### Scenario: Numbering continues from the highest existing file, regardless of run
- **WHEN** `next-report-number.sh <change-dir> evaluation` is run against a change directory
  already containing `evaluation-1.md` and `evaluation-2.md` (written by an earlier sub-run)
- **THEN** it prints `READY number=3 path=<change-dir>/evaluation-3.md` and exits 0, without
  requiring any input about which sub-run wrote the existing files

#### Scenario: A third sub-run continues the sequence again, not resetting
- **WHEN** `next-report-number.sh <change-dir> evaluation` is run against a change directory
  already containing `evaluation-1.md` through `evaluation-4.md` (written across two earlier
  sub-runs)
- **THEN** it prints `READY number=5 path=<change-dir>/evaluation-5.md` and exits 0

#### Scenario: Each report kind is numbered independently
- **WHEN** `next-report-number.sh <change-dir> skeptic-final` is run against a change directory
  containing `evaluation-1.md`, `evaluation-2.md`, and `skeptic-final-1.md`
- **THEN** it prints `READY number=2 path=<change-dir>/skeptic-final-2.md` — the `evaluation-*`
  files do not affect `skeptic-final`'s numbering

#### Scenario: An unexpected pre-existing target fails loudly rather than returning a colliding number
- **GIVEN** the scan computed `next` as some number `N`
- **WHEN** `<change-dir>/<kind>-N.md` unexpectedly already exists at the moment of the check
- **THEN** the script prints `FAIL <reason>` to stderr, prints no `READY` line, and exits non-zero

#### Scenario: A missing or unreadable change directory fails without a READY line
- **WHEN** `next-report-number.sh <path-that-does-not-exist> evaluation` is run
- **THEN** it prints `FAIL <reason>` to stderr, prints no `READY` line, and exits non-zero

### Requirement: The evaluator writes its report to the disk-derived filename
`core/roles/evaluator.md` SHALL, before writing its report, call
`next-report-number.sh <change-dir> evaluation` and write the report to the `path=` it returns,
rather than unconditionally writing to `evaluation-<CYCLE>.md`. The report's own header SHALL
still state the orchestrator-supplied `CYCLE` (unchanged run-local semantics, still what the
Final-cycle-behavior check and `EXECUTION_CYCLES` budget read), alongside the filename actually
used. The verdict returned to the orchestrator (`Report: <path>`) SHALL be this literal path. If
`next-report-number.sh` fails, the evaluator SHALL treat it as an environmental `BLOCKER` (same
treatment as any other environmental script failure in this role) rather than guessing a fallback
filename.

#### Scenario: Single-sub-run numbering is unaffected
- **GIVEN** a change directory with no pre-existing `evaluation-*.md` files
- **WHEN** the evaluator runs for `CYCLE=1`
- **THEN** its report is written to `evaluation-1.md`, exactly as before this change

#### Scenario: A reopened change's evaluator report does not overwrite the prior sub-run's
- **GIVEN** a change directory already containing `evaluation-1.md` from an earlier, already
  -delivered sub-run
- **WHEN** a new sub-run's evaluator runs for its own `CYCLE=1`
- **THEN** its report is written to `evaluation-2.md`, and `evaluation-1.md`'s content is
  unchanged

#### Scenario: A next-report-number.sh failure is a BLOCKER, not a guessed filename
- **WHEN** `next-report-number.sh` fails while the evaluator is about to write its report
- **THEN** the evaluator reports `BLOCKER` with the script's failure reason, and does not write a
  report to a guessed or fallback filename

### Requirement: The skeptic writes its report to the disk-derived filename
`core/roles/skeptic.md` SHALL, before writing its report, call `next-report-number.sh <change-dir>
skeptic-design` (for `GATE=design`) or `next-report-number.sh <change-dir> skeptic-final` (for
`GATE=final`), and write the report to the `path=` it returns, rather than unconditionally writing
to `skeptic-<GATE>-<N>.md`. The report's own header SHALL still state the orchestrator-supplied
round number `N` (unchanged run-local semantics), alongside the filename actually used. The
verdict returned to the orchestrator (`Report: <path>`) SHALL be this literal path. If
`next-report-number.sh` fails, the skeptic SHALL treat it as an environmental `BLOCKER`, same as
any other environmental script failure in this role.

#### Scenario: Single-sub-run numbering is unaffected
- **GIVEN** a change directory with no pre-existing `skeptic-final-*.md` files
- **WHEN** the skeptic runs the final gate for round `N=1`
- **THEN** its report is written to `skeptic-final-1.md`, exactly as before this change

#### Scenario: A reopened change's skeptic report does not overwrite the prior sub-run's
- **GIVEN** a change directory already containing `skeptic-final-1.md` and `skeptic-final-2.md`
  from an earlier, already-delivered sub-run
- **WHEN** a new sub-run's skeptic runs the final gate for its own round `N=1`
- **THEN** its report is written to `skeptic-final-3.md`, and the two prior reports' content is
  unchanged

