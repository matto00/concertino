## ADDED Requirements

### Requirement: A CHANGES panel is reachable as the drill-down's fifth panel

The drill-down (`lib/ui/screens/drilldown.js`) SHALL add a fifth panel, CHANGES, to its existing
panel set (TICKET, TIMELINE, GATES, EVIDENCE), reachable via digit key `5` and included in the
`Tab` cycle order alongside the other four.

#### Scenario: Jumping directly to CHANGES
- **WHEN** digit key `5` is pressed in the drill-down
- **THEN** the CHANGES panel receives input focus, rendered in this screen's focused border style

#### Scenario: Tab cycles through all five panels
- **WHEN** `Tab` is pressed repeatedly from any panel
- **THEN** focus visits all five panels — TICKET, TIMELINE, GATES, EVIDENCE, CHANGES — in order,
  and returns to the first after the last

### Requirement: CHANGES shows `git diff --stat` against the run's worktree, recomputed every poll

The dashboard SHALL recompute `git diff --stat` against the run's worktree (`run.worktree`) on every poll tick (the same cadence the rest of the dashboard already polls at) while the drill-down is open and CHANGES panel data is being computed for the currently-viewed ticket, so the panel
reflects the worktree's current state without requiring the panel to be focused or a key to be
pressed.

#### Scenario: The stat list reflects a change made after the drill-down was opened
- **WHEN** the drill-down is open on a run whose worktree exists, and a file in that worktree is
  modified
- **THEN** the CHANGES panel's `git diff --stat` output reflects that modification by the next poll
  tick, without requiring CHANGES to be focused or any key to be pressed

#### Scenario: CHANGES data is not computed for runs not currently drilled into
- **WHEN** the drill-down is not open, or is open on a different run
- **THEN** no `git diff` is executed for a run not currently being viewed in the drill-down

### Requirement: A selected file in the stat list can be expanded to its full unified diff

The CHANGES panel SHALL allow selecting one file from its `git diff --stat` list and, when the open
key is pressed, opening that file's full unified diff (`git diff -- <file>`) in the shared `docview`
reader (see the `docview` capability), reusing that reader rather than a second doc-rendering
implementation.

#### Scenario: Opening a selected file's full diff
- **WHEN** a file is selected in the CHANGES panel and the open key is pressed
- **THEN** the doc reader opens, showing that file's full unified diff

#### Scenario: esc from the diff reader returns to the drill-down with the same file selected
- **WHEN** a file's diff is opened from CHANGES and `esc` is pressed
- **THEN** the drill-down renders again with CHANGES still focused and the same file still selected

### Requirement: CHANGES panel selection and its open key are focus-gated

The CHANGES panel's selection cursor and its open key SHALL only be active, and only advertised in
the drill-down's footer hint, while the CHANGES panel holds input focus — mirroring the EVIDENCE
panel's existing focus-gating (see `evidence-reader`'s "Evidence-panel selection and its open key
are focus-gated" requirement, applied here to CHANGES). Unlike EVIDENCE (a four-panel-era
requirement predating the lazygit-layout pass), the digit key `5`/`Tab` focus switch itself SHALL
still move focus to CHANGES even when its diff-stat list is empty — every panel is a legitimate
focus target regardless of content (see `lib/ui/screens/drilldown.js`'s existing `handleKey`,
which already treats all `DRILL_PANELS` entries this way, and the corresponding regression test in
`test/drilldown.test.js`). Only the CHANGES-selection/CHANGES-open footer hints and cursor
behavior are gated on non-empty content, not the focus switch — see the "keys are advertised only
when they currently do something" requirement below.

#### Scenario: Focus switch still reaches an empty CHANGES panel
- **WHEN** the CHANGES panel shows no changed files (an empty `git diff --stat`) and the
  focus-switch key targets CHANGES
- **THEN** focus moves to CHANGES exactly as it would with a non-empty list, but no
  CHANGES-selection or CHANGES-open key is shown in the footer (see below)

### Requirement: The CHANGES panel degrades honestly once the run's worktree is gone

The CHANGES panel SHALL show an explicit message stating the worktree no longer exists, rather than
a stale diff, a thrown error, or a silently empty panel, whenever the run's worktree path is unset
or no longer resolves to an existing directory — including after `cleanup.sh --phase4` has removed
it.

#### Scenario: Viewing CHANGES after the run's worktree has been cleaned up
- **WHEN** the drill-down is opened on a run whose worktree has already been removed
- **THEN** the CHANGES panel shows an explicit "worktree removed" message, and no `git diff` is
  attempted

### Requirement: No durable diff snapshot is persisted

Unlike the EVIDENCE panel's persisted-artifact convention, the CHANGES panel SHALL NOT persist a
diff snapshot anywhere once the worktree is gone — CHANGES is a live-only view of an in-flight
worktree; a finished run's diff is not recoverable through this panel.

#### Scenario: No diff file is written to the evidence directory
- **WHEN** a run completes and its worktree is removed
- **THEN** no diff snapshot file has been written to `.concertino/runs/<TICKET>/evidence/` as a
  result of the CHANGES panel

### Requirement: An oversized full diff is truncated, not refused

The doc reader SHALL show the leading lines up to a fixed line cap followed by an explicit truncation marker line, rather than refusing to open the reader or silently showing an incomplete diff with no indication that content was cut, whenever a selected file's full unified diff (`git diff -- <file>`) exceeds that cap.

#### Scenario: Opening a very large diff
- **WHEN** a selected file's full diff exceeds the fixed line cap
- **THEN** the doc reader opens showing the leading lines up to the cap, followed by an explicit
  "truncated" marker line

#### Scenario: A binary file's diff opens with git's own summary line
- **WHEN** a selected file is binary
- **THEN** the doc reader opens showing git's own `Binary files ... differ` summary line, with no
  truncation marker (since that line is already short)

### Requirement: The CHANGES panel's keys are advertised only when they currently do something

The drill-down's footer SHALL only show CHANGES-selection and CHANGES-open key hints while CHANGES
holds focus and has at least one file to select, mirroring `sections.js`'s existing "only advertise
a key that currently does something" discipline.

#### Scenario: Default focus advertises no CHANGES-specific keys
- **WHEN** the drill-down is opened and CHANGES is not focused
- **THEN** the footer shows no CHANGES-selection or CHANGES-open hint
