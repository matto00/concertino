## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (ticket.md, proposal.md, design.md,
tasks.md, spec.md, the full `git diff main...HEAD`, and every changed file read
in full — not the evaluator's narrative).

**AC1 — "A run-archive screen lists every retained run and supports filtering by
ticket id/title, harness, and date range":**
- `lib/ui/screens/archive.js:70-78` `filterArchiveRuns` composes
  `passesSubstringFilter`/`passesHarnessFilter`/`passesDateFilter` over
  `state.runs`, which is `S.runs` — the same array `store.readAll` populates
  every poll from every retained run under `.concertino/runs/`, unbounded by
  the fleet view's `MAX_FINISHED` display cap. Confirmed with a manual repro:
  ran `filterArchiveRuns`/`renderArchive` directly in `node -e` with synthetic
  runs and watched the list/filters render correctly (query, harness "any"
  default, date-range boxes).
- `test/archive.test.js:112-117` is the direct MAX_FINISHED regression
  (tasks.md 6.4) — 8 FAILED runs (> the fleet view's cap of 5) all present in
  `filterArchiveRuns`'s output. I read this test; it is not tautological (it
  builds `runs` independently and asserts length 8).
- Substring filter's empty-query bypass (`archive.js:42-45`) is a real,
  deliberate divergence from `rowMatches`'s own "empty matches nothing"
  behavior, and `test/fleet-search.test.js`'s new guard test
  (lines 141-160 of the diff) confirms `fleet/search.js` itself is
  unmodified and keeps its own empty-query-matches-nothing semantics — so
  CON-110's `/` search is not silently widened by this change.

**AC2 — "Selecting a run opens the same drill-down rendering... reusing
existing panels rather than a parallel read path":**
- `archive.js:300-309`'s list `↵` handler returns the pre-existing,
  unmodified `{ type: 'open-drilldown', ticket: run.ticket }` action.
- `lib/ui/controllers/drilldown.js:32-45` `case 'open-drilldown':` is
  untouched by this diff (confirmed via `git diff` — no changes to
  `controllers/drilldown.js` or `screens/drilldown.js` beyond what's already
  in `main`). The drill-down's own `S.runs.find((r) => r.ticket ===
  S.drillTicket)` lookup works for any ticket in `S.runs`, live or not — no
  new data path.
- `test/archive.test.js:269-273` asserts the exact action shape for a
  non-default `archiveSelected` index (selecting the 2nd of 2 runs), not a
  trivial default-index check.

**AC3 — "Documented in docs/dashboard.md":**
- `docs/dashboard.md` diff adds the `A` row to the fleet-view keys table and
  a new "The run-archive screen" `##` section (after "The PRESETS screen",
  consistent with how sessions/settings sections were each added as their
  own top-level section) documenting the four filter zones, the five-zone
  Tab/Shift-Tab focus order, and the esc-always-to-fleet behavior. Read in
  full; matches the actual implemented behavior, not aspirational.

**Design decisions (design.md Decisions 1-6) actually implemented, not just
claimed:**
- Decision 1 (`A` key, unconditional top-level site): `fleet/keys.js:361`,
  placed after every confirmation gate (`clearQueueConfirm`,
  `markDoneConfirm`, `forceStartConfirm`, `bulkConfirm`, `quitConfirm`), the
  `n` prompt, and the `/` search prompt — read the surrounding 260 lines of
  `keys.js` myself to confirm the ordering, not just the diff hunk.
- Decision 2 (share only the match predicate): `rowMatches` imported
  unmodified (`archive.js:28`), `search.js` untouched per `git diff`.
- Decision 3 (five-zone focus state, `Tab`/`Shift-Tab` only, no `h`/`l`
  alias): `FOCUS_ORDER` is exactly `['query','harness','dateFrom','dateTo','list']`
  (`archive.js:32`); `handleKey` binds only `\t`/`\x1b[Z` to focus movement.
- Decision 4 (`esc` -> generic `back`, no nav stack): `archive.js:275`
  returns `{ type: 'back' }`; `app-state.js`'s `backToFleet()` resets every
  `archive*` field (confirmed in the diff, lines ~434-446).
- Decision 5 (harness list computed fresh, not hardcoded):
  `observedHarnesses` walks `S.runs` fresh every call
  (`controllers/archive.js:85`, called inside the `cycle-archive-harness`
  case, not cached).
- Decision 6 (date-prompt intercepts every key BEFORE focus routing,
  mirroring `settings.js:355-360`): `archive.js:256-263` checks
  `state.archiveDatePrompt` first and returns early; verified `settings.js`
  does the identical prompt-then-focus ordering at the cited lines.

**Gates re-run myself (not taken on faith from evaluation-1.md):**
- Targeted: `node --test test/archive.test.js test/controllers-archive.test.js
  test/router.test.js test/fleet.test.js test/fleet-search.test.js` →
  `# tests 403, # pass 403, # fail 0`.
- Full suite: `npm test` (node --test + all `test/scripts/*.sh` suites) run
  fresh by me in this worktree → `# tests 2020, # pass 2020, # fail 0,
  # cancelled 0`, exit code 0, zero `not ok` lines anywhere in the log. This
  matches evaluation-1.md's claimed result, independently reproduced.

**Manual rendering sanity checks (not scriptable via `node --test` alone):**
- Rendered `renderArchive` at 100 cols with two synthetic runs — filter
  boxes, list rows (ticket/title/harness/status/started), and hint line all
  render correctly with no exceptions.
- Rendered at 20 cols (well under normal terminal width) — degrades to
  truncated boxes and an "no runs match" empty state without throwing;
  confirms the evaluator's own non-blocking note (hardcoded column widths)
  is genuinely cosmetic-only, not a crash risk.

### UI / design judgment (Section 4)

N/A — this is a terminal dashboard (TUI), not a browser UI; no design
standard or dev-server screenshot workflow is configured for this project,
consistent with evaluation-1.md's own "Phase 3: N/A" and the task input.
I did, however, render the new screen directly (above) as the closest
available substitute for visual inspection, since a TUI has no DOM/screenshot
surface to capture — no visual defects found.

### Verdict: CONFIRM

All three acceptance criteria trace to real, working code and passing tests
I ran myself. The two ticket-level design escalations (new key letter;
overlap with CON-110) were resolved and implemented exactly as designed
across 3 confirmed design-gate rounds. No drift between design.md/tasks.md/
spec.md and the actual diff. No regression to `fleet/search.js` or any other
existing screen/controller — every changed file is additive or a narrowly
scoped registration (router.js, controllers/index.js, keys.js, app-state.js).
Full test suite (2020 tests) passes, reproduced independently.

### Non-blocking notes

- Same as evaluation-1.md's own: `archiveRow`/`archiveHeaderRow` column
  widths (9/28/12/10) are hardcoded rather than derived from `cols` — purely
  cosmetic at very narrow terminal widths (confirmed via manual render at 20
  cols: it truncates gracefully, no crash). No responsive-layout requirement
  exists in ticket.md/spec.md, so this is correctly out of scope.
- `submit-archive-date-prompt`'s early return when `S.archiveDatePrompt` is
  falsy is unreachable via the screen's own `handleKey` (the prompt must be
  open to dispatch this action) — harmless defensive code, not a defect.
