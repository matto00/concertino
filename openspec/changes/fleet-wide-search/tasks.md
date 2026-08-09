## 1. Shared match/target module

- [x] 1.1 Create `lib/ui/screens/fleet/search.js` exporting `matchesQuery(text, query)` (case-insensitive substring, `null`/empty-safe), `rowMatches(ticket, title, query)`, `searchTargets(runs, queueState, quickStartTickets, queuedTitles)` (flat, render-ordered list of `{ ticket, title, jump }`, reusing `buildSections`'/`bucketRuns`' section order — the same universe `sectionJumpTargets` in `keys.js` already walks), and `firstMatch(targets, query)`.
- [x] 1.2 Unit tests for `matchesQuery`/`rowMatches` (empty query, case-insensitivity, id-only match, title-only match, no match) and `searchTargets`/`firstMatch` (render order across NEEDS YOU/FAILED/RUNNING/QUICK START/QUEUED/DONE, correct `jump` shape per section kind, a match beyond `MAX_FINISHED`/current scroll still included).

## 2. State and key handling

- [x] 2.1 Add `search: null` to `lib/ui/app-state.js`'s `createAppState()` (mirrors `prompt`'s own `null`-default comment) and thread `search: S.search` through `currentState()`.
- [x] 2.2 In `lib/ui/screens/fleet/keys.js`: bind `/` (unconditional top-level key, alongside `n`/`N`/`s`/`v`'s own bindings — not intercepted by the `focus === 'queue'`/`'quickstart'` blocks) to emit `{ type: 'open-search' }`, gated the same way `n`'s prompt is (no confirmation gate already open).
- [x] 2.3 Add `searchKey(key, search)` in `keys.js` (mirrors `promptKey`): bare Escape/Ctrl-C → `cancel-search`; backspace → `search-backspace`; Enter → `submit-search`; any other single printable char → `search-type`; multi-byte escape sequences ignored.
- [x] 2.4 In `handleKey`, check `if (search) return searchKey(key, search);` immediately after the existing `if (prompt) return promptKey(key, prompt);` line, so an open search box intercepts every key first, exactly as the `n` prompt already does.

## 3. Controller actions

- [x] 3.1 In `lib/ui/controllers/fleet.js`: `open-search` sets `S.search = { value: '' }` (only when `S.prompt`/every confirm gate is falsy — mirrors `open-prompt`'s own precondition).
- [x] 3.2 `search-type` appends `action.char` to `S.search.value`; `search-backspace` slices the last character off.
- [x] 3.3 `cancel-search` sets `S.search = null` — no other field touched.
- [x] 3.4 `submit-search`: build `search.searchTargets(S.runs, S.queueState, ctx.quickStartEligible(), ...)` fresh (never cached — same "re-derive at handling time" discipline `quickstart-add`/`confirm-mark-done` already follow), resolve `firstMatch(targets, S.search.value)`. On a match, dispatch its `jump` action's own existing state mutation inline (reuse `scrollToShow`/the `'jump'`/`'focus-queue'`/`'focus-quickstart'` case bodies directly — do not duplicate their logic a second time) and set `S.search = null`. On no match, leave `S.search` untouched (prompt stays open).
- [x] 3.5 Confirm `queuedTitles` (already threaded into render via `opts.queuedTitles`, see `render.js`) is available to `submit-search`'s target-building — thread it through `ctx` if it is not already reachable there (check how `ctx.deps`/`ctx` currently expose per-poll `queuedTitles`, or pass it via the action itself if simpler).

## 4. Rendering — input line and match highlighting

- [x] 4.1 In `lib/ui/screens/fleet/sections.js`'s `buildHeadTail`: render the search input line via `inputLines({ label: 'search', value: search.value, cols })` in the existing `if/else if` confirm/prompt chain, positioned alongside the `prompt` branch (mutually exclusive with it).
- [x] 4.2 Thread `opts.search`/the active query string down to `renderRun`, `renderFinishedRow`, `renderQueuedRow`, `renderQuickStartRow` in `rows.js` (as a `query` field on each function's existing `opts`/context parameter).
- [x] 4.3 In each of those four renderers, call `search.rowMatches(ticket, title, query)` (ticket/title extracted per that renderer's own existing field access — `run.ticket`/`run.changeName` for `renderRun`/`renderFinishedRow`, the QUEUED `ticket`/looked-up `title` params for `renderQueuedRow`, `ticket.identifier`/`ticket.title` for `renderQuickStartRow`) and wrap the matched ticket-id/title token in `f.yellow` when true.
- [x] 4.4 Thread `opts.search` through `render.js`'s `buildFleetOutput`/`renderFleet` call chain so the query reaches the row-renderer calls in the single-column path.
- [x] 4.5 Thread the same query through `grid.js`'s row-rendering call sites (the grid-mode path reuses the same four row-renderer functions per `rows.js` — verify both paths actually pass `query` through; this is the exact "forgot to forward an opts field to grid mode" mistake CON-40's own header comment in `sections.js` warns against repeating).

## 5. Docs

- [x] 5.1 Add `/` to `docs/dashboard.md`'s fleet-view key table (`## Keys` section), describing: opens search, typing filters/highlights matching rows across every section rendered this frame, `↵` jumps to the first match, `esc` cancels with no state change.

## 6. Verification

- [x] 6.1 Run the existing fleet screen/controller test suites (`test/fleet.test.js`, `test/watch.test.js`, `test/format-colour.test.js`, `test/drilldown.test.js` if it reloads fleet's require cache) to confirm nothing in the existing render/window/digit-jump behavior regressed.
- [x] 6.2 Add coverage for: opening/typing/backspacing/cancelling search leaves `selected`/`scrollOffset`/`focus` untouched; `↵` with a match in each section kind (NEEDS YOU/FAILED/RUNNING/QUICK START/QUEUED/DONE) produces the correct action; `↵` with no match is a no-op that leaves the prompt open; a match beyond a section's `MAX_FINISHED`-capped visible window still highlights/jumps correctly; grid-mode rendering highlights matches identically to single-column mode.
