## Why

The fleet view's `1`-`9` digit keys jump to a *section*, not a row. Once a
fleet has enough RUNNING/DONE rows that the "… and N more" trim is in play,
finding one specific run or ticket means visually scanning whatever is on
screen — there is no way to type a partial ticket id or title and land
directly on the matching row. As the fleet grows this gets slower exactly
when it matters most (many runs in flight, one specific ticket you need to
check on).

## What Changes

- `/` from the fleet view opens a search prompt (reusing the shared
  `lib/ui/widgets/textinput.js` field, the same widget the `n` new-run prompt
  and the escalation/banner reply boxes already use).
- Typing filters/highlights matching rows live: every row already rendered
  this frame (NEEDS YOU, FAILED, RUNNING, DONE, QUICK START, QUEUED) whose
  ticket id or title/branch-name contains the typed text (case-insensitive
  substring) is visually highlighted; non-matching rows render exactly as
  before — no row is removed from its section or from the on-screen layout
  (see design.md Decision 2 for why this is a highlight, not a filter that
  changes the row count/height budget).
  - **Scope decision (escalated and resolved during planning):** search
    reaches only into what the fleet screen's own section-building already
    produces this frame from `runs[]`/`queueState`/the QUICK START eligible
    list — the same universe the existing `1`-`9` digit-jump
    (`sectionJumpTargets`) already walks. It does **not** query the run
    store, the ticket cache, or anything beyond what a render already has in
    hand for a section's full group (NEEDS YOU/FAILED/RUNNING/DONE's bucketed
    members, QUEUED's pending list, QUICK START's eligible list) — see
    design.md Decision 1.
- `↵` jumps the selection to the first match, in on-screen render order
  (NEEDS YOU, FAILED, RUNNING, QUICK START, QUEUED, DONE — buildSections'
  own existing order), using the same jump mechanics the section-jump digit
  keys already established for each section kind (`'jump'` for a runs-backed
  row, `'focus-queue'`/`'focus-quickstart'` with a resolved row index for
  QUEUED/QUICK START). A submit with no match is a no-op — the search box
  stays open so the query can be corrected.
- `esc` cancels with no state change: `selected`/`scrollOffset`/`focus` are
  never touched by typing into or cancelling out of search — only `↵`
  mutates them, via the ordinary jump action.
- `docs/dashboard.md`'s key table documents `/`.

## Capabilities

### New Capabilities
- `fleet-search`: the fleet view's `/` search prompt — opening/typing/
  cancelling/submitting, the on-screen-only match scope, live highlighting
  of matching rows, and jump-on-submit semantics for each section kind.

### Modified Capabilities
(none — `fleet-section-jump`'s digit-key behavior is unchanged; this adds a
sibling entry point, reusing but not altering its section/row semantics.)

## Impact

- `lib/ui/screens/fleet/keys.js` — bind `/`, add search-mode key handling
  (mirrors `promptKey`).
- `lib/ui/screens/fleet/search.js` (new) — the single shared match predicate
  and target-resolution helper, used by both row highlighting and
  submit-jump resolution so the two can never disagree about what counts as
  a match.
- `lib/ui/screens/fleet/rows.js` — highlight a matching row's ticket-id/
  title token when a search query is active.
- `lib/ui/screens/fleet/sections.js` — render the search input line (via
  `inputLines`) in `buildHeadTail`, mirroring the `n` prompt's own tail
  entry.
- `lib/ui/controllers/fleet.js` — `open-search`/`search-type`/
  `search-backspace`/`cancel-search`/`submit-search` action handling.
- `lib/ui/app-state.js` — new `search` field (`null`, or `{ value }` while
  open), threaded through `currentState()`.
- `docs/dashboard.md` — key table entry.
- No change to `lib/ui/screens/fleet/window.js`/`grid.js`'s row-count or
  height-budget arithmetic — highlighting does not change which rows are
  shown or how many.
