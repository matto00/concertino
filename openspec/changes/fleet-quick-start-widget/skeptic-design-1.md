## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-quick-start/spec.md`, `workflow-state.md` in full.
- Read `lib/ui/screens/fleet.js` in full (795 lines) — `buildSections`,
  `visibleWindow`/`sectionHeight`, `renderFleet`'s per-section render loop,
  `sectionJumpTargets`, `handleKey`'s digit-jump and `focus === 'queue'`
  branches, `renderQueuedRow`'s header comment on the
  render/height-budget "lockstep" invariant.
- Read `lib/ui/queue.js` in full — `createQueue`, `tick`, `forceStart`,
  confirmed `pending` is an array of ticket-id strings throughout (e.g.
  `forceStart`'s `queue.pending.filter((t) => t !== ticket)`), consistent
  with the design's planned `enqueueOne(queue, ticket)` signature.
- `grep`'d `lib/ui/screens/launchpad.js` — confirmed `PRIORITY_RANK`,
  `priorityRank`, `sortByPriority`, `isSelectable`, `selectableIdentifiers`,
  `priorityLabel` all exist and are exported exactly as the proposal/design
  claim (no new plumbing needed there).
- Read `lib/ui/watch.js` (state declarations ~lines 215-403, `confirm-launch`
  handler ~1474-1505, `applyAction`/`onKey` wiring ~926-1567) — confirmed
  `launchCommand` is computed once at function-scope inside `watch()` (not
  literally "module-scope" as design.md Decision 5 phrases it, but
  effectively equivalent — non-blocking) and is in-scope for `applyAction`.
  Confirmed via `router.js:45-48` and watch.js's own comments (lines 41,
  288, 655) that `router.handleKey(key, currentState())` — **`handleKey`
  never receives `opts`, only `state`** — this is load-bearing for finding
  #1 below.
- Confirmed `buildSections`' current empty-group behavior: `renderFleet`'s
  per-section loop (`fleet.js:534`, `if (!s.group.length) return;`) and
  `visibleWindow`'s `sectionHeight` (`fleet.js:411`,
  `if (!s.group.length) return 0;`) both skip/zero-cost any section whose
  `group` is empty today — this is load-bearing for finding #2 below.

### Verdict: REFUTE

The three design questions the ticket posed are all resolved thoughtfully
(hidden-by-default toggle, epic-flattening, reuse of `queue.createQueue`/
`queue.tick` via a new `enqueueOne`), and the QUEUED-section precedent is
followed carefully in most respects. But two concrete data-flow/control-flow
gaps exist between the design's stated intent and the actual code the design
itself cites as precedent — gaps a competent implementer following
`tasks.md` literally would not have the information to close correctly.

### Change Requests

1. **`handleKey`'s `a` (quickstart-add) "no-op otherwise" check has no data
   to act on.** `tasks.md` 3.4 requires: *"`a` → `quickstart-add` (only when
   a ticket is actually highlighted — no-op otherwise)"* — mirroring the
   existing `focus === 'queue'` `f` branch, which resolves
   `state.queueState.pending[queueFocus]` and returns `null` if absent
   (`fleet.js:711-716`). But `design.md` Decision 4 and `tasks.md` 4.1/4.2
   deliberately keep the eligible QUICK START ticket list **out of `state`**
   — it is computed fresh in `watch.js`'s `draw()` and threaded only as an
   `opts` field to `render()` ("mirroring how `queuedTitles` is threaded
   today" — itself an opts-only field, never part of `currentState()`).
   Since `router.handleKey(key, currentState())` never passes `opts`
   (confirmed at `router.js:45-48`, and explicitly called out in watch.js's
   own comments at lines 41/288/655: *"router.handleKey's own seam carries
   no `opts`"*), `handleKey` has **no way** to know whether
   `quickStartFocus` currently points at a real ticket. As written, the
   `f`-branch precedent this design claims to mirror cannot actually be
   mirrored. Resolve explicitly: either (a) add the eligible ticket list (or
   at minimum its length/ids) to `currentState()` alongside
   `quickStartVisible`/`quickStartFocus` — which changes Decision 4's stated
   data-flow ("computed in `watch.js`'s `draw()`, not inside the screen" /
   opts-only) and needs its own justification, or (b) revise `tasks.md` 3.4
   so `handleKey` unconditionally emits `{ type: 'quickstart-add' }` while
   focused (no highlighted-ticket check), deferring entirely to `tasks.md`
   4.4's watch.js handler, which already re-derives the eligible list at
   handling time and can itself no-op when nothing resolves.

2. **The empty/cold QUICK START section is invisible to two existing
   zero-length-group shortcuts, and `tasks.md` 2.6 tells the implementer to
   do the opposite of what's needed.** `design.md` Decision 4 (and
   `specs/fleet-quick-start/spec.md`'s "empty or cold" requirement) says the
   section must render a hint line whenever `quickStartVisible` is true,
   *"regardless of `eligible.length`"* — an explicit, named divergence from
   `buildSections`' "only non-empty groups render" convention. But two
   separate pieces of existing code enforce exactly that convention and are
   never named as needing a change:
   - `renderFleet`'s per-section render loop (`fleet.js:534`):
     `if (!s.group.length) return;` — skips the section (no box, no hint,
     nothing) whenever `group` is empty.
   - `visibleWindow`'s `sectionHeight` (`fleet.js:411`):
     `if (!s.group.length) return 0;` — costs the section **zero rows** in
     the height-budget arithmetic that `visibleWindow`/`renderFleet` must
     stay in lockstep on (a discipline this same file's own comments
     stress repeatedly, e.g. `renderQueuedRow`'s header comment: *"Must
     always emit exactly 1 line... `sectionHeight()` and this function must
     stay in lockstep"*).
   Worse, `tasks.md` 2.6 instructs: *"Wire the new section into
   `renderFleet`'s per-section render loop (box/degrade path, **matching
   every other section's handling**)"* — but every other section's handling
   is precisely "skip when empty," the opposite of Decision 4's requirement.
   Neither `design.md` nor `tasks.md` names the concrete change needed at
   either of these two call sites (special-casing QUICK START so it renders
   a 1-hint-line box with `group.length === 0`, and so `sectionHeight`
   reserves 1 line + border for it in that state). Add an explicit task
   (or revise 2.3/2.5/2.6) naming both call sites and describing how a
   zero-eligible QUICK START section is sized/rendered without breaking the
   lockstep invariant for every other section.

### Non-blocking notes

- `handleKey`'s digit-jump branch today collapses *any* `unselectable`
  section to `{ type: 'focus-queue', index: 0 }` (`fleet.js:698`). With two
  unselectable sections possibly on screen at once (QUEUED and QUICK
  START), this line needs a discriminator to decide which focus action to
  emit. `tasks.md` 3.3 already anticipates this ("emit a `focus-quickstart`
  action... instead of `jump`, mirroring the existing QUEUED branch") but
  doesn't specify how a section is identified as QUICK START vs QUEUED
  (QUEUED's `title` is a dynamic string with a live count, so matching on
  `title` would be fragile). Worth naming a stable discriminator (e.g. a
  `kind: 'queue' | 'quickstart'` field on the section object built in
  `buildSections`) explicitly in design.md rather than leaving it implicit.
- Decision 5's phrase "the exact module-scope `launchCommand` constant" is
  imprecise — it's a `watch()`-function-scope `const`, not literally
  module-scope — harmless in practice since `watch()` runs once per
  process, but worth tightening the wording.
