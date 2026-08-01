## ADDED Requirements

### Requirement: A live escalation raised after `run.end` is not treated as stale merely because the run ended
`lib/ui/reducer.js`'s `escalationStale` computation SHALL consider an
escalation stale if and only if the run's tmux window is confirmed not
alive (`run.window` present and `run.window.alive === false`) or there is no
window data for the run at all. It SHALL NOT additionally treat
`run.endStatus` being set (i.e. a `run.end` event already logged) as, on its
own, sufficient to mark a live-windowed run's escalation stale.

#### Scenario: An escalation raised after run.end, with the window still alive, is not stale
- **GIVEN** a run's event log contains a `run.end` event
- **AND** that run's event log subsequently contains an `escalation.raised`
  event
- **AND** the run's tmux window is still alive
- **WHEN** the dashboard reduces this run's events
- **THEN** `run.escalationStale` is `false`

#### Scenario: An escalation raised after run.end, with no window data, is still stale
- **GIVEN** a run's event log contains a `run.end` event followed by an
  `escalation.raised` event
- **AND** no tmux window data exists for this run
- **WHEN** the dashboard reduces this run's events
- **THEN** `run.escalationStale` is `true` (unchanged from prior behavior)

#### Scenario: An escalation raised after run.end, with a dead window, is stale
- **GIVEN** a run's event log contains a `run.end` event followed by an
  `escalation.raised` event
- **AND** the run's tmux window is confirmed dead
- **WHEN** the dashboard reduces this run's events
- **THEN** `run.escalationStale` is `true`

### Requirement: A run with a live post-completion escalation reports status `needs-you`, not `done`/`failed`
`lib/ui/reducer.js`'s `deriveStatus` SHALL return `needs-you` for a run that
has a non-stale escalation (per the requirement above), even when
`run.endStatus` is set, for as long as the window remains alive and the
escalation remains unanswered. Once the escalation is answered or times out
(clearing `run.escalation`) or the window dies (making it stale), the
existing `endStatus`/window-dead precedence applies exactly as before.

#### Scenario: A delivered run with a live follow-up escalation shows as NEEDS YOU
- **GIVEN** a run's event log contains a `run.end` event with
  `status=delivered`
- **AND** a subsequent `escalation.raised` event with the window still alive
- **WHEN** the fleet screen buckets runs by status
- **THEN** this run's `status` is `needs-you` and it appears in the
  `NEEDS YOU` section, not the `DONE` section

#### Scenario: Once answered, the same run reverts to done
- **GIVEN** the run from the scenario above
- **WHEN** an `escalation.answered` event is subsequently logged
- **THEN** `run.escalation` is cleared and `run.status` returns to `done`
  (from `run.endStatus`)

#### Scenario: A plain delivered run with no escalation is unaffected
- **GIVEN** a run's event log contains only a `run.start` and a `run.end`
  event with `status=delivered`, and no escalation was ever raised
- **WHEN** the dashboard reduces this run's events
- **THEN** `run.status` is `done`, exactly as before this change
