## 1. Fleet-view entry point

- [x] 1.1 Bind `A` in `lib/ui/screens/fleet/keys.js#handleKey` to
      `{ type: 'open-archive' }`, at the same unconditional top-level site
      as `s`/`v`/`N` (after every confirmation gate, the `n` prompt, and the
      `/` search prompt have already had first refusal).
- [x] 1.2 Update `docs/dashboard.md`'s fleet-view keys table with the new
      `A` binding and a one-line description.

## 2. Archive screen state (app-state.js)

- [x] 2.1 Add `archiveQuery`, `archiveHarnessFilter`, `archiveDateFrom`,
      `archiveDateTo`, `archiveSelected`, `archiveFocus`, `archiveDatePrompt`
      to the initial state shape in `lib/ui/app-state.js` (design.md
      Decision 3 — `archiveFocus` defaults to `'query'`; `archiveDatePrompt`
      defaults to `null`; the rest default to `null`/`0` as sessions.js's
      own fields do).
- [x] 2.2 Include the new fields in `currentState()`'s returned snapshot
      (mirroring the existing `sessionsData: S.sessionsData, ...` block).
- [x] 2.3 Reset the new fields in the existing "leaked staged state" reset
      path (mirroring `S.sessionsData = null; ...` there).

## 3. Archive screen (`lib/ui/screens/archive.js`)

- [x] 3.1 Pure render function: given `{ runs, archiveQuery,
      archiveHarnessFilter, archiveDateFrom, archiveDateTo, archiveSelected,
      archiveFocus, archiveDatePrompt }`, compute the filtered/sorted list
      (substring match: empty/whitespace query passes every run per
      design.md Decision 2's bypass, non-empty query delegates to
      `rowMatches` imported unmodified from `lib/ui/screens/fleet/
      search.js`; harness equality; `startedAt` range) and render it as a
      scrollable, selectable list — one row per matching run (ticket id,
      title/`changeName`, harness, status, started-at).
- [x] 3.2 Render the four filter controls (substring input, harness
      selector, date-from, date-to) above the list, each visually marked
      as focused when `archiveFocus` matches it — following the visual
      pattern of the settings screen's focused-pane rendering
      (`layout.box(..., { focused })`). When `archiveDatePrompt` is set,
      render its own in-progress `value` and, if present, its `error` as a
      one-line notice next to the field it belongs to (mirroring
      `settings.js`'s own `settings.prompt.error` rendering).
- [x] 3.3 Pure `handleKey(key, state)`, checking `state.archiveDatePrompt`
      FIRST — before any `archiveFocus`-based routing — mirroring
      `settings.js:355-360`'s own prompt-then-focus ordering exactly
      (design.md Decision 6, skeptic gate round 2 fix):
      - **While `state.archiveDatePrompt` is set:** `esc` returns
        `{ type: 'cancel-archive-date-prompt' }` (clears the prompt only —
        does NOT dispatch `back`, does NOT touch `archiveFocus` or any
        committed filter). Backspace returns
        `{ type: 'archive-date-prompt-backspace' }`. Any other printable
        character returns `{ type: 'archive-date-prompt-type', char }`.
        `↵` returns `{ type: 'submit-archive-date-prompt' }` (the
        controller runs task 3.4's parser against
        `archiveDatePrompt.value`). No other key does anything while the
        prompt is open.
      - **Once `state.archiveDatePrompt` is `null`,** ordinary
        `archiveFocus`-gated routing applies:
        - `Tab` / `Shift-Tab`: cycle `archiveFocus` forward/backward
          through `['query', 'harness', 'dateFrom', 'dateTo', 'list']`,
          wrapping at both ends (design.md Decision 3).
        - `archiveFocus === 'query'`: typing/backspace updates
          `archiveQuery` live; `↵` is a no-op (filtering is already
          live — Tab is how the operator moves on, per design.md
          Decision 6).
        - `archiveFocus === 'harness'`: `↵`/`space` returns a
          `cycle-archive-harness` action (design.md Decision 6 — the
          controller computes the next observed value and wraps to
          "any").
        - `archiveFocus === 'dateFrom'` / `'dateTo'`: `↵` returns
          `{ type: 'open-archive-date-prompt', bound: 'dateFrom' |
          'dateTo' }` — the controller seeds `archiveDatePrompt` from the
          currently-committed bound, formatted `YYYY-MM-DD` (empty if
          unset).
        - `archiveFocus === 'list'`: `j`/`k` (and arrow aliases) move the
          list cursor; `↵` on a selected row returns
          `{ type: 'open-drilldown', ticket }` (the existing action,
          unmodified).
        - `esc` (any focus, prompt closed): returns `{ type: 'back' }`.
- [x] 3.4 Date-prompt submission parsing lives here (or in a small shared
      helper this screen owns): validate strict `YYYY-MM-DD`, convert to
      start-of-day (`dateFrom`)/end-of-day (`dateTo`) local-time ms epoch,
      reject anything else without throwing — design.md Decision 6's three
      scenarios (valid/empty/invalid submission).

## 4. Controller (`lib/ui/controllers/archive.js`)

- [x] 4.1 `open-archive`: reset `archiveQuery`/`archiveHarnessFilter`/
      `archiveDateFrom`/`archiveDateTo`/`archiveSelected`/`archiveDatePrompt`
      to their defaults, set `archiveFocus = 'query'`, and set
      `S.mode = 'archive'`, mirroring `sessions.js#openSessions`.
- [x] 4.2 `cycle-archive-harness`: compute the distinct, non-null
      `harness` values currently present in `S.runs`, advance
      `S.archiveHarnessFilter` to the next one in that freshly-computed
      list (or wrap to `null` — "any" — from the last), and clamp
      `archiveSelected` back into range of the newly-filtered list length,
      mirroring `sessions.js#refreshSessions`'s own clamp.
- [x] 4.3 `open-archive-date-prompt`: set `S.archiveDatePrompt = { bound:
      action.bound, value: <action.bound's currently-committed value
      formatted YYYY-MM-DD, or ''>, error: null }`.
- [x] 4.4 `archive-date-prompt-type` / `archive-date-prompt-backspace`:
      mutate `S.archiveDatePrompt.value` in place (append/trim),
      mirroring how `S.prompt.value`/`settings.prompt.value` are mutated
      by their own type/backspace actions.
- [x] 4.5 `submit-archive-date-prompt`: parse `S.archiveDatePrompt.value`
      via task 3.4's helper. On a valid non-empty value: set
      `S.archiveDateFrom`/`S.archiveDateTo` (whichever `archiveDatePrompt.
      bound` names) to the parsed ms epoch and clear `S.archiveDatePrompt`
      back to `null`. On an empty value: clear that bound to `null` and
      clear `S.archiveDatePrompt` back to `null`. On an unparseable
      non-empty value: leave the committed bound unchanged and set
      `S.archiveDatePrompt.error` to a one-line message, leaving the
      prompt open. Any successful commit also clamps `archiveSelected`
      back into range of the newly-filtered list length.
- [x] 4.6 `cancel-archive-date-prompt`: clear `S.archiveDatePrompt` back to
      `null` — nothing else changes (design.md Decision 6: this is NOT the
      generic `back` action).
- [x] 4.7 Query-typed/backspace actions: mutate `archiveQuery` and clamp
      `archiveSelected` back into range, mirroring
      `sessions.js#refreshSessions`'s own clamp.
- [x] 4.8 List-cursor movement action, mirroring
      `sessions.js#moveSessions`.
- [x] 4.9 Register the new controller module in
      `lib/ui/controllers/index.js`'s `CONTROLLERS` array.

## 5. Wiring into `router.js`

- [x] 5.1 Register `'archive'` in `lib/ui/router.js`'s `SCREENS` map
      (**not** a `watch.js` render switch — `watch.js` calls
      `router.render`/`router.handleKey` uniformly; `router.js:27-55` is
      the actual per-mode registry, alongside the existing `'sessions'`/
      `'settings'`/`'drilldown'` entries — skeptic gate round 1, change
      request 2), pointing at the new screen's render/handleKey exports.
- [x] 5.2 Confirm `onKey`'s existing `router.handleKey`/`applyAction` path
      requires no special-casing for `'archive'` mode — the generic `'back'`
      handling (`backToFleet()`) already covers `esc`, matching Decision 4
      in design.md.

## 6. Tests

- [x] 6.1 `test/archive.test.js` (or co-located per project convention,
      matching `test/sessions.test.js`'s naming): pure render/handleKey
      tests — substring/harness/date filtering (individually and combined),
      empty-query-shows-everything (the explicit bypass, not `rowMatches`'s
      own empty-query-matches-nothing default), `Tab`/`Shift-Tab` focus
      cycling and wrapping, per-focus key dispatch (query typing, harness
      `↵`, date-field `↵` opening the prompt, list `j`/`k`/`↵`), the
      prompt-open key routing (typing/backspace mutate the prompt, `↵`
      submits, `esc` cancels the prompt only — verified by asserting
      `archiveFocus` and every committed filter are unchanged after a
      prompt-cancel `esc`, distinct from an ordinary `esc` producing
      `back`), `↵` on a selected list row producing the correct
      `open-drilldown` action, `esc` producing `back` only when no prompt
      is open.
- [x] 6.2 `test/controllers-archive.test.js` (matching
      `test/controllers-sessions.test.js`'s naming): `open-archive` resets
      state correctly including `archiveFocus`/`archiveDatePrompt`;
      `cycle-archive-harness` advances through observed values and wraps
      to "any"; `open-archive-date-prompt` seeds `archiveDatePrompt` from
      the currently-committed bound; `submit-archive-date-prompt` commits
      the bound and clears the prompt on valid input, clears the bound and
      the prompt on an empty submission, and leaves the bound unchanged
      while setting `archiveDatePrompt.error` (prompt stays open) on
      invalid input; `cancel-archive-date-prompt` clears the prompt
      without touching `archiveFocus` or any committed filter;
      query/cursor actions mutate the right fields and clamp
      `archiveSelected`; the controller returns `false` for actions it
      doesn't own.
- [x] 6.3 Update/extend `test/fleet-search.test.js` or add a targeted
      assertion confirming `matchesQuery`/`rowMatches` are unmodified
      (import-only reuse) — guards Decision 2 in design.md against a future
      accidental widening of `fleet-search`'s own scope.
- [x] 6.4 A regression test confirming a run beyond the fleet view's
      DONE/FAILED display cap (`MAX_FINISHED`) still appears in the archive
      screen's list — the direct proof of proposal.md's core claim.

## 7. Documentation

- [x] 7.1 `docs/dashboard.md`: document the run-archive screen (its own
      subsection, following the existing sessions/settings screen
      subsections' structure) — what it lists, its three filters, and how
      selecting a row opens the drill-down.
