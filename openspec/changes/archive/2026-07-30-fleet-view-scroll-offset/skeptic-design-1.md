## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-view-scroll/spec.md` in full.
- Read `lib/ui/screens/fleet.js` in full, in particular:
  - The existing per-section cap (`shown[i] = Math.min(group.length, cap)`,
    line 259) and the whole-frame height-budget trim loop (`sectionHeight`/
    `height`/`budget`, lines 259-291), which decrements `shown[i]` from the
    LAST section backward until `height() <= budget`.
  - The render loop (lines 293-355) confirming that today, "shown" always
    means "the first `shown[i]` rows of the group" — `s.group[k]` for
    `k in [0, shown[i])` — so decrementing `shown[i]` always drops the
    section's *lowest-priority* (latest/tail) rows.
  - The shared `index` counter (lines 294, 307, 317-332) that both
    `selected` and the new `scrollOffset` are defined against, and its
    `!s.unselectable` guard around `QUEUED`.
- Read `lib/ui/screens/launchpad.js` in full — confirmed the analogous,
  *stateless*, recomputed-every-render `windowStart(index, total, max)` the
  design correctly identifies as a worse fit here (a centering window would
  make the scroll position jump on every keypress, contradicting the
  ticket's `j`/`k`-scrolls-the-view framing).
- Read `lib/ui/watch.js`'s `selected` clamp (line 466), `move` handler (line
  729-731), `currentState()` (lines 308-314), and the `router.render` call
  site (lines 531-537) — confirmed `selected` reaches `fleet.js`'s
  `render(state, opts)` via `state.selected` (from `currentState()`), *not*
  via the `opts` object literally passed to `router.render` (`{cols, rows,
  now, queuedTitles, ticketText}`).
- Read `test/fleet.test.js`'s existing marker-alignment test (line 574) and
  the whole-frame-trim test with all four sections populated (line
  376-402) — confirmed the latter only ever exercises `selected: 0`
  (never a non-zero `scrollOffset`), so it would not catch a scroll/trim
  interaction bug.

### Verdict: REFUTE

The core scroll-window mechanism (Decisions 1-4) is a sound match for the
existing pure-`(runs, opts)` renderer and the `watch.js`-owns-state
precedent `launchpad.js` sets. But the design leaves one materially
important interaction unspecified, in a way a competent implementer could
plausibly get wrong and ship a regression of the exact bug this change
exists to fix — in exactly the scenario (small terminal heights) the
ticket calls out as an explicit acceptance criterion.

### Change Requests

1. **Unspecified trim direction for a scroll-straddled section under the
   whole-frame height budget.** Decision 2 says a section straddling
   `scrollOffset` "renders its tail; every section after that renders from
   its own start, subject to `MAX_FINISHED` and the height budget *exactly
   as today*." "Exactly as today" is the problem: today's trim loop
   (`fleet.js` lines 284-291) always trims from the tail of whatever a
   section is currently showing, which is correct when a section renders
   from its own start (offset 0) — the rows it drops are the lowest-
   priority ones. But for the section straddled by `scrollOffset` (the one
   whose visible window starts mid-group, at a non-zero `startOffset`), the
   *tail* of that window is exactly the row `watch.js` scrolled down *to*
   (Decision 3: "scroll down if `selected` > `lastVisibleIndex`" — i.e.
   scrolling down stops the instant the target row becomes the last visible
   row of its section). If the whole-frame budget then still doesn't fit
   and further trims that same straddled section, applying the existing
   "cut the tail" rule un-modified cuts off precisely the row that was just
   scrolled into view — silently reintroducing the "selected row not
   rendered" bug on a terminal short enough to need the whole-frame trim at
   all, which is exactly the case AC4 ("Behaviour is sane at very small
   terminal heights") puts in scope. Concretely: with `MAX_FINISHED=5`, if
   `scrollOffset` has positioned `FAILED`'s window at `group[10..15)` with
   `selected` resolving to `failed[14]` (the tail, i.e. the row just
   scrolled to), and the whole-frame budget forces `shown[FAILED]` from 5
   down to 3 while `startOffset` stays at 10, the rendered slice becomes
   `group[10..13)` — `failed[14]` (and `[13]`) vanish from the frame with no
   error and no `▸` anywhere. This is plausible on a "moderately small, not
   pathologically tiny" terminal with `DONE` fully shown from its own start
   after `FAILED` (so the last-to-first trim loop hits `FAILED`'s
   straddled window second), not just an extreme corner case. **Required:**
   design.md must state explicitly which end of a straddled section's
   window absorbs further whole-frame trimming (it must trim *away from*
   the edge nearest wherever the scroll motion is heading / away from
   `selected`, not always the tail), and `visibleWindow`'s per-section
   `{ shown, startOffset, hidden }` shape (task 1.1) must be specified
   precisely enough that this direction is unambiguous to an implementer.

2. **Test plan doesn't cover the scenario Change Request 1 identifies.**
   Task 3.4's small-terminal regression test only asserts "renders the
   header + `NEEDS YOU` in full and collapses every section it cannot fit…
   without error" — it never asserts marker/selection alignment in the
   combined small-terminal-*and*-scrolled state. AC3 requires marker
   alignment "at every scroll offset [`selected`] reaches via ordinary
   `move` actions," and AC4 requires sane behavior at small heights — the
   ticket's own framing implies these compose, so the test plan must too.
   **Required:** extend task 3.4 (or add a new task) to assert the `▸`
   marker for `runs[selected]` is still rendered when (a) `rows` is small
   enough to force the whole-frame budget trim, and (b) `scrollOffset` is
   non-zero and lands inside the section that trim ends up further
   shrinking. Without this, Change Request 1's gap can land untested.

### Non-blocking notes

3. design.md's Impact section and task 2.4 say `scrollOffset` is threaded
   "into `router.render`'s `opts` (alongside `cols`/`rows`/`selected`)" —
   but `selected` is not actually part of the `opts` object literally
   passed to `router.render` at `watch.js:531-537` (`{cols, rows, now,
   queuedTitles, ticketText}`); it flows through `currentState()` (the
   `state` argument), and `fleet.js`'s `render(state, opts)` wrapper reads
   `state.selected`. Task 2.4's closing sentence ("Confirm
   `currentState()`/the router path… carries it end to end") already hedges
   toward the right mechanism, so this is not blocking, but the literal
   "into `router.render`'s opts" wording risks an implementer wiring
   `scrollOffset` into the wrong object. Worth a one-line correction so the
   instruction matches the actual seam.
4. Decision 2's section-walking description ("walking the sections in
   order, subtracting the section's row count from a running… counter")
   doesn't explicitly say `QUEUED` (which sits between `RUNNING` and
   `FAILED` in render order when a queue is active, per line 245-254) must
   be skipped in that walk, the way `NEEDS YOU` is explicitly called out as
   excluded. `QUEUED` is already excluded from the selectable-index space
   (task 1.4) via the existing `!s.unselectable` guard on the `index`
   counter, so an implementer copying that same guard would likely get this
   right by precedent, and the existing index-safety test
   (`test/fleet.test.js:242`) would probably catch a naive break — lower
   risk than 1/2, but worth making explicit in the design so it isn't
   accidentally re-derived incorrectly for the new counter.
