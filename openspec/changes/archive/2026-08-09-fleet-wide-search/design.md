## Context

The fleet view (`lib/ui/screens/fleet.js` facade over `lib/ui/screens/fleet/
*.js`) already has one positional jump mechanism: `1`-`9` digit keys jump to
the *first row of the Nth section rendered this frame* (`fleet-section-jump`,
`sectionJumpTargets` in `keys.js`). CON-110 asks for a second, complementary
mechanism — typed substring search across every row, not just section
starts — reusing the shared `lib/ui/widgets/textinput.js` field the `n`
new-run prompt already uses for its own input line.

The ticket itself flagged one design decision to escalate: whether search
should reach into a section's trimmed-off rows / DONE's cap (querying the
underlying run store beyond what `sections.js` renders) or stay scoped to
what is already on screen this frame. **This was escalated to the human
during planning and resolved as on-screen-only** — see Decision 1.

## Goals / Non-Goals

**Goals:**
- Type-to-filter/highlight across every section actually rendered this
  frame: NEEDS YOU, FAILED, RUNNING, QUICK START, QUEUED, DONE.
- `↵` jumps straight to the first match, reusing each section kind's
  existing jump mechanics (`'jump'`, `'focus-queue'`, `'focus-quickstart'`)
  rather than inventing new navigation primitives.
- `esc` cancels with zero side effects on `selected`/`scrollOffset`/`focus`.
- Works identically in both single-column and grid-mode rendering, by
  routing the highlight decision through the row-renderers
  (`renderRun`/`renderFinishedRow`/`renderQueuedRow`/`renderQuickStartRow`)
  both render paths already share — not by duplicating logic per path.

**Non-Goals:**
- Reaching beyond a section's current bucketed group into the run store,
  ticket cache, or archived/historical runs the fleet view would not
  otherwise show at all (Decision 1 — explicitly out of scope per the
  human's answer).
- Fuzzy/ranked matching, multi-match cycling (`n`/`N`-style "next match"),
  or a match counter. `↵` always takes the single first match in render
  order; nothing else about the acceptance criteria asks for more, and
  adding it now would be scope creep on a ticket already flagged for
  design-decision escalation once.
- Changing `window.js`/`grid.js`'s row-count or height-budget arithmetic.
  Matching rows are highlighted, not extracted into a filtered subset — see
  Decision 2.

## Decisions

### Decision 1: On-screen-only match scope (escalated, resolved)

Search matches only against what `buildSections(bucketRuns(runs), queueState,
opts)` already assembles this frame — the exact same universe
`sectionJumpTargets` (existing digit-jump) already walks: each section's
`.group` array (NEEDS YOU/FAILED/RUNNING/DONE's bucketed run objects,
QUEUED's `queueState.pending` ticket ids, QUICK START's
`opts.quickStartTickets` eligible-ticket objects), filtered to sections that
are actually included this frame (non-empty, or `forceRender`).

This means search reaches every row within a section's *full* bucket (e.g.
all FAILED runs, not just the `MAX_FINISHED`-capped slice a given scroll
position happens to have painted onto the terminal this instant) — mirroring
how digit-jump already lands on a section's first row and scrolls it into
view even if that row was scrolled out of the visible window a moment ago.
What it does **not** do is originate a new query against
`.concertino/runs/`, the ticket cache, or any data source `buildSections`
does not already have in hand from `runs[]`/`queueState`/
`quickStartTickets` — no new store/cache read, no result set larger than
what a render already computed. This is the literal reading of "on-screen"
the escalation's own framing used (`context=`: "no new data access, matches
the section-jump precedent") and the human's chosen `on-screen-only` answer.

### Decision 2: Highlight, not filter-by-removal

The ticket's own wording — "filters/highlights matching rows" — is
ambiguous between two implementations: (a) hide non-matching rows entirely
(shrinking each section's rendered row count), or (b) leave every row in
place and visually distinguish matches. This change implements (b).

Rationale: `window.js`'s `computeWindow`/`visibleWindow` and `grid.js`'s
parallel grid-mode windowing already do real, load-bearing arithmetic keyed
on each section's row *count* (`MAX_FINISHED` caps, the Stage A/B
scroll-and-trim budget, the "… and N more" collapsed line). Making search
dynamically shrink a section's rendered row count would mean re-deriving
that arithmetic per keystroke, in lockstep, in both the single-column and
grid-mode paths — a materially larger, riskier change than this ticket's
acceptance criteria call for, and one that would fight the on-screen-only
scope decision's own spirit (adding a second live-filtered data view on top
of the render layer, rather than annotating what is already there). A
highlight is a pure presentational overlay: the row-renderers
(`rows.js`) already take an `opts`-shaped context object per row (`selected`,
`avgDoneMs`, ...); adding a `query` string to that same context and
conditionally wrapping the matched row's ticket-id/title token in a
highlight colour (reusing `format.js`'s existing `f.yellow`, the same
"needs attention" colour the fleet view already uses elsewhere — no new
colour introduced) costs nothing in the windowing math and cannot disagree
with it, because the row list windowing computes against is unchanged.

Non-matching rows render byte-for-byte as before. There is no "dim
everything else" treatment — with no active query every row already renders
identically to today, and dimming would fight NEEDS YOU/FAILED's own
existing status colouring for visual priority.

### Decision 3: One shared match predicate, two call sites

`lib/ui/screens/fleet/search.js` (new) exports:

- `matchesQuery(text, query)` — pure, case-insensitive substring match;
  `null`/`undefined` `text` never matches; an empty/whitespace-only `query`
  never matches anything (search open with nothing typed highlights
  nothing, and `↵` on an empty query is a no-op, consistent with `promptKey`
  treating an empty `n`-prompt submit as cancel-shaped rather than an
  action).
- `rowMatches(ticket, title, query)` — `matchesQuery(ticket, query) ||
  matchesQuery(title, query)`, the one place "ticket id or title" is
  defined, so row-highlighting and jump-resolution can never define "match"
  two different ways.
- `searchTargets(runs, queueState, quickStartTickets, queuedTitles)` — a
  flat, render-ordered list (reusing `buildSections`' own section order,
  the same list `sectionJumpTargets` derives from) of
  `{ ticket, title, jump }`, where `jump` is already the exact action shape
  the corresponding key/digit press would have produced for that row
  (`{ type: 'jump', index }` for a runs-backed row — NEEDS YOU/FAILED/
  RUNNING/DONE; `{ type: 'focus-queue', index }` for a QUEUED row;
  `{ type: 'focus-quickstart', index }` for a QUICK START row). `title` for
  a run row is `run.changeName` (there is no separate "ticket title" on a
  run object — see `rows.js`'s existing `renderRun`); for QUEUED it is
  looked up from the `queuedTitles` map exactly as `renderQueuedRow` already
  does; for QUICK START it is the eligible ticket object's own `.title`.
- `firstMatch(targets, query)` — `targets.find((t) => rowMatches(t.ticket,
  t.title, query))`, or `undefined`.

Two call sites, both going through `rowMatches`/`matchesQuery` so they can
never drift apart:
1. **Row rendering** (`rows.js`, both the single-column and grid-mode
   paths, since both call the same four row-renderer functions): each
   renderer receives the active query (`opts.searchQuery`, `null` when
   search is not open) and calls `rowMatches` on its own row's id/title to
   decide whether to highlight.
2. **Submit resolution** (`controllers/fleet.js`'s `submit-search` case):
   builds `searchTargets` fresh (never a value cached from a previous
   frame — the same "re-derive at handling time" discipline
   `quickstart-add`/`confirm-mark-done` already follow) and calls
   `firstMatch`.

### Decision 4: State shape mirrors `prompt`, not `focus`

`S.search` is `null`, or `{ value: '' }` while open — structurally
identical to `S.prompt`'s own `{ value, error }` (minus `error`: there is no
invalid-input case for a free-text search query the way there is for the
`n` prompt's ticket-shape validation). It is **not** a `focus` value (unlike
`'queue'`/`'quickstart'`) — `focus` describes which row-index space `j`/`k`
currently move within, and search never repurposes `j`/`k` at all (typing
`j` while search is open types the letter `j` into the query, exactly as
typing `j` into the `n` prompt already does).

`keys.js`'s `handleKey` checks `if (search) return searchKey(key, search);`
immediately after (mirroring, not replacing) the existing
`if (prompt) return promptKey(key, prompt);` line — an open search box
intercepts every keystroke first, exactly as an open prompt already does,
so a digit typed while searching filters rather than triggering
section-jump, and `n`/`q`/etc. type into the query rather than firing their
own bindings.

`/` itself is bound alongside the other unconditional top-level single-key
bindings (`n`, `N`, `s`, `v`) — reachable regardless of current `focus`,
matching those keys' own precedent (falling through
`focus === 'queue'`/`'quickstart'`'s block, since neither block claims `/`).
Opening search does not itself touch `focus`/`selected`/`scrollOffset` —
only a resolved jump on submit does, via each target kind's existing action
handler (`'jump'` already resets `focus` to `'runs'`; `'focus-queue'`/
`'focus-quickstart'` already set the right local cursor).

### Decision 5: Rendering the input line

`buildHeadTail` (`sections.js`) already special-cases `prompt` to render the
`n`-prompt's input line via `inputLines()` in its `tail` array, ahead of the
ordinary hint-line footer. The search box reuses the identical mechanism —
`inputLines({ label: 'search', value: search.value, cols })` — checked in
the same `if/else if` chain `buildHeadTail` already threads
`clearQueueConfirm`/`forceStartConfirm`/`markDoneConfirm`/`quitConfirm`/
`prompt` through, positioned alongside `prompt` (the two are mutually
exclusive — only one of `S.prompt`/`S.search` can be open at a time, since
each of `open-prompt`/`open-search` only fires once neither a confirm gate
nor the other one is already open, matching how `n`'s own prompt already
refuses to open over a live confirm).

## Risks / Trade-offs

- **Highlight-not-filter may read as a smaller feature than "filters" implies
  to a user skimming the ticket title alone.** Mitigated by Decision 2's
  explicit rationale being visible in this document and by the acceptance
  criteria's own actual wording ("filters/highlights... live") accommodating
  either reading; the skeptic gate is the place to contest this judgment
  call if it disagrees.
- **`search.js` introduces a fourth row-shape into a single predicate**
  (run/QUEUED-ticket-id/QUICK-START-ticket-object) — mitigated by keeping
  `matchesQuery`/`rowMatches` shape-agnostic (plain `ticket`/`title`
  strings only; each call site is responsible for extracting those two
  strings from its own row shape before calling in, exactly as `rows.js`'s
  existing renderers already do their own per-shape field access).
- **Grid mode is a second render path** (`grid.js`) that must also thread
  `searchQuery` through to the shared row renderers — missing this would
  mean search visibly works in narrow terminals but silently does nothing
  in wide ones. Flagged explicitly in tasks.md as its own task, mirroring
  the exact `augmentedOpts`/`quickStartTickets`-forwarding mistake CON-40's
  own header comment in `sections.js` warns future changes against
  repeating.
