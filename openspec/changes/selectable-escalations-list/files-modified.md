# Files modified — CON-107 selectable-escalations-list

## Source

- `lib/ui/reducer.js` — exported `toOptions()` (unchanged behavior) and
  factored the `escalation.raised` fold's inline `sub_questions` JSON.parse
  into a new, exported `parseSubQuestions()`, so `metrics.js`'s new pairing
  walk reuses the SAME normalization rather than a second implementation.
- `lib/ui/screens/fleet/metrics.js` — `metricsFor()`'s `recentEscalations`
  is now a full, unbounded, raised/resolved-paired history (design.md
  Decision 1), built by a new `buildEscalationHistory()` walk (plus a small
  `parseSubAnswers()` helper for the `sub_answers` field). `metricsColumnLines()`
  gains `opts.focused`/`opts.selectedIndex`: unfocused rendering is
  byte-for-byte unchanged; focused windows the full history through
  `layout.selectionWindow()` (mirroring `evidenceWindow()`), marking the
  selected row with `▸ `/`f.bold()`.
- `lib/ui/screens/fleet/keys.js` — digit-jump's `case 'metrics'` now emits
  `{ type: 'focus-metrics', index: 0 }` instead of `null`; new
  `focus === 'metrics'` key block (`j`/`k` → `move-metrics-focus`, `↵` →
  `open-historical-escalation`, Escape → `exit-metrics-focus`,
  `l`/arrow-right/`n`/`N` suppressed), mirroring the `quickstart` block.
- `lib/ui/controllers/fleet.js` — new `focus-metrics` (`applyJumpAction`),
  `move-metrics-focus`, `exit-metrics-focus`, `open-historical-escalation`
  action handlers; requires `./escalation` directly to dispatch the
  still-live branch through the exact existing `'open-escalation'` handling
  (never a duplicate implementation).
- `lib/ui/controllers/escalation.js` — `'open-escalation'`'s handler now
  resets `S.escalationHistoryItem = null` at the top, so opening a live
  escalation always starts from a clean slate even if a historical view was
  previously open.
- `lib/ui/screens/escalation.js` — `renderEscalation` gains an
  `opts.historical`-checked-first branch, delegating to a new
  `renderHistoricalEscalation()` (reuses `pane()`/`sectionHeader()`/
  `textwrap.wrap()`): full question/options, no answer-key bindings,
  `decision: ...`/"no answer recorded (timed out)", `esc back`-only footer,
  `meta` shows resolvedAt-relative time. A multi-part entry shows
  `subQuestions[subQuestions.length - 1]` only. `render()`/`routeHandleKey()`
  thread `state.escalationHistoryItem` through as `opts.historical`/
  `state.historical`. `handleKey` itself is unchanged (its existing `!run`
  branch already covers a historical view).
- `lib/ui/app-state.js` — new `escalationHistoryItem`/`metricsEscalationFocus`
  state fields (defaults, `currentState()` snapshot); `backToFleet()` resets
  `escalationHistoryItem` alongside every other escalation-screen-local field.
- `lib/ui/banner.js` — `suppressedOnOwnScreen()` gains a 4th
  `historicalItem` argument, returning `true` whenever `mode === 'escalation'
  && !!historicalItem` (in addition to its existing condition) — a historical
  view carries no `escalationTicket`, so without this the banner for some
  OTHER run's live escalation could render on top of it.
- `lib/ui/watch.js` — new `metricsEscalationHistory()` (re-derived fresh on
  every call, exposed via `ctx`); `S.metricsEscalationFocus`'s own re-clamp
  in `draw()`, mirroring `quickStartFocus`; the poll-loop "walk back to
  fleet if `run.escalation` clears" check is now gated on
  `S.mode === 'escalation' && !S.escalationHistoryItem`; both
  `suppressedOnOwnScreen()` call sites (`computeScreenRows()`, `draw()`)
  updated to pass `S.escalationHistoryItem` as the new 4th argument.
- `lib/ui/screens/fleet/render.js` — `mergeRenderOpts()` threads
  `metricsEscalationFocus` through (mirrors `quickStartFocus`); grid-mode's
  `ctx` build passes it into `renderFleetGrid`.
- `lib/ui/screens/fleet/grid.js` — `renderFleetGrid()` destructures
  `metricsEscalationFocus` and threads `focused`/`selectedIndex` into its
  `metricsColumnLines()` call — the one call site that actually reaches the
  expanded tier's focused/windowed rendering.
- `lib/ui/screens/fleet/sections.js` — `buildSections()`'s METRICS
  `emptyLines` computation threads `focused`/`selectedIndex` through too
  (harmless no-op while this tier stays compact, since its `contentRows`
  always defaults to 5).
- `docs/dashboard.md` — new "METRICS' recent-escalations list" section
  documenting the focus/scroll/open interaction; keys table updated to
  mention METRICS' own local cursor.

## Tests

- `test/fleet.test.js` — updated `metricsFor.recentEscalations` shape
  assertions for the new paired-history fields; new tests for the
  resolved/timed-out/still-live/multi-part pairing scenarios and for the
  orphaned-resolution ignore case; new `metricsColumnLines` focused-windowing
  tests; updated/new `handleKey` digit-jump and `focus === 'metrics'` tests
  (mirroring the existing QUICK START tests).
- `test/controllers-fleet.test.js` — `ctx()` fixture gains
  `metricsEscalationFocus`/`escalationHistoryItem`/`escalationTicket`
  defaults and a fresh-every-call `metricsEscalationHistory()` fake; new
  tests for `focus-metrics`/`move-metrics-focus`/`exit-metrics-focus`/
  `open-historical-escalation` (still-live routes through `open-escalation`,
  resolved opens the historical view, stale index is a no-op).
- `test/escalation.test.js` — new tests for the historical render branch
  (resolved decision, timed-out "no answer recorded", multi-part LAST
  sub-question, meta/footer, `opts.historical` precedence over a live run,
  `render()`/`routeHandleKey()` threading).
- `test/banner.test.js` — new `suppressedOnOwnScreen` tests for the 4th
  `historicalItem` argument.
- `test/watch.test.js` — new end-to-end test (`withEscalationHistoryHarness`)
  driving the full "open resolved, Escape, open still-live" sequence and a
  historical view surviving several polls without the poll-loop check
  bouncing it back to the fleet.
