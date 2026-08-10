## Why

METRICS' "recent escalations" list (`lib/ui/screens/fleet/metrics.js`) is
flat, unselectable text — no way to open a row and see the full question,
its options, and how it was answered, even though that data (question,
options, raiser, eventual decision) is already captured in each run's event
log. Unlike EVIDENCE's rows in the drill-down, there is no navigation
affordance here at all.

## What Changes

- `metricsFor()` gains a full, unbounded, paired history of every
  `escalation.raised` event and its eventual resolution
  (`escalation.answered`'s `answer`/`sub_answers`, or `escalation.timeout`'s
  "no answer recorded"), newest first — not just the raised-only, glance-cap
  list it builds today.
- The fleet view gains a `focus === 'metrics'` mode (mirroring the existing
  `'quickstart'`/`'queue'` focus modes): `j`/`k` moves a selection cursor over
  this full history, windowed through the same `layout.selectionWindow` the
  EVIDENCE panel already uses so the list scrolls/paginates past whatever a
  single draw of the METRICS box can show — the answer to this change's
  raised design question ("recent" is not intentionally shallow; a
  scrollable/paginated view over the full history is required).
- `↵` on the selected historical escalation opens a detail view: for an
  escalation that is STILL LIVE (its run's `escalation.raised` has not yet
  been followed by an `escalation.answered`/`escalation.timeout`), this
  routes to the exact same answerable escalation screen (`lib/ui/screens/
  escalation.js`, mode `'escalation'`) that `g`/`↵` already open elsewhere —
  not a second code path. For a RESOLVED escalation, the same screen module
  renders a new read-only "historical" branch: the same question/options/
  layout, no answer keys, plus the recorded decision (or "no answer recorded"
  for a timeout).
- `docs/dashboard.md` documents the new interaction.

## Capabilities

### New Capabilities

- `fleet-metrics-escalation-history`: METRICS' recent-escalations list
  becomes a selectable, scrollable history with a read-only historical detail
  view, reusing the existing escalation screen for both the live and
  resolved cases.

### Modified Capabilities

(none — no existing capability's requirements change; this is additive to
`fleet-metrics-harness-breakdown`/`fleet-metrics-multi-row-charts`'s sibling
METRICS surface and to `cross-screen-escalation`'s escalation-screen module,
but neither's own requirements are altered.)

## Impact

- `lib/ui/screens/fleet/metrics.js` — `metricsFor()`'s escalation history
  computation; `metricsColumnLines()`'s rendering gains a focused/windowed
  branch.
- `lib/ui/screens/fleet/keys.js` — new `focus === 'metrics'` key handling,
  mirroring the `'quickstart'` block; digit-jump into METRICS now focuses
  instead of no-op'ing.
- `lib/ui/controllers/fleet.js` — new `focus-metrics`/`move-metrics-focus`/
  `exit-metrics-focus`/`open-historical-escalation` action handlers.
- `lib/ui/screens/escalation.js` — new read-only historical rendering branch,
  reusing the live screen's box/textwrap/pane machinery.
- `lib/ui/watch.js` / `lib/ui/app-state.js` — new `metricsEscalationFocus`
  cursor state, threaded through the same way `quickStartFocus` already is.
- `docs/dashboard.md` — documents the new list/detail interaction.
