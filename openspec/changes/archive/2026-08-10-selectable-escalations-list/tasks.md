## 1. Escalation history data (design.md Decision 1)

- [x] 1.1 In `lib/ui/screens/fleet/metrics.js`, add the raised/resolved
      pairing walk described in design.md Decision 1: replace the existing
      raised-only `recentEscalations` loop with one that also matches each
      `escalation.raised` to its later `escalation.answered`/
      `escalation.timeout` within the same run's `events` array, producing
      `{ ticket, role, question, options, subQuestions, raisedAt, resolved,
      decision, resolvedAt, timedOut }` entries, newest-first. Join
      `sub_answers` into one `decision` string per the design. Normalize the
      raw `ev.options`/`ev.sub_questions` fields using the SAME helpers
      `reducer.js`'s live-escalation fold already uses (`toOptions()`, the
      defensive `sub_questions` `JSON.parse`) — export `toOptions()` from
      `reducer.js` (or lift both into a small shared module) rather than
      re-implementing the parsing.
- [x] 1.2 Export this list from `metricsFor()`'s return value (rename/keep
      `recentEscalations` as the field name so existing callers/tests that
      only read the raised-only shape are examined and updated deliberately,
      not left silently reading a shape that changed underneath them).
- [x] 1.3 Unit tests in the existing metrics test file: resolved
      single-question, timed-out, still-live, and multi-part joined-decision
      cases (spec.md's four scenarios for this requirement).

## 2. Windowed, focusable rendering (design.md Decisions 2-3)

- [x] 2.1 In `metricsColumnLines()`, accept `focused`/`selectedIndex` opts;
      when unfocused, keep today's leading-`rowsForList`-entries rendering
      byte-for-byte unchanged. When focused, window via
      `layout.selectionWindow(total, selectedIndex, rowsForList,
      selectedIndex)` (mirroring `evidenceWindow()`), rendering the selected
      row with the `▸ `/`f.bold()` convention `evidenceLines()` already uses.
- [x] 2.2 In `lib/ui/screens/fleet/keys.js`: add a `focus === 'metrics'`
      block mirroring `focus === 'quickstart'` (`j`/`k` →
      `move-metrics-focus`, `↵` → `open-historical-escalation`, Escape →
      `exit-metrics-focus`, `l`/arrow-right/`n`/`N` suppressed). Change the
      digit-jump switch's `case 'metrics': return null;` to
      `{ type: 'focus-metrics', index: 0 }`.
- [x] 2.3 In `lib/ui/controllers/fleet.js`: add `focus-metrics` (mirrors
      `focus-quickstart`/`applyJumpAction`), `move-metrics-focus` (clamped
      against a freshly recomputed history length, mirrors
      `move-quickstart-focus`), `exit-metrics-focus` (mirrors
      `exit-quickstart-focus`).
- [x] 2.4 In `lib/ui/app-state.js`/`lib/ui/watch.js`: add
      `S.metricsEscalationFocus`, re-clamped every `draw()` the same way
      `S.quickStartFocus` is (recompute history length fresh; reset to `0`
      if `focus === 'metrics'` and the cursor is out of range). Thread
      `focused`/`selectedIndex` opts into the `metricsColumnLines()` call
      site(s) in `fleet/grid.js`/`fleet/sections.js`.
- [x] 2.5 Unit tests: digit-jump onto METRICS sets `focus`, `j`/`k` move and
      window the selection past the visible rows, Escape exits without
      hiding the panel (spec.md's three scenarios for this requirement).

## 3. Historical detail view, reusing the live escalation screen (design.md Decision 4-5)

- [x] 3.1 `open-historical-escalation`'s handler in
      `lib/ui/controllers/fleet.js`: re-derive the history list fresh,
      resolve `action.index` to an entry (no-op if out of range/stale). If
      `entry.resolved === false`, dispatch through the SAME existing
      `'open-escalation'` handling (same `S.mode`/`S.escalationTicket`
      assignment, same wizard-resume read) — do not duplicate that logic.
      If `entry.resolved === true`, set `S.mode = 'escalation'` and a new
      `S.escalationHistoryItem = entry` (never reusing `S.escalationTicket`
      for this). Add `S.escalationHistoryItem = null` to the top of the
      `'open-escalation'` handler itself (`lib/ui/controllers/escalation.js`)
      so opening a live escalation always starts from a clean slate, even if
      a historical view was previously open (design.md Decision 4's round-2
      correction).
- [x] 3.2 In `lib/ui/screens/escalation.js`: `renderEscalation` accepts
      `opts.historical`; when present, render the read-only branch described
      in design.md Decision 4 (question/options from the entry — for a
      multi-part entry, exactly `subQuestions[subQuestions.length - 1]`, the
      LAST sub-question, never `subQuestions[0]` — no option keys,
      `decision: ...` or "no answer recorded (timed out)" line, `esc
      back`-only footer, `meta` shows resolvedAt-relative time). No change
      needed to `handleKey` — its existing `!run` branch already produces
      "only Escape handled" once `run` is `null` for a historical view.
- [x] 3.3 `render(state, opts)`/`routeHandleKey(key, state)`: read
      `state.escalationHistoryItem` and thread it through as
      `opts.historical`/`state.historical`, alongside the existing
      `state.escalationTicket` lookup — no change to `lib/ui/router.js`'s
      own dispatch.
- [x] 3.4 Add `S.escalationHistoryItem = null` to `backToFleet()`'s existing
      reset list in `lib/ui/app-state.js`, alongside `escalationTicket`/
      `escalationReply`/`escalationNotice`/`escalationContextScroll`/
      `escalationSubIndex` (design.md Decision 4's round-2 correction).
- [x] 3.5 Fix `lib/ui/watch.js`'s "walk back to fleet if `run.escalation`
      clears" poll-loop check (currently keyed off `S.mode === 'escalation'`
      alone, so it looks up `S.runs.find(r => r.ticket === S.escalationTicket)`
      — `null` for a historical view — finds nothing, and bounces the
      historical view back to the fleet on the very next poll): gate it on
      `S.mode === 'escalation' && !S.escalationHistoryItem` per design.md
      Decision 4's correction.
- [x] 3.6 Change `lib/ui/banner.js`'s `suppressedOnOwnScreen` signature to
      `suppressedOnOwnScreen(mode, escalationTicket, liveEscalations,
      historicalItem)`, returning `true` when `mode === 'escalation' &&
      !!historicalItem` in addition to its existing condition. Update BOTH
      call sites in `lib/ui/watch.js` (`computeScreenRows()` and `draw()` —
      confirmed via `grep -n "suppressedOnOwnScreen" lib/ui/watch.js`) to pass
      `S.escalationHistoryItem` as the new fourth argument.
- [x] 3.7 Unit tests: opening a still-live entry reaches the unmodified
      live-screen render/handleKey path; opening a resolved entry renders
      the historical branch with its decision, using the LAST sub-question
      for a multi-part entry; opening a timed-out entry renders "no answer
      recorded" (spec.md's three scenarios for this requirement). Add a
      regression test for the full sequence: open a resolved entry, press
      Escape, open a still-live entry — assert the live screen renders the
      live question (not the stale historical one), and that the poll-loop
      check (task 3.5) is live again for it. Add a regression test asserting
      a historical view survives several polls with `S.mode` remaining
      `'escalation'` and `S.escalationHistoryItem` intact.

## 4. Docs

- [x] 4.1 Document the new interaction in `docs/dashboard.md`: how to focus
      METRICS' recent-escalations list, scroll/paginate it, and open a
      historical or still-live entry's detail view.

## 5. Verification

- [x] 5.1 Run the full test suite and linter; fix any regressions.
- [x] 5.2 Manual smoke check against a local run history containing at least
      one resolved, one timed-out, and (if available) one still-live
      escalation, confirming the compact/expanded METRICS tiers and both
      detail-view branches render correctly at a real terminal width.
