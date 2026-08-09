# Files modified — CON-110 fleet-wide search (`/`)

- `lib/ui/screens/fleet/search.js` (new) — the shared match predicate/target-resolution module: `matchesQuery`, `rowMatches`, `searchTargets`, `firstMatch`.
- `lib/ui/screens/fleet/keys.js` — binds `/` to `open-search`; adds `searchKey(key, search)` (mirrors `promptKey`); `handleKey` intercepts every key while `state.search` is open, immediately after the `n`-prompt check.
- `lib/ui/screens/fleet/sections.js` — `buildHeadTail` renders the search input line (`inputLines`) and its own `↵ jump   esc cancel` footer hint, mutually exclusive with the `n` prompt's own branch.
- `lib/ui/screens/fleet/rows.js` — `renderRun`/`renderFinishedRow`/`renderQueuedRow` read a new `searchQuery` field on their existing `opts`/context parameter; `renderQuickStartRow` (the one renderer with no `opts` parameter) gains a new trailing `query` parameter instead. All four wrap a matched ticket-id/title token in `f.yellow` via `search.matchesQuery`.
- `lib/ui/screens/fleet/render.js` — `buildFleetOutput` derives `searchQuery` from `opts.search.value`, threads it through `augmentedOpts` (grid-mode ctx) and each single-column row-renderer call; `mergeRenderOpts` forwards `state.search` from `currentState()`.
- `lib/ui/screens/fleet/grid.js` — `renderFleetGrid`/`renderStackedSection` thread `searchQuery` through to the same four row-renderer calls in the grid-mode path, so highlighting never silently works in one render path and not the other.
- `lib/ui/screens/fleet.js` — facade: re-exports `search.js`'s functions and `keys.js`'s `searchKey`, and busts `./fleet/search`'s require-cache entry alongside every other fleet/*.js submodule.
- `lib/ui/app-state.js` — new `search` field (`null`, or `{ value }` while open) in `createAppState()`; threaded through `currentState()`.
- `lib/ui/controllers/fleet.js` — `open-search`/`search-type`/`search-backspace`/`cancel-search`/`submit-search` action handling; factors the shared `applyJumpAction(ctx, jump)` helper out of the existing `jump`/`focus-queue`/`focus-quickstart` cases so `submit-search`'s own resolved jump reuses the identical state mutation rather than duplicating it.
- `lib/ui/watch.js` — adds `queuedTitlesFor()` (factored out of `draw()`'s own inline computation) and exposes it as `ctx.queuedTitles`, so `submit-search`'s controller handler (running outside `draw()`, at keypress time) can resolve a QUEUED match's title.
- `docs/dashboard.md` — documents `/` in the fleet-view key table.

## Tests

- `test/fleet-search.test.js` (new) — unit tests for `search.js`'s `matchesQuery`/`rowMatches`/`searchTargets`/`firstMatch`.
- `test/fleet.test.js` — `handleKey('/', ...)`/`searchKey` pure-function tests; plain-text rendering tests for the search input line/footer hint and match-content (colour itself is out of scope here — see `format-colour.test.js`).
- `test/format-colour.test.js` — the actual `f.yellow` highlighting assertions (the one file in this repo that forces `isTTY` so escape codes are observable), covering RUNNING/DONE/QUEUED/QUICK START matches, title-only matches, empty-query-highlights-nothing, and grid-mode parity with single-column mode.
- `test/controllers-fleet.test.js` — `open-search`/`search-type`/`search-backspace`/`cancel-search`/`submit-search` controller action tests, including a match in each section kind (NEEDS YOU/RUNNING/FAILED/DONE/QUEUED/QUICK START), a title-only match, no-match-is-a-no-op, and an already-null `S.search` defensive no-op. Also strengthens the shared `run()` test fixture with the fields `renderRun`'s 2-line NEEDS YOU/RUNNING path needs (previously only FAILED/DONE's 1-line `renderFinishedRow` path was exercised there).
- `test/watch.test.js` — three end-to-end tests driving the real `watch()` loop: `/` + typing + `↵` jumping to a scrolled-past section's matching row (mirroring the existing digit-jump end-to-end test), `esc` cancelling with no state change, and `↵` with no match leaving the prompt open.
