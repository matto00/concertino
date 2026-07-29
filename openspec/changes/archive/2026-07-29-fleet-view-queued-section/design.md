## Context

`lib/ui/screens/fleet.js` renders four sections built entirely from
`runs` (the reducer's output): NEEDS YOU, RUNNING, FAILED, DONE. It maintains
one shared `index` counter across all four sections while iterating
`sections.forEach(...)`; that counter is what marks the currently-selected
row (`index === selected`) and what the `… and N more` capped-section logic
advances past for hidden rows. The invariant this counter exists to preserve
— stated explicitly in the file's own comment at line 179 — is: **the Nth
row consuming an index slot is `runs[N]`**. `watch.js` holds a single
`selected` integer, bounds it to `[0, runs.length - 1]` on every poll
(`if (selected >= runs.length) selected = ...`), and resolves it straight
against `runs[selected]` for attach / open-drilldown / open-escalation.
Nothing in `watch.js` or `fleet.js` currently has to reconcile `selected`
against anything other than a flat, reducer-ordered `runs` array.

`queueState.pending` (see `lib/ui/queue.js`) is an array of ticket ids with
no run object behind them at all — no phase, no window, no gates, nothing
`reduce()` could have produced. Rendering them requires inserting rows into
the fleet view that have no corresponding entry in `runs`.

## Goals / Non-Goals

**Goals:**
- Make a queued batch visible, with its position, on the fleet view.
- Guarantee — structurally, not by convention — that inserting QUEUED rows
  can never shift which run a FAILED/DONE row below it resolves to when
  selected.
- Keep the change local to the fleet screen's rendering and the small slice
  of `watch.js` that feeds it title lookups; no change to the queue's own
  runtime behavior (`lib/ui/queue.js` is untouched).

**Non-Goals:**
- Persisting the queue to disk (explicitly deferred — see the ticket's
  "Related" section and the existing `queueState` comment in `watch.js`).
- Making queued rows individually selectable/actionable in this slice (no
  "cancel this one queued ticket" — the only queue-level action today is the
  existing quit-confirmation, unchanged by this work).
- Changing the selection model used by the other three sections.

## Decisions

### Decision 1: Keep positional (index) selection; make QUEUED structurally non-participating — do not switch to ticket-id-based selection

The ticket flags two viable approaches and asks that the id-based model
(Option 2) be weighed seriously rather than defaulted past. It was weighed
and rejected for this slice, for a concrete reason specific to this
codebase's current state rather than general caution:

`watch.js`'s `selected` is a single `let selected = 0` used identically for
every screen-less-attach action (`move`, `attach`, `open-drilldown`,
`open-escalation`), and is bounds-checked against `runs.length` in exactly
one place (`draw()`). Moving to an id-keyed model would mean either (a)
carrying a `Map<ticket, row>` everywhere `selected` currently flows —
touching `handleKey`'s `move`, every action handler in `watch.js` that reads
`runs[selected]`, and the existing test suite's assumptions about `selected`
being a plain row number — or (b) a hybrid where `selected` stays an index
into a *rendered* row list that mixes real and placeholder rows, which is
exactly the hazard the ticket warns about, just pushed one layer down.
Precedent for id-based selection already exists in this codebase
(`launchPad.selected` is a `Set<identifier>`), but that model is a
multi-select toggle over a single homogeneous list (all launch-pad ticket
rows are real, selectable tickets) — it does not have this screen's actual
problem, which is a single flat list containing two *kinds* of row, only one
of which is a run.

Given that, the design keeps `selected` exactly as-is (a plain integer over
`runs`) and instead makes the render loop itself incapable of letting a
non-run row consume an index slot: `sections` gains an `unselectable: true`
flag, set only on the QUEUED entry, and the single shared `forEach` loop
that currently does `index++` for every rendered/hidden row is changed so
that increment is skipped entirely when the section is `unselectable`. This
is enforced in exactly one place — the loop already responsible for the
index/selection invariant — not duplicated per-section, so a future section
added the same way (`unselectable: true`) inherits the guarantee for free,
and there is no second code path that could forget it.

**Alternative considered:** Option 2 (id-keyed selection). Rejected for this
slice as disproportionate to the ticket's actual ask (make the queue
visible) and because it would touch `watch.js` action-handling broadly for a
screen that has exactly one non-run row type to worry about today. Revisit
if a future slice needs per-row actions on queued tickets (e.g. "remove from
queue"), at which point a stable identifier per selectable-or-not row
earns its complexity.

### Decision 2: Queued rows are one line, not two — and the height-budget math must be generalized to know that

A run row is two lines (ticket/name, then a progress bar + status line)
because it has phase/gates/elapsed data to show. A queued ticket has none of
that — showing an empty second line, or a bar frozen at 0%, would be
exactly the "fabricate absent data" failure mode this project treats as a
correctness bug, not a style nit. So `renderQueuedRow` produces exactly one
line: `  {position}. {ticket}  {title-or-nothing}`, truncated to the box's
inner width like every other row.

This is not cosmetically distinct from the existing sections — it is a real
input to the height-budget invariant. `sectionHeight(s, i)` currently
computes `2 + 2 * shown[i] + (overflow ? 1 : 0)`; the `2 *` multiplier is
correct today only because `renderRun` always emits exactly 2 lines per
run, and `sectionHeight`'s output must stay in lockstep with what the render
loop actually emits (`fleet.js`'s own comment at the collapsed-section
check, currently line 231, states this explicitly — a mismatch there is
exactly the bug `test/fleet.test.js`'s `'the total-height cap holds with all
four sections populated'` test exists to catch, per that test's own header
comment describing a prior real incident where a stale height computation
scrolled NEEDS YOU off the top of the terminal). A 1-line QUEUED row makes
that multiplier section-dependent, not a global constant, so it must become
a per-section parameter rather than a hardcoded literal.

Each `sections` entry therefore gains a `linesPerRow` field: `2` for
`NEEDS YOU`/`RUNNING`/`FAILED`/`DONE` (the existing default — set
explicitly on all four rather than left implicit, so no entry's height cost
depends on an unstated default), `1` for `QUEUED`. `sectionHeight` reads
`s.linesPerRow` instead of the literal `2`:
`2 + s.linesPerRow * shown[i] + (overflow ? 1 : 0)`. The render loop's
per-row generation (see Decision 5 below) must emit exactly `s.linesPerRow`
lines per item for every section, so the two stay mechanically in sync
rather than by convention — the same principle Decision 1 already applies
to `unselectable`. A new regression test (analogous to the existing
all-four-sections-populated height test, but with a populated QUEUED
section added) asserts the total emitted line count never exceeds `rows`
and that NEEDS YOU/the header never scroll off, closing the exact gap this
revision addresses.

### Decision 3: Title lookup reads the on-disk ticket cache directly, not `launchPad.cache`

`queueState` itself carries only ticket ids (see `queue.createQueue`) — no
titles. `launchPad.cache` (`lib/ui/cache.js`) already holds `{identifier,
title, ...}` for every ticket the launch pad has ever fetched, but
`launchPad` is `null` until the human has pressed `N` at least once in the
session, and there is no invariant guaranteeing it stays populated with the
right team's data. Since a queue can only be created via the launch pad
today (`confirm-launch` builds `queueState` from `launchPad.cache`
directly), the same tickets are already durably on disk in
`.concertino/cache/linear.json`. `draw()` reads that cache fresh each poll
(`cache.read(root)`, a cheap sync read of one small JSON file — the exact
same call `openLaunchPad()` already makes) and builds a `Map<identifier,
title>` passed into the fleet screen as a plain opt, independent of whatever
`launchPad`'s own in-memory state happens to be. A cold or stale cache
degrades to "no title, ticket id only" per `cache.js`'s own contract — never
an error, never a blank/fabricated title.

### Decision 4: `maxConcurrent` is read from `queueState`, not from config — no new plumbing required

`queueState.maxConcurrent` (the cap the queue itself enforces) is the
correct number to show, and it is already on the object `draw()` holds and
already threads through to `renderFleet` via the existing `queueState` opt
(`fleet.js`'s `render()` already forwards `state.queueState` unchanged) —
**no new `cfg.maxConcurrent` plumbing through `watch.js` is needed for
this.** The title formatter reads `queueState.maxConcurrent` directly,
never `cfg.maxConcurrent`, because a queue created from the launch plan
screen's concurrency picker can (and often will) differ from the config
default (see `confirm-launch` in `watch.js`, which builds the queue from
`plan.concurrency`, not `cfg.maxConcurrent`) — `queueState.maxConcurrent`
is the only value that is actually correct to display in every case.
(This decision's title previously read the opposite of this paragraph,
contradicting itself and `proposal.md`'s Impact section, which had likewise
claimed new `cfg.maxConcurrent` plumbing was required — both are corrected
by this revision; see `tasks.md` §2, which already matched this body and
needed no change.)

### Decision 5: The shared per-row render loop branches on `unselectable`, not on a separate flag; `queuedTitles` is closed over, not threaded per-call

The render loop (`fleet.js`, currently lines 242-246) unconditionally calls
`renderRun(s.group[k], ...)` for every item in every section. QUEUED's
`s.group` is built from `queueState.pending` — an array of ticket-id
strings, not `Run` objects — and needs a different renderer
(`renderQueuedRow`) that also needs each item's 1-based queue position and
a title looked up from `queuedTitles`. Rather than add a second flag, the
loop branches on the same `s.unselectable` field Decision 1 already
introduces: `unselectable` and "is a QUEUED-shaped row, not a run" are the
same condition for every section that exists today or is anticipated, so
one flag serves both the index-skip logic (Decision 1) and the
render-function choice, keeping the "what makes a section different"
knowledge in one place instead of two flags that could drift out of sync.
`queuedTitles` (the `Map<identifier, title>` built in `watch.js`, see
Decision 3) is passed into `renderFleet` as a top-level opt exactly like
`queueState` and `selected` already are, and is read directly by the
QUEUED-branch of the render loop when constructing each `renderQueuedRow`
call — no per-row threading beyond what the closure already provides.

`statusKey: 'queued'` is set explicitly on the QUEUED section entry
(alongside `title`, `cap`, `linesPerRow: 1`, `unselectable: true`), matching
every existing entry's convention of setting `statusKey` explicitly rather
than relying on a fallback — this is what makes the `queued: dim` entry
added to `f.STATUS_COLOUR` (Decision 2's rendering work) actually take
effect, since `colourTitle = f.STATUS_COLOUR[s.statusKey] || ((x) => x)`
silently no-ops on a missing or misspelled key.

## Risks / Trade-offs

- **[Risk]** A future section is added to `sections` and its author forgets
  to reason about whether it should be `unselectable`. → **Mitigation**: the
  default (flag absent) is index-*consuming*, matching every section that
  exists today; a new section only needs explicit thought if it is choosing
  to opt out, and the design doc for this change plus the shared loop's
  comment both flag why `unselectable` exists.
- **[Risk]** Reading the ticket cache every poll adds a filesystem read to
  the once-per-second `draw()` loop. → **Mitigation**: identical cost to the
  read `openLaunchPad()` already performs; `cache.read` is a single small
  synchronous JSON read with no network I/O, gated to only happen when
  `queueState` is non-null (a queue is actually active).
- **[Risk]** `QUEUED`'s trimming shares `MAX_FINISHED`'s cap semantics but
  its own natural cap should arguably differ (a long queue is more useful to
  see in full than a long DONE history). → **Mitigation**: out of scope for
  this slice; use the same `MAX_FINISHED` constant for now (ticket does not
  ask for a distinct cap), leaving a distinct constant as an easy follow-up
  if it proves too aggressive in practice.

## Migration Plan

Additive, in-process rendering change only — no data migration, no schema
change, no persisted state touched. Ships in the same commit as its tests;
rollback is a plain revert.

## Open Questions

None outstanding; the row-index approach (Decision 1) is the one item the
ticket explicitly flagged for design-gate scrutiny, addressed above.
