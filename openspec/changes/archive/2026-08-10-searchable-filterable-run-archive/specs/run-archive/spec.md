## ADDED Requirements

### Requirement: `A` opens the run-archive screen listing every retained run

The fleet view (`lib/ui/screens/fleet.js`) SHALL bind `A` to open a
dedicated run-archive screen, reachable regardless of the current `focus`
value, except while any confirmation gate (`quitConfirm`, `forceStartConfirm`,
`clearQueueConfirm`, `markDoneConfirm`, `bulkConfirm`), the `n` prompt, or the
`/` search prompt is already open — in any of those cases `A` SHALL NOT open
the archive screen (mirroring how those gates already intercept every other
key ahead of it). The archive screen SHALL list every run present in the
dashboard's current run set (`S.runs` — every retained run under
`.concertino/runs/`, bounded only by `dashboard.retentionDays`), independent
of live status (RUNNING/FAILED/DONE/NEEDS YOU/unknown all included).

#### Scenario: `A` opens the archive screen from the fleet view
- **WHEN** the fleet view is on screen with no confirmation gate, `n`
  prompt, or `/` search open and the operator presses `A`
- **THEN** the run-archive screen opens, listing every run currently in the
  dashboard's run set

#### Scenario: `A` does nothing while the `n` prompt is open
- **WHEN** the `n` new-run prompt is currently open
- **THEN** pressing `A` types the character `A` into the prompt's value, and
  no archive screen opens

#### Scenario: A run beyond the fleet view's DONE/FAILED display cap is still listed
- **GIVEN** more terminal runs exist than the fleet view's own DONE/FAILED
  section cap displays at once
- **WHEN** the archive screen opens
- **THEN** every one of those runs is listed, not only the capped subset the
  fleet view itself renders

### Requirement: Live filtering by ticket id/title substring, harness, and date range

While the archive screen is open, the operator SHALL be able to filter the
listed runs by three independent, simultaneously-applicable criteria:

1. **Ticket id/title substring** — a live, as-you-type, case-insensitive
   substring match against a run's ticket id or its title (`changeName`).
   A non-empty query SHALL be evaluated via the same match predicate the
   fleet view's own `/` search already defines (`matchesQuery`/
   `rowMatches`, `lib/ui/screens/fleet/search.js`), reused unmodified. An
   empty (or whitespace-only) query SHALL match every run — this is an
   explicit bypass the archive screen's own filter code applies BEFORE
   calling `rowMatches` (which, unmodified, returns `false` — no match — on
   an empty query, per its own existing `fleet-search` semantics: "An empty
   query SHALL match nothing"). This is a deliberate divergence from the
   `/` search prompt's own empty-query behavior (highlighting nothing) —
   here an empty filter means "show everything," the natural default for a
   filterable list screen the operator hasn't started narrowing yet.
2. **Harness** — a selectable filter restricting the list to runs whose
   `harness` field matches the selected value; unset (default) SHALL apply
   no harness filtering.
3. **Date range** — an optional from/to bound against each run's
   `startedAt` timestamp; a run whose `startedAt` is unset SHALL be excluded
   whenever either bound is set, and included when neither bound is set.

All three filters SHALL apply simultaneously (a run must satisfy every
active filter to remain listed) and SHALL update the displayed list
immediately as any filter's value changes, with no additional confirmation
step.

#### Scenario: Typing a substring narrows the list live
- **WHEN** the archive screen is open and the operator types a substring
  matching one run's ticket id
- **THEN** only runs whose ticket id or title contain that substring
  (case-insensitively) remain listed, updated on every keystroke

#### Scenario: An empty substring filter shows every run
- **WHEN** the archive screen opens with no substring typed
- **THEN** every run in the archive's run set is listed, unfiltered by
  substring

#### Scenario: Harness filter narrows to one harness
- **WHEN** the operator selects a specific harness value
- **THEN** only runs whose `harness` field equals that value remain listed

#### Scenario: Date range excludes runs outside the bound
- **GIVEN** a from/to date range is set
- **WHEN** a run's `startedAt` falls outside that range
- **THEN** that run is excluded from the list

#### Scenario: Filters combine
- **GIVEN** a substring filter and a harness filter are both active
- **WHEN** a run matches the substring but not the selected harness
- **THEN** that run is excluded from the list

### Requirement: The archive screen tracks which of its several controls has keyboard focus

The archive screen SHALL track, in its own state, which one of its five
interactive zones — the substring input, the harness selector, the
date-from field, the date-to field, or the results list — currently
receives keystrokes, defaulting to the substring input when the screen
opens. `Tab` SHALL move focus forward through those five zones in a fixed
order, wrapping from the last back to the first; `Shift-Tab` SHALL move
focus backward, wrapping symmetrically. Typing, and each zone's own
selection/cycling keys (below), SHALL apply only to whichever zone
currently holds focus.

#### Scenario: The substring input holds focus by default
- **WHEN** the archive screen opens
- **THEN** typing updates the substring filter

#### Scenario: `Tab` moves focus to the next zone
- **GIVEN** the substring input holds focus
- **WHEN** the operator presses `Tab`
- **THEN** the harness selector holds focus, and typing no longer affects
  the substring filter

#### Scenario: `Tab` wraps from the last zone back to the first
- **GIVEN** the results list holds focus (the last zone in order)
- **WHEN** the operator presses `Tab`
- **THEN** the substring input holds focus again

### Requirement: Harness selector cycles through observed values

While the harness selector holds focus, `↵` (or `space`) SHALL cycle to the
next distinct, non-null `harness` value observed among the runs currently
in `S.runs`, wrapping from the last observed value back to "any" (no
harness filter applied) rather than stopping. The set of cyclable values
SHALL be computed fresh each time, not fixed at screen-open time.

#### Scenario: Cycling selects the next observed harness
- **GIVEN** the harness selector holds focus with no harness filter active
  and runs with harnesses `claude-code` and `codex` both exist in `S.runs`
- **WHEN** the operator presses `↵`
- **THEN** the harness filter becomes `claude-code` (or whichever value is
  first in cycle order), and the list narrows accordingly

#### Scenario: Cycling wraps back to "any"
- **GIVEN** the harness selector holds focus with the last observed
  harness value currently selected
- **WHEN** the operator presses `↵`
- **THEN** the harness filter clears back to "any" (no harness filtering)

### Requirement: Date-range fields accept `YYYY-MM-DD` via a text prompt, reject invalid input without crashing

While the date-from or date-to field holds focus, `↵` SHALL open a
free-text prompt (its own in-progress, uncommitted text — distinct from
that field's last-committed value) seeded with that field's current value
(formatted `YYYY-MM-DD`, empty if unset). While this prompt is open, it
SHALL intercept every keystroke: typing/backspace SHALL edit only the
prompt's own uncommitted text, and `esc` SHALL cancel the prompt only —
discarding the uncommitted text and returning to ordinary archive-screen
key handling with every committed filter and the currently focused zone
unchanged — rather than leaving the archive screen entirely. Submitting
(`↵`) a valid `YYYY-MM-DD` value SHALL set that bound to the start of that
day (date-from) or the end of that day (date-to), in local time, and close
the prompt. Submitting an empty value SHALL clear that bound (no date
filtering on that side) and close the prompt. Submitting a value that is
not a valid `YYYY-MM-DD` date SHALL leave the field's existing committed
value unchanged, SHALL surface a one-line error notice, and SHALL leave the
prompt open (so the operator can correct and resubmit), without crashing
the dashboard or losing any other filter's state.

#### Scenario: A valid date sets the bound
- **GIVEN** the date-from field holds focus
- **WHEN** the operator submits `2026-07-01`
- **THEN** `archiveDateFrom` is set to the start of July 1, 2026 local time,
  the prompt closes, and the list narrows to runs started on or after that
  moment

#### Scenario: An empty submission clears the bound
- **GIVEN** the date-to field holds focus with a previously-set value
- **WHEN** the operator submits an empty value
- **THEN** the date-to bound is cleared, the prompt closes, and runs are no
  longer excluded on that side of the range

#### Scenario: An invalid date is rejected, not applied, and the prompt stays open
- **GIVEN** the date-from field holds focus
- **WHEN** the operator submits `not-a-date`
- **THEN** the date-from bound is unchanged from before the submission, a
  one-line error notice is shown, and the prompt remains open for another
  attempt

#### Scenario: `esc` cancels the prompt only, not the whole archive screen
- **GIVEN** the operator has opened the date-from prompt and typed some
  uncommitted text into it
- **WHEN** the operator presses `esc`
- **THEN** the prompt closes with the uncommitted text discarded, the
  archive screen remains open with every committed filter unchanged, and
  the date-from field itself retains keyboard focus — the fleet view is
  NOT shown

### Requirement: Selecting a listed run opens the existing drill-down

Selecting a run from the archive screen's list (`↵`) SHALL open the same
run drill-down screen (TICKET/TIMELINE/GATES/EVIDENCE panels,
`lib/ui/screens/drilldown.js`) that the fleet view's own `l` key already
opens for a live/recent run, via the same `open-drilldown` action and the
same underlying run-lookup — no separate rendering path or data
transformation SHALL be introduced for a run opened this way.

#### Scenario: Selecting an archived run opens its drill-down
- **WHEN** the operator selects a run from the archive screen's filtered
  list and presses `↵`
- **THEN** the drill-down screen opens for that run, rendering its
  TICKET/TIMELINE/GATES/EVIDENCE panels identically to how selecting that
  same run from the fleet view would

#### Scenario: A run not currently shown in any fleet section still opens correctly
- **GIVEN** a terminal run old enough that the fleet view's own DONE section
  no longer displays it (beyond its display cap) but still within
  `dashboard.retentionDays`
- **WHEN** the operator opens it from the archive screen
- **THEN** its drill-down opens with the same panels a currently-displayed
  run's drill-down would show

### Requirement: `esc` returns to the fleet, with no navigation stack

Pressing `esc` while the archive screen is open SHALL return to the fleet
view, consistent with every other top-level screen's existing
navigation. `esc` from a drill-down opened via the archive screen SHALL
likewise return directly to the fleet view, not back to the archive screen.

#### Scenario: Escape from the archive screen returns to the fleet
- **WHEN** the archive screen is open and the operator presses `esc`
- **THEN** the fleet view is shown

#### Scenario: Escape from a drill-down opened via the archive returns to the fleet, not the archive
- **GIVEN** the operator opened a run's drill-down from the archive screen
- **WHEN** the operator presses `esc`
- **THEN** the fleet view is shown, not the archive screen
