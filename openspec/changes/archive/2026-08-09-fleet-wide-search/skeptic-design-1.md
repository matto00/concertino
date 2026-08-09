## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-search/spec.md` in full.
- Read the actual current codebase these artifacts claim to build on:
  `lib/ui/screens/fleet/keys.js`, `lib/ui/app-state.js`,
  `lib/ui/controllers/fleet.js`, `lib/ui/screens/fleet/sections.js`,
  `lib/ui/screens/fleet/rows.js`, `lib/ui/screens/fleet/render.js`,
  `lib/ui/screens/fleet/window.js`, `lib/ui/screens/fleet/grid.js`,
  `lib/ui/widgets/textinput.js`, `lib/ui/watch.js` (the `ctx`/
  `quickStartEligible`/`queuedTitles` wiring), `lib/ui/format.js` (ANSI-aware
  `truncate`/`visibleLength`, confirming the highlight-via-`f.yellow` plan is
  safe), and `docs/dashboard.md`'s existing `## Keys` table.
- Cross-checked every concrete claim design.md/tasks.md make about the
  existing code against what is actually there:
  - `sectionJumpTargets`/`handleKey`'s digit-jump precedent (`keys.js:47-81,
    160-180`) — matches design.md's Context/Decision 1 description exactly
    (same `buildSections`/`bucketRuns` universe, same render order, same
    `'jump'`/`'focus-queue'`/`'focus-quickstart'` action shapes).
  - `promptKey`/`if (prompt) return promptKey(...)` (`keys.js:19-45, 141`) —
    the pattern Decision 4/tasks 2.3-2.4 say `searchKey`/`if (search) return
    searchKey(...)` should mirror. Confirmed the ordering claim (search must
    intercept before `n`/digit keys) is consistent with `handleKey`'s actual
    control flow — confirm gates return before reaching either `prompt` or
    `search`, so `/` correctly cannot open search while a confirm or the `n`
    prompt is up, and vice versa (matches spec.md's own scenarios).
  - `buildHeadTail`'s `if/else if` confirm/prompt chain (`sections.js:206-411`)
    — confirmed a `search` branch can be added alongside `prompt` exactly as
    Decision 5 describes, using the real `inputLines({label, value, cols,
    error})` signature (`widgets/textinput.js:17`).
  - `buildSections`' `s.group` is the section's **full** bucket (not
    window-capped) — `sections.js:119-196` — confirming Decision 1's central
    claim ("search reaches every row in a section's full bucket, not just
    the visible slice") is technically accurate, and that this is exactly
    the same universe `sectionJumpTargets` already reaches.
  - `mergeRenderOpts`/`buildFleetOutput`/`renderFleetGrid`/
    `renderStackedSection` (`render.js`, `grid.js`) — confirmed both the
    single-column and grid-mode paths call the same four row renderers
    (`renderRun`/`renderFinishedRow`/`renderQueuedRow`/`renderQuickStartRow`),
    validating the design's core risk callout (Decision 3's "fourth
    row-shape" risk, and the Risks section's grid-mode-forwarding risk) is
    real and correctly flagged, not invented.
  - `ctx.quickStartEligible()` exists (`watch.js:506-515, 543`); `queuedTitles`
    is currently built inline in `draw()` (`watch.js:782`), **not** exposed on
    `ctx`. This confirms tasks.md 3.5's own uncertainty ("thread it through
    `ctx` if it is not already reachable there") is a real, correctly-flagged
    gap, not a fabricated one — the task gives the implementer a concrete,
    bounded instruction either way, which is acceptable specificity for a
    design gate.
  - Escalation resolution recorded in ticket.md/proposal.md/design.md
    Decision 1 is internally consistent across all three documents (no
    lingering "TBD" — the ticket's own escalated question is answered and
    the answer is used consistently throughout).
- Checked for a `/` key collision: `grep` across `lib/ui/screens/`,
  `lib/ui/controllers/` found no existing `/` binding.

### One concrete inaccuracy found (non-blocking)

`lib/ui/screens/fleet/rows.js:220` — `renderQuickStartRow(ticket, focused,
width)` takes **no** `opts`/context parameter at all (unlike `renderRun`,
`renderFinishedRow`, and `renderQueuedRow`, which all already do). Design.md
Decision 3 and tasks.md 4.2 both describe threading the search query in "as a
query field on each function's existing opts/context parameter" — that
description is accurate for three of the four renderers but not this one;
`renderQuickStartRow` will need an actual new parameter added (not a field
added to something already there), at both of its call sites
(`render.js:255`, `grid.js:258`). This is self-evident the moment the
executor opens `rows.js` for task 4.2/4.3, and the fix is mechanical and
low-risk, so it does not block the design — but is worth a one-line
correction to design.md/tasks.md for accuracy's own sake, given how much
weight this document otherwise correctly places on "verified against the
real file," not assumed.

### Non-blocking notes

1. Minor naming inconsistency between artifacts: design.md Decision 3 calls
   the threaded query `opts.searchQuery`; tasks.md 4.2/4.4 call the same
   thing `opts.search`. Doesn't block implementation (a single executor will
   just pick one), but worth reconciling for internal consistency.
2. See "One concrete inaccuracy found" above — `renderQuickStartRow`'s
   missing opts parameter.

### Verdict: CONFIRM

The design is sound, internally consistent, and unusually well grounded in
the actual codebase — every non-trivial claim about existing mechanics
(digit-jump's target universe, the `prompt`/confirm-gate key-interception
order, the `buildHeadTail` chain, the shared row-renderers across
single-column and grid mode, `MAX_FINISHED`'s cap being render-time only)
checked out against the real files. The one escalated design decision from
the ticket is resolved and consistently applied everywhere it matters
(spec.md's scenarios, design.md's Decision 1, tasks.md's task descriptions).
Acceptance criteria are each traceable to a specific requirement/scenario in
spec.md and a specific task in tasks.md. No placeholders, no unresolved
TBDs, no scope drift, no missing contract updates (docs/dashboard.md's key
table update is task 5.1). The two items above are real but minor and
self-resolving during implementation — noted for the record, not blocking.
