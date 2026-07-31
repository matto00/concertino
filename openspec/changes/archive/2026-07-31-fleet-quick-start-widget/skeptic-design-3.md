## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-quick-start/spec.md` in full (post round-2 revision), and
  both prior skeptic reports (`skeptic-design-1.md`, `skeptic-design-2.md`)
  as claims to re-check, not facts.
- Re-read `lib/ui/screens/fleet.js` in full (794 lines) with fresh eyes,
  specifically: `buildSections` (180-202), `visibleWindow`'s unselectable
  branch (`fleet.js:381-384`, `Math.min(groupLen, s.cap)`) and
  `sectionHeight` (410-413), `renderFleet`'s per-section loop in full
  (505-600, including the `if (!s.group.length) return;` guard at line 534
  and the per-row `if (s.unselectable) { ... renderQueuedRow ... } else {
  ... renderRun ... }` split at 555-570), `sectionJumpTargets` (633-641),
  `handleKey` in full (643-762, digit-jump branch and `focus === 'queue'`
  branch).
- Read `lib/ui/router.js` (51 lines) in full — confirmed
  `handleKey(key, state)` (45-48) receives only `state`, never `opts`,
  unchanged since rounds 1/2.
- Read `lib/ui/watch.js`'s `currentState()` (394-403) and the `render()`
  call site (`router.render(currentState(), { cols, rows, now,
  queuedTitles, ticketText })`, 700-706) — confirmed the state/opts split
  design.md's round-2 fix relies on is accurately described.
- Read `lib/ui/screens/launchpad.js`'s `priorityLabel`/`PRIORITY_RANK`/
  `priorityRank`/`sortByPriority`/`isSelectable`/`ticketRow`
  (53-208, 436-440) — confirmed `ticketRow(ticket, checked, selected,
  paneFocused, runs, width)` operates on full ticket **objects**
  (`ticket.identifier`, `ticket.title`, `ticket.priority`), not id strings.
- Re-verified this round's specific fix (the third-parameter
  `sectionJumpTargets(runs, queueState, quickStartVisible)` threading):
  design.md's new paragraph (lines 67) and tasks.md 2.9/3.3/4.1/5.2 are
  now mutually consistent and match the actual `handleKey`/`router.js`
  call chain — the round-2 gap is genuinely closed, and I traced the
  `forceRender`-driven "empty QUICK START still consumes a digit" logic
  through to confirm `sectionJumpTargets`'s own internal `buildSections`
  call (which only ever receives `{ quickStartVisible }`, never the real
  ticket list) still resolves correctly for jump-numbering purposes
  because of the `s.group.length > 0 || s.forceRender` filter (2.8) — this
  is genuinely elegant and correct.
- Searched design.md/tasks.md for `renderQueuedRow`, "row renderer",
  `s.unselectable`, `cap` — see findings below.

### Verdict: REFUTE

Round 2's specific fix (CR1 in that report) is correctly and consistently
applied everywhere it's referenced — I could not find a stale two-argument
`sectionJumpTargets` call or an un-threaded `quickStartVisible` path
anywhere in design.md or tasks.md. However, re-reading the rest of the
design with fresh eyes surfaced a new gap in the **same category** rounds
1 and 2 already found twice: an existing single-purpose code branch that
silently breaks once a second, differently-shaped `unselectable` section
is introduced, and that neither `design.md` nor `tasks.md` names as
needing a change.

### Change Requests

1. **`renderFleet`'s per-row content loop (`fleet.js:555-570`) is written
   specifically for QUEUED and is never told to branch for QUICK START —
   as written it would call `renderQueuedRow` on QUICK START's ticket
   objects, which is not just cosmetically wrong but structurally broken.**
   Today, the only discriminator inside the populated-row loop is
   `s.unselectable` (`fleet.js:555`): `if (s.unselectable) { const ticket =
   s.group[k]; const title = queuedTitles ? queuedTitles.get(ticket) : null;
   ... renderQueuedRow(ticket, k + 1, title, innerCols, {...}) } else {
   ... renderRun(...) }`. That branch assumes `s.group[k]` is a **ticket-id
   string** (QUEUED's `group: queueState.pending`, an array of id strings —
   confirmed at `fleet.js:190`) and looks its title up via
   `queuedTitles.get(ticket)`. Per design.md Decision 4 / tasks.md 4.2, the
   QUICK START section's `group` is `opts.quickStartTickets` — the `eligible`
   array computed as `sortByPriority(cache.read(root).tickets || [])...`,
   which is an array of **full ticket objects** (`{ identifier, title,
   priority, ... }`, confirmed against `launchpad.js`'s `sortByPriority`/
   `isSelectable`/`ticketRow` at lines 53-208, all of which operate on
   ticket objects, not id strings). Since task 2.3 makes QUICK START
   `unselectable: true` (mirroring QUEUED, per Decision 3), it falls into
   this exact same branch — `renderQueuedRow(ticketObject, ...)` would be
   called on a ticket object where a string is expected, and
   `queuedTitles.get(ticketObject)` would never find anything (the map is
   keyed by id strings). Neither `design.md`'s Decision 4 "Concrete
   mechanism" (which only names the forceRender/empty-hint/height/
   jump-filter call sites — points 1-4, none of which touch this branch)
   nor `tasks.md` 2.7 addresses this: 2.7's only relevant sentence is
   "Also wire the populated (non-empty) case into this same loop, matching
   every other section's handling for that case" — which, read literally,
   describes reusing the existing (QUEUED-shaped) handling, the wrong
   outcome. Tellingly, task 2.3's own text ("...so the digit-jump branch
   (2.7/3.3) has one uniform field to read...") mislabels 2.7 as "the
   digit-jump branch" when 2.7 is actually the render-loop task and 3.3 is
   the actual digit-jump branch — internal evidence the tasks were never
   fully reconciled on which call site consumes the new `kind` field.
   Required: name this branch explicitly (file:line `fleet.js:555-570`) and
   specify that it must split on `s.kind` (or equivalent), routing
   `'queued'` to the existing `renderQueuedRow` path and `'quickstart'` to
   the new row renderer from task 2.4, operating on ticket objects directly
   (no `queuedTitles` lookup needed — the object already carries `.title`).
   While fixing this, also specify how/whether the QUICK START row under
   `quickStartFocus` gets a focused-row marker analogous to
   `renderQueuedRow`'s `opts.focused` (`focus === 'queue' && queueFocus ===
   k`) — task 2.4 lists "priority label, identifier, title, truncated to
   width" for the new renderer's inputs but no `focused` parameter, so as
   specified the highlighted QUICK START row (the one `a` would act on) has
   no visual indicator at all.

2. **The QUICK START section object's `cap` field is never specified, and
   `visibleWindow`'s unselectable-section arithmetic requires one.**
   `visibleWindow`'s unselectable branch (`fleet.js:381-384`) computes
   `shown = Math.min(groupLen, s.cap)`. Every other section `buildSections`
   builds names an explicit `cap` (`Infinity` for NEEDS YOU/RUNNING,
   `MAX_FINISHED` for QUEUED/FAILED/DONE — `fleet.js:182-199`), but neither
   `design.md` nor `tasks.md` names a `cap` value for the new QUICK START
   entry (task 2.3 only mentions `unselectable: true`, `linesPerRow: 1`,
   and the new `kind` field). Left unspecified, `s.cap` is `undefined`,
   `Math.min(groupLen, undefined)` is `NaN`, and `shown`/`sectionHeight`'s
   `s.linesPerRow * w.shown` arithmetic breaks silently (rows render as an
   empty/collapsed section rather than throwing, which is worse — it fails
   quietly). Since `QUICK_START_COUNT` already caps the eligible list to 5
   before it is ever threaded through as `opts.quickStartTickets`
   (Decision 4's own `eligible` computation), `cap: QUICK_START_COUNT`
   (mirroring `MAX_FINISHED`'s role for QUEUED/FAILED/DONE) is the obvious
   value — but "obvious" is exactly the standard this project's own design
   docs have been held to at every other section already, and it should be
   named rather than left for the implementer to infer.

Both are concrete, code-level omissions in the same "an existing
single-purpose branch silently breaks once QUICK START, a second
same-shaped section, is introduced" category as round 1's CR1/CR2 and
round 2's CR1 — just recurring at the render loop's row-dispatch branch
and the section object's `cap` field rather than the `a`-key handler or
the digit-jump call site. A competent implementer following `tasks.md`
literally would ship a QUICK START panel that either crashes or silently
renders nothing/garbage on its populated path.

### Non-blocking notes

- Decision 5's "module-scope `launchCommand`" phrasing (round 1's non-
  blocking note) and Decision 4/tasks.md 2.5's `forceRender` wording
  mismatch (round 2's non-blocking note) are both still present, still
  harmless.
- `design.md` line 35 ("Entered via digit-jump (extends `sectionJumpTargets()`,
  itself generic — no change needed to `fleet-section-jump`'s own
  requirements)") reads as mildly stale next to the much more precise
  "needs a real signature change" paragraph added later in the same
  document (line 67) — the spec-requirements claim is still true, but
  "itself generic" undersells what line 67 goes on to establish. Worth
  tightening so a future reader isn't misled by the earlier, less precise
  sentence.
