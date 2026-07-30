## Context

`lib/ui/screens/fleet.js` renders five possible sections (NEEDS YOU, RUNNING,
QUEUED, FAILED, DONE) built by `buildSections()`. Four of them
(NEEDS YOU/RUNNING/FAILED/DONE) are backed by `runs[]` entries and share one
flat `state.selected` row-index space — `runs[state.selected]` is how every
other screen (attach, drilldown, escalation-answer) resolves "the ticket the
operator means". QUEUED (added by CON-28, scrollable as of CON-6) is
deliberately `unselectable: true` and consumes no slot in that index space,
specifically to avoid a queued row (which has no `runs[]` entry at all) ever
being mistaken for a resolvable selection — see `fleet-queue-visibility`'s
"Inserting QUEUED never perturbs the row-index a selection resolves to"
requirement.

This change adds three things on top of that structure: (1) digit-key
section jump, (2) speed/agent-merge display on QUEUED rows, (3) a
force-start action that must let the operator pick *which* queued ticket to
start. (3) needs the same kind of "which row is this" resolution QUEUED was
built to avoid needing — the design below has to reconcile that without
reopening the row-index hazard CON-28 flagged and this ticket's own Notes
section calls out explicitly.

## Goals / Non-Goals

**Goals:**
- Digit keys `1`-`N` jump to the first row of the Nth section actually
  rendered this frame, in on-screen order, with no fixed mapping that shifts
  meaning based on what is empty.
- QUEUED rows show the batch's speed and agent-merge setting.
- An operator can force-start a specific pending ticket immediately, with an
  explicit, unmissable warning before it bypasses `maxConcurrent`, and the
  queue's own bookkeeping (in-memory and persisted) stays consistent with
  reality afterward.

**Non-Goals:**
- Per-ticket speed/agent-merge (both remain per-batch, unchanged by this
  ticket — CON-22/CON-24's own design already made that call).
- Any change to `fleet-view-scroll`'s scrolling mechanics themselves for
  RUNNING/FAILED/DONE — untouched.
- A generalized multi-cursor / multi-pane focus system beyond the one new
  QUEUED-local cursor this ticket needs.

## Decisions

### Decision 1 — Section-jump numbering is positional over *visible, selectable* sections; QUEUED gets its own cursor, not a slot in the jump-target list for `selected`

Two candidate schemes were considered for what digit `N` means:

- **Fixed scheme** (NEEDS YOU=1, RUNNING=2, QUEUED=3, FAILED=4, DONE=5,
  always): rejected — the ticket itself flags this as the wrong model,
  since a key's meaning would shift depending on which sections are
  currently empty (e.g. `3` meaning QUEUED one moment and FAILED the next
  once QUEUED empties out), which is worse than no shortcut at all.
- **Positional over visible sections** (chosen): number only the sections
  actually rendered this frame (`group.length > 0`), in on-screen order.
  Digit `1` is always "the first section currently on screen", whatever
  that is.

Within "positional over visible sections", a second question is whether
QUEUED participates in the numbering at all, given it is `unselectable` in
the `state.selected` sense. Excluding it entirely would satisfy digit-jump's
own goal but leaves the "Added scope" force-start action with no digit-key
entry point, contradicting the ticket's own text ("From within QUEUED
(reachable via the `[2]`/whatever-position jump above)"). The resolution:
QUEUED **does** participate in the positional numbering (it is a section
rendered on screen, same as any other), but jumping to it does **not**
write into `state.selected`/`scrollOffset` at all — it sets a second,
independent cursor, `state.queueFocus` (an index into
`queueState.pending`), and flips `state.focus` from `'runs'` (default) to
`'queue'`. `runs[state.selected]` continues to mean exactly what it always
has, completely untouched by ever visiting QUEUED — the row-index hazard
CON-28 avoided by making QUEUED unselectable is preserved exactly, because
QUEUED still never claims a slot in that index space; it just now has an
index space of its own.

Concretely, `handleKey` computes, on every keypress, the ordered list of
sections `buildSections(bucketRuns(runs), queueState)` produces that are
non-empty this frame (same test `renderFleet` already applies per-section:
`s.group.length > 0`) — this is intentionally the exact same predicate and
the exact same `buildSections()` call `renderFleet`/`visibleWindow` already
use, so the numbering can never disagree with what is actually on screen
(matching this file's existing "shared implementation, not two that could
drift" discipline — see e.g. the `visibleWindow` header comment). Digit `N`
resolves to that list's `(N-1)`th entry:
- If it is a `runs[]`-backed section: `state.focus = 'runs'`,
  `state.selected` = that section's first global row index (its
  `sectionStartIndex`), scroll-adjusted exactly like an ordinary `move`
  (see Decision 2).
- If it is QUEUED: `state.focus = 'queue'`, `state.queueFocus = 0` (first
  pending ticket). `state.selected`/`scrollOffset` are left untouched.
- If `N` exceeds the visible section count, the key is a no-op (`null`
  action), identical to today's handling of any other unbound key.

While `state.focus === 'queue'`: `j`/`k` move `state.queueFocus` by one,
clamped to `[0, queueState.pending.length - 1]` (never touching
`state.selected`); `f` opens the force-start confirmation (Decision 3);
Escape (`\x1b` alone — currently unbound in fleet mode outside the prompt)
returns `state.focus` to `'runs'` with `queueFocus` cleared and `selected`
unchanged; a digit key re-resolves exactly as above (pressing QUEUED's own
digit again is a no-op re-focus; pressing a different section's digit exits
queue-focus and jumps `selected` as normal); `q`/Ctrl-C keep behaving as
today (quit-confirm gate, independent of focus). `Enter`/`l`/`n`/`N` are
suppressed (return `null`) while focus is `'queue'` — they would otherwise
act on whatever `runs[state.selected]` was pointing at before queue-focus
was entered, which is not what the operator is looking at.

**Alternative considered:** reuse the flat `selected` index space for
QUEUED rows too (drop `unselectable`), and let `runs[selected]` resolve to
`undefined` for a queued row, special-cased at every call site that reads
it. Rejected outright — this is exactly the hazard CON-28's own ticket
named and `fleet-queue-visibility`'s existing spec requirement forbids; every
existing caller of `runs[selected]` (attach, drilldown, escalation-answer)
would need a new not-a-real-run guard, and the addition of a second cursor
is strictly less code and strictly more locked-down (queue-focus mode
disables the very keys that would misuse a stale `selected`).

### Decision 2 — Jump reuses `move`'s scroll-adjustment, generalized to an absolute target

`watch.js`'s `applyAction` case `'move'` computes a new `selected` via
`selected + delta`, then re-derives `scrollOffset` from
`fleetScreen.visibleWindow(...)`'s `firstVisibleIndex`/`lastVisibleIndex` so
the just-moved-to row is actually rendered. A jump to a run-backed section's
first row needs the identical scroll-into-view step, just from an absolute
target instead of a relative delta. Rather than duplicate that block, the
`'move'` case's scroll-adjustment logic is factored out into a small
`scrollToShow(selected, ...)` helper `applyAction` calls from both the
existing `'move'` case and the new `'jump'` case (`{ type: 'jump', index:
<absolute row index> }` for a runs-backed target — QUEUED jumps go out as a
distinct `{ type: 'focus-queue', index: 0 }` action per Decision 1, never as
`'jump'`, since they carry no `selected` value at all).

### Decision 3 — Force-start confirmation mirrors drilldown's existing `y`-gate pattern, not `quitConfirm`'s repeated-key pattern

Two existing confirmation idioms already exist in this codebase:
`quitConfirm` (fleet.js: press the *same* key again to confirm, any other
key cancels) and drilldown's kill/restart gate (press `y` to confirm, any
other key cancels — referenced directly in fleet.js's own comment on why
kill/restart live on the drill-down). Force-start uses the `y`-gate form:
`f` while `state.focus === 'queue'` sets `state.forceStartConfirm =
{ ticket: queueState.pending[queueFocus] }` and renders the load-bearing
warning text the ticket itself specifies (`this will run N+1 concurrently,
exceeding your maxConcurrent:N setting — proceed?`, with N read from
`queueState.maxConcurrent` and the live in-flight count). The next key: `y`
issues `{ type: 'confirm-force-start', ticket }`; anything else clears
`forceStartConfirm` without starting anything. `quitConfirm`'s repeated-key
form was considered and rejected here because `f` pressed twice in a row is
a plausible accidental double-press (nothing else uses `f`, so there is no
"this is clearly a second deliberate press" signal the way there is for `q`,
which is also the ordinary quit key); `y` requires an unrelated,
purpose-built keystroke, which is the stronger guarantee this ticket asks
for ("should read as a deliberate override... not a silent action").

### Decision 4 — Force-start is a new `queue.js` export that performs the exact bookkeeping `tick()` would have, not a shortcut that skips it

`queue.js`'s `tick()` is the sole place that currently moves a ticket id
from `pending` to `inFlight` and hands it back to the caller as `toLaunch`.
Force-start needs to do the same two things (mutate the queue object,
signal the caller to actually call `submitTicket`) for exactly one
caller-specified ticket, regardless of `maxConcurrent`. A new function,
`forceStart(queue, ticket)`, is added alongside `tick`:
- Validates `ticket` is actually present in `queue.pending` (defensive — a
  stale `queueFocus` pointing at a ticket that left the queue between frames
  should no-op, not throw or admit a ticket twice).
- Removes it from `pending`, adds it to `inFlight` — the identical mutation
  `tick()`'s own admission loop performs per ticket — and returns
  `{ toLaunch: [ticket], queue: <next state> }`, deliberately shaped like
  `tick()`'s own return value so `watch.js`'s existing `toLaunch.forEach(...
  submitTicket ...)` handling and the existing `queue-cache.js` persistence
  write path apply unchanged, with no new state shape for "force-started" —
  directly satisfying the ticket's own constraint that CON-29's restore
  logic must never need to learn a second in-flight state.
- Does **not** re-check `maxConcurrent` — that check is `tick()`'s job and
  is exactly what this function exists to bypass, deliberately, once.
- **Does NOT hard-code `confirmed: true`** on its returned queue, unlike
  `tick()`. `tick()` is safe to hard-code `true` only because `tick()`
  itself is never called except when `shouldTick(queue)` (i.e.
  `queue.confirmed !== false`) already holds — see `queue.js`'s own comment
  on that invariant. `forceStart` has no equivalent gate: the QUEUED section
  renders (and is therefore digit-jump/force-start reachable) purely off
  `queueState.pending.length`, with no check of `queueState.confirmed`
  (`buildSections()`), so an operator can reach force-start on a ticket from
  a CON-29-restored, not-yet-confirmed queue exactly as easily as from a
  live one. If `forceStart` copied `tick()`'s hard-coded `confirmed: true`,
  force-starting **one** ticket out of such a queue would flip the *entire*
  queue's `confirmed` flag, and the very next poll's `shouldTick()` check
  would begin auto-admitting every *other* pending ticket in a batch the
  operator never actually confirmed — silently defeating CON-29's confirm
  gate for the whole batch off a single-ticket override. Instead,
  `forceStart` returns the queue's `confirmed` value **unchanged from the
  input `queue.confirmed`** (`false` stays `false`, `true` stays `true`):
  the force-started ticket moves to `inFlight` and is launched regardless,
  but every other ticket still in `pending` remains exactly as
  confirmed/unconfirmed as it was before this one, explicit, per-ticket
  override — `shouldTick()` continues gating the rest of the batch exactly
  as before. This is a deliberate, narrow exception: force-start is itself
  an explicit, `y`-confirmed operator action on one specific ticket, which
  is a different kind of consent than "the whole restored batch resumes
  ticking on its own" — the two are independent and this change does not
  conflate them.

Because `forceStart` produces an ordinary `inFlight` entry (modulo the
`confirmed` passthrough above), `tick()`'s very next regular pass treats it
exactly like any other in-flight ticket (already excluded from `pending`,
already counted in `inFlight.size` against `maxConcurrent` for admitting
anything *else*, once/if the queue is or becomes confirmed) — no
double-admission risk, and no special-casing needed anywhere else in
`tick()` itself.

**Alternative considered:** have `watch.js` mutate `queueState.pending`/
`inFlight` directly at the call site instead of adding a `queue.js` export.
Rejected — `queue.js`'s own file header states its role as the one place
that "holds no on-disk state... describes one poll's worth of" queue
transitions; mutating the queue's shape from `watch.js` directly would
duplicate the exact `pending`/`inFlight` bookkeeping `tick()` already
encapsulates, one more place it could drift from `tick()`'s own invariants
(e.g. forgetting the `restoredFrom` passthrough, or — as this decision's
`confirmed`-preservation subtlety above shows — getting the `confirmed`
handling subtly wrong in a way that is easy to miss without `tick()`'s own
comment right there as a reference).

### Decision 5 — Speed/agent-merge on a QUEUED row is parsed once from `queueState.launchCommand`, via a shared helper exported from `launchplan.js`

`launchplan.js` already owns the only two functions that *write*
speed/agent-merge into a `launchCommand` string (`withSpeedFlag`,
`withAgentMergeFlag`), using a stable, documented format: an optional
`--agent-merge`/`--no-agent-merge` token and an optional trailing
`fast`/`slow` token, both immediately after the `{{TICKET}}` placeholder.
Rather than have `fleet.js` write its own regex against that same format
(a second implementation that could silently drift the moment
`withSpeedFlag`'s own format comment changes), `launchplan.js` gains one new
exported `parseLaunchCommand(launchCommand)` returning
`{ agentMerge: true | false | null, speed: 'fast' | 'slow' | 'default' }`
(`agentMerge: null` when no flag token is present at all — a custom
`cfg.launchCommand` override with no `{{TICKET}}` placeholder never carries
one). `fleet.js`'s QUEUED row rendering calls this once per render (cheap —
a single regex exec against one shared string, not per ticket, since the
setting is per-batch) rather than per queued row.

**Alternative considered:** duplicate a small regex directly in `fleet.js`.
Rejected for the drift risk above — this project's own comments in this
exact file (`visibleWindow`, `buildSections`) already treat "one
implementation two callers share" as a first-class discipline worth a
dedicated code comment; extending that discipline to a cross-file helper
five lines away is consistent, not novel.

## Risks / Trade-offs

- **[Risk]** A second focus/cursor concept (`state.focus`,
  `state.queueFocus`) adds a small amount of state-machine surface next to
  the existing `selected`/`scrollOffset`/`prompt`/`quitConfirm` set.
  **[Mitigation]** Scoped as narrowly as possible: only `j`/`k`/`f`/digit/
  Escape/quit keys are interpreted differently while `focus === 'queue'`;
  every other key (and every other screen's `handleKey`) is unaffected, and
  `render()` needs only one additional read (`state.focus`/`state.queueFocus`)
  to draw the queue-local marker.
- **[Risk]** Force-starting deliberately breaks the `maxConcurrent`
  contract the operator configured — a real, not merely cosmetic,
  divergence from steady-state behavior for as long as the extra run is
  live.
  **[Mitigation]** This is the ticket's own explicit intent ("the warning is
  load-bearing, not decorative"); Decision 3's `y`-gate plus the exact
  overage wording the ticket specifies is the whole mitigation surface
  available at the UI layer. No further guard is added beyond what the
  ticket asks for.
- **[Risk]** `queueFocus` can point past the end of `queueState.pending`
  between frames if the queue shrinks (e.g. `tick()` admits the very ticket
  `queueFocus` was pointing at on a normal pass, in the moment between
  keypresses) or the queue disappears entirely (`isIdle`).
  **[Mitigation]** `queueFocus` is clamped to
  `[0, pending.length - 1]` on every read (mirroring `scrollOffset`'s own
  existing re-clamp against `maxScrollOffset` on every draw — see
  `watch.js`'s draw()-time re-clamp comment); if `pending` is empty,
  `state.focus` resets to `'runs'` and `queueFocus` clears, since there is
  nothing left to focus.
- **[Risk]** Force-start is reachable from a CON-29-restored, not-yet-
  `confirmed` queue exactly as easily as from a live one (QUEUED renders
  purely off `pending.length`, with no `confirmed` check) — a naive
  `forceStart` that copies `tick()`'s hard-coded `confirmed: true` would let
  a single-ticket override silently reactivate auto-admission for the
  *entire* rest of that restored batch, defeating CON-29's confirm gate.
  **[Mitigation]** Decision 4's `forceStart` explicitly preserves the input
  queue's own `confirmed` value on its returned queue rather than
  hard-coding `true` — the force-started ticket still launches, but every
  other still-pending ticket remains exactly as unconfirmed as it was,
  and `shouldTick()` continues withholding the rest of the batch until the
  operator separately confirms it via the existing CON-29 `'c'` key. Covered
  by a dedicated unit test (tasks.md 1.2).

## Migration Plan

Additive only — no persisted-format change (`queue-cache.js`'s on-disk
shape is untouched; `forceStart`'s output is deliberately shaped identically
to `tick()`'s), no new config keys, no removed keybindings. Ships as one
ordinary PR; no rollout sequencing or rollback beyond a normal revert.

## Open Questions

- Exact key for force-start (`f` proposed in Decision 3) and for exiting
  queue-focus (bare Escape proposed) are this design's best read of "an
  unclaimed key that reads naturally" — final confirmation is the
  design-soundness gate's to make; neither collides with any key
  `fleet.js`'s current `handleKey` binds today.
