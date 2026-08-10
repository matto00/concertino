## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...HEAD --stat` — 31 files changed
  (`lib/ui/compare-selection.js`, `lib/ui/screens/compare.js`,
  `lib/ui/controllers/compare.js`, plus wiring in `app-state.js`,
  `router.js`, `controllers/index.js`, `archive.js`/`fleet.js` screens and
  controllers, `docs/dashboard.md`, and 6 test files). Matches
  `files-modified.md`'s claims file-for-file.

- **AC 1** ("Two DONE runs can be selected and compared side by side:
  timeline, gate results, duration") — traced to code:
  - Marking: `lib/ui/screens/archive.js` `space` handler and
    `lib/ui/screens/fleet/keys.js:427-436` (`status === 'done'` guard) both
    dispatch `toggle-compare-select`, handled identically by
    `controllers/archive.js`/`controllers/fleet.js` via the single shared
    `lib/ui/compare-selection.js#toggleCompareSelection` (cap-at-2, DONE-only,
    pure — read in full, verified against `test/compare-selection.test.js`).
  - Opening: `c` in both `archive.js`'s list zone and `fleet/keys.js` (after
    the `CONFIRM_RESTORED_QUEUE_KEY` check, confirmed at
    `keys.js:203-217` — restored-queue-confirm keeps precedence) dispatches
    `open-compare`, gated on `compareSelection.length === 2`.
  - Rendering: `lib/ui/screens/compare.js` — read in full. Independently
    rendered it with realistic two-run fixtures (`node -e` against
    `renderCompare`) and visually confirmed: two bordered columns side by
    side, TIMELINE+GATES stacked in each, duration header
    (`CON-101  9m    vs    CON-102  3m   Δ 6m`), a gate's first error
    rendered indented (`└ AssertionError...`), no mid-word truncation at
    100 cols, focused column gets the heavy-line box border vs. the
    unfocused column's light one (a nice, unclaimed touch reusing an
    existing `layout.box`/`pane` convention).
  - Also independently rendered `screens/archive.js` and `screens/fleet.js`
    with a `compareSelection` populated: the `✓` marker renders correctly
    in both (archive: `▸✓ CON-102 ...`; fleet DONE row: `✓▸ CON-101 ...`),
    and doesn't collide with the cursor marker.

- **AC 2** ("Documented in `docs/dashboard.md`") — `git diff main...HEAD --
  docs/dashboard.md`: new "Side-by-side run comparison" section, plus the
  `space`/`c` key-table row updates in both the fleet and archive key
  tables. Read in full — accurate to the implementation.

- **Gates re-run fresh, independently** (not trusted from the evaluator's
  paste): `npm test` in the worktree — `EXIT=0`, `# tests 2087`, `# pass
  2087`, `# fail 0`. Matches the evaluator's claimed count exactly.

- **Design-doc fidelity**: spot-checked `design.md` Decisions 1-4 against
  the diff — `compareSelection`'s cap/DONE-only/insertion-order semantics,
  the `compareReturnMode` origin-tracking mirroring `ticketviewReturnMode`,
  the `c`-vs-`CONFIRM_RESTORED_QUEUE_KEY` precedence ordering, and the
  "selection persists, transient view state resets" lifecycle in
  `app-state.js`'s `backToFleet()` — all precisely implemented as
  documented, no drift.

- **No placeholders/TODOs**: `grep -rn "TODO\|TBD\|FIXME\|XXX"` across all
  new/touched compare-feature files — no matches.

- **Regression safety**: read `controllers/fleet.js`'s new `case
  'toggle-compare-select'`/`'open-compare'` — additive `case`s in the
  existing `switch`, no existing case touched. Read `fleet/keys.js`'s new
  `space`/`c` branches — both are new `if` blocks after the existing
  FAILED-only `space` guard and after the existing
  `CONFIRM_RESTORED_QUEUE_KEY` check, respectively; neither existing branch
  was edited.

### Issue found: fleet's footer never advertises the new `space`/`c`
run-comparison bindings — a real discoverability gap at the feature's
primary entry point, not caught by the evaluator

The ticket's own proposed entry points are "the run-archive screen ... **or
the fleet view's DONE section**." `archive.js`'s own render function was
correctly updated (verified by direct rendering, see above:
`space mark for compare` / `c compare` appear in its footer once relevant).
`lib/ui/screens/fleet/sections.js`'s footer-hint construction
(`buildHeadTail`, hints array at lines 458-477) was **not** updated at all.

I verified this by rendering `screens/fleet.js` directly with two DONE runs:
- With `compareSelection: []` (space does something on the DONE row, but
  isn't hinted): footer shows `↵ attach   l details   t ticket   j/k move
  1-9 jump   n new run   N launch pad   s settings` / `q quit` — no `space`
  mention at all.
- With `compareSelection: ['CON-101','CON-102']` (exactly two marked, `c`
  is now live and would open compare): footer is identical — still no `c
  compare` hint anywhere.

This isn't a stylistic nitpick — it contradicts an explicit, already-tested
discipline this exact codebase self-documents in `sections.js`'s own
comments right above the hints array: *"`space select` is advertised
whenever EITHER bulk-able section is actually rendered this frame — same
'only advertise a key that currently does something' discipline ... The
exact hint/key mismatch this comment block calls a wall, in the other
direction."* There's a dedicated regression test for this exact discipline
(`test/fleet.test.js:2650`, `'the footer advertises space select when a
FAILED or QUEUED section is on screen, never when neither is'`) that was
**not extended** to cover the new DONE-row `space` binding or the new `c`
binding this ticket adds — the gate the discipline is meant to guard was
left half-updated.

Confirmed this isn't a deliberate, documented trade-off: `design.md` and
`tasks.md` never mention "footer"/"hint" anywhere (`grep -n -i
"footer\|hint"` — zero matches in both). It's an oversight, not a decision.

It's also cleanly fixable: `opts.compareSelection` is already threaded all
the way into `buildHeadTail(runs, opts)` (via `render.js`'s
`mergeRenderOpts` → `buildFleetOutput(runs, opts)` → `buildHeadTail(runs,
opts)`, confirmed by reading the call chain) — the plumbing already exists,
the hints array at `sections.js:458-477` simply never consults it.

A user who only ever works from the fleet view (never opens the archive
screen) has **zero on-screen indication** that `space` marks a DONE row for
comparison, or that `c` opens the comparison once two are marked — despite
this being one of the ticket's two named entry points. That's a real,
user-facing regression relative to the codebase's own established
hint-parity standard, not a mere style preference.

### Verdict: REFUTE

### Change Requests

1. `lib/ui/screens/fleet/sections.js` (`buildHeadTail`, hints array around
   lines 458-477): extend the existing `hasFailed`/`hasQueued` gating
   pattern to also advertise the run-comparison bindings when relevant —
   e.g. a `hasDone` check (mirroring `hasFailed`'s
   `runs.some((r) => r.status === 'done')`) added to the `space select`
   condition (`if (hasFailed || hasQueued || hasDone) hints.push('space
   select');`), and a new hint (e.g. `c compare`) pushed only when
   `(opts.compareSelection || []).length === 2` — consistent with the
   file's own "only advertise a key that currently does something"
   discipline it already applies to `f force-start`/`a`/`d`/`C clear
   queue`.
2. Extend `test/fleet.test.js`'s existing hint-parity test (or add a
   sibling next to it, near line 2650) to cover the new DONE-row `space`
   and two-marked `c` cases — the same discipline that test enforces for
   FAILED/QUEUED should cover this ticket's own two new bindings, given the
   file's comments explicitly call out avoiding exactly this defect class.

### Non-blocking notes

- Everything else independently verified — selection semantics, cap
  enforcement, DONE-only gating, origin-aware `esc`, duration/delta
  formatting, first-error rendering, degenerate "run no longer available"
  fallback, precedence vs. `CONFIRM_RESTORED_QUEUE_KEY`, docs — is solid,
  precisely matches design.md, and is well covered by fast, meaningful unit
  tests. The fix above is narrowly scoped (one file's hints array plus its
  test) and shouldn't require touching any of the compare screen/controller
  logic itself.
