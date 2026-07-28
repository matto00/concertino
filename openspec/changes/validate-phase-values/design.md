## Context

`lib/ui/reducer.js` is the pure fold (event log + tmux window state -> Run model) that already
owns two telemetry vocabularies as module-level constants: `TIER2_KINDS` and `TIER3_KINDS`. The
phase vocabulary (`PHASE_ORDER`) currently lives one layer up, in `lib/ui/screens/fleet.js`, and
`drilldown.js` imports it from there. Nothing validates an incoming `phase.enter` event's
`ev.phase` against that list before it is written to `run.phase` — `fleet.js`'s `phaseFraction`
does `PHASE_ORDER.indexOf(run.phase)` and silently treats `-1` as `0` progress, and
`statusLine` prints whatever string arrived, even if it's not a real phase name.

## Goals / Non-Goals

**Goals:**
- One canonical, enforced-by-code list of valid phase names, consumed (not redefined) by every
  screen that needs it.
- An unrecognised `phase.enter` value must not silently overwrite `run.phase` with garbage, and
  must be visible on the fleet screen the same way other malformed input already is.
- The orchestrator role doc and the workflow-state template must each point at the other/at the
  code so a future edit to the enum is more likely to touch all three.

**Non-Goals:**
- No new telemetry event kind or schema change to `emit-event.sh` — this is validation of an
  existing field, not a new contract.
- No change to how a run with `phase: null` renders today (`"phase unknown"`, 0 progress) —
  that behavior is already correct and is being extended to cover the malformed case too, not
  replaced.

## Decisions

**Where PHASE_ORDER lives: reducer.js, not fleet.js.**
`reducer.js` is the one module every phase-consuming screen (`fleet.js`, `drilldown.js`) and
every test already imports transitively (via the Run model it produces), and it has no
dependency on any screen — so moving the list there and having screens import it cannot create
a cycle. `TIER2_KINDS`/`TIER3_KINDS` already establish the convention that this file owns
telemetry vocabularies. `fleet.js` keeps re-exporting `PHASE_ORDER` from its own module exports
(`module.exports = { ..., PHASE_ORDER }`) so `drilldown.js` and existing tests that import it
from `fleet.js` do not need to change their import path.
*Alternative considered*: a new shared `lib/ui/phases.js`. Rejected — it would be a third file
for something that fits naturally as one more constant next to `TIER2_KINDS`/`TIER3_KINDS`, and
this codebase's own comments treat splitting constants into their own module as unnecessary
indirection unless something else needs to import it without the reducer.

**Where validation happens: inside `applyEvent`'s `phase.enter` case, not in `fleet.js`.**
This keeps the screen a pure renderer over an already-known-good `run.phase`, per the ticket's
own note, and matches how `store.js`/`readEvents` already validates event shape (malformed JSON
or a missing `t`/`kind` is dropped and counted, never passed through). An unrecognised phase
value takes the same path: `run.phase` is left unchanged (so a run that had a valid phase and
then received one malformed `phase.enter` keeps showing its last known-good phase, not `null`
or the garbage string) and `run.malformed` is incremented by one, surfacing through the existing
"▲ N malformed events" line on the fleet screen and the per-run malformed count on the
drill-down — no new UI element.
*Alternative considered*: validate in `store.js`'s `readEvents`, next to the JSON-shape check.
Rejected — `readEvents` validates the event envelope (`t`, `kind`) generically, before any
`kind`-specific field exists; teaching it about one event kind's payload semantics (`phase.enter`
-> `PHASE_ORDER`) would be the first crack in that generality, whereas `applyEvent` already
switches per-kind and is where per-kind payload shape belongs.

**`run.malformed` deliberately broadens to cover this case, and its two doc comments are updated
to say so.** Today the counter means exactly one thing — an event-log line dropped before it
ever became an event (`store.js`'s unparseable-JSON / missing-`t`-or-`kind` check; the event
never reaches `run.events`). This change adds a second, different thing under the same counter:
a `phase.enter` event that *is* fully recorded in `run.events` (and visible in the drill-down
timeline) but whose `phase` field is semantically invalid. Both are "the log said something a
human should double-check," which is what the fleet-wide "▲ N malformed events" indicator and
the per-run drill-down count already exist to flag — so reusing the one counter, rather than
inventing a second indicator for a single extra case, is still the right call. But the two
existing comments that describe the counter — `lib/ui/store.js`'s "a malformed line is skipped
and counted, never thrown" and `lib/ui/screens/drilldown.js`'s framing of the count purely
around dropped/gap events — describe only the narrower, original meaning, and would be actively
wrong once this ships without a corresponding edit. Both comments are updated (see tasks.md) to
state the counter now covers "a line the reducer could not use as-is" in general: either because
it never became an event, or because it became one with a field the reducer rejected. This is a
`design.md` **Decision**, not merely an accepted **Risk**: the two meanings are distinguishable
at the raw-event level (a dropped line has no entry in `run.events` at all; a bad-phase line is
sitting right there in the timeline with its literal value), so nothing about the underlying
data is actually lost or hidden — only the single summary counter is now counting two related
but distinct things, and the comments must say so plainly rather than leaving stale prose that
undersells what "malformed" now includes.
*Alternative considered*: a separate `run.badPhase` count, rendered next to "phase unknown"
instead of folded into `run.malformed`. Rejected for this one field — a single extra small
integer for exactly one validated field is more UI surface (a new line/element on both fleet.js
and drilldown.js) than the problem currently warrants, given the raw event is already inspectable
in the timeline. If a second event kind ever needs the same kind of field-level validation, that
is the point to revisit whether a per-reason breakdown earns its keep; one kind doesn't yet.

**Cross-referencing the enum.**
`core/workflow-state.template.md`'s `PHASE:` line grows a comment naming `PHASE_ORDER` in
`lib/ui/reducer.js` as the enforced list; `reducer.js`'s `PHASE_ORDER` constant gets a comment
naming the template back. Comments, not a build-time check, because the template is prose
consumed by a model, not code — there is no automated way to assert the two agree, so the best
available fix is making each edit site advertise its counterpart.

## Risks / Trade-offs

[An unrecognised phase is swallowed into a generic "malformed events" counter with no detail on
*which* run/event/value was wrong] → the raw event stays in `run.events` (the reducer never
drops events, only what it does with a bad `phase` field), so the offending `phase.enter` line
is inspectable in the drill-down timeline already, without inventing a second detailed channel.
See the "`run.malformed` deliberately broadens" Decision above for why folding this into the
existing counter — with its doc comments updated — is preferred over a new field.

[Moving `PHASE_ORDER`'s owning module could look like a breaking change to any external code
importing it from `fleet.js`] → `fleet.js` keeps re-exporting it under the same name from the
same path; only its own internal definition moves.
