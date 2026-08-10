## Context

FAILED (`a` address, `d` done — CON-98, `fleet-failed-remediation`) and
QUEUED (`f` force-start — CON-39, `fleet-queue-force-start`) each already
have exactly one row-level action key, resolved against exactly one row:
FAILED against `runs[selected]` (the ordinary run-selection cursor, gated on
`focus === 'runs'`), QUEUED against `queueState.pending[queueFocus]` (the
QUEUED-local cursor, gated on `focus === 'queue'`). Both already sit behind
a `y`/anything-else confirmation gate rendered by `sections.js`'s
`buildHeadTail` and threaded through `render.js`/`watch.js` as a render opt.

This change adds a `space`-driven multi-select on top of both cursors,
letting the existing action key apply to a whole marked set instead of just
the one row currently under the cursor. Two design decisions were escalated
to, and resolved by, the human as an ordinary Phase 1 Planning `ESCALATION`
(recorded in the run's `escalation.raised`/`escalation.answered` telemetry,
not in `workflow-state.md`'s `DESIGN_QUESTIONS` field — that field is
reserved for a `TICKET_TYPE: design` ticket's own open-questions triage and
stays `null` here, since CON-109 is an ordinary `feature` ticket). The
resolutions themselves are captured below, in this design doc's own
Decisions:

1. Multi-select needs a **dedicated visual marker**, distinct from `▸`/`»`,
   and it **persists across `j`/`k` movement** (mark-as-you-go, not
   cleared on cursor move).
2. A bulk action's mixed-outcome (partial failure) result is a **per-row
   result list** shown in the confirmation area, not a single pass/fail
   summary.

## Goals / Non-Goals

**Goals:**
- `space` toggles the cursor row's ticket into/out of a per-section
  multi-select set, for FAILED and QUEUED.
- The section's existing action key, pressed with a non-empty multi-select
  set, applies to the whole set behind one `y` confirmation naming the
  count.
- A bulk action reports success/failure per row, never a single rolled-up
  pass/fail.
- With nothing multi-selected, every existing single-row keybinding and
  confirmation behaves byte-for-byte as it does today (CON-98/CON-39
  unchanged).

**Non-Goals:**
- Multi-select on NEEDS YOU, RUNNING, DONE, or QUICK START — only FAILED
  and QUEUED have a row-level action to apply in bulk today; adding
  multi-select to a section with no bulk-able action would be a marker
  with nothing to do.
- Cross-section multi-select (marking a FAILED row and a QUEUED row as one
  combined batch) — the two sections' actions are different in kind
  (`a`/`d` vs `f`) and already live in separate index spaces
  (`runs[selected]` vs `queueState.pending[queueFocus]`); a combined batch
  has no single action to confirm.
- A "select all" key. `space` per-row is sufficient for the batch sizes a
  fleet realistically shows (`MAX_FINISHED = 5` rows rendered per finished
  section); can be added later without changing this design's state shape.
- Persisting multi-select state across a full dashboard restart — like
  every other purely-interactive fleet-screen state (`selected`, `focus`,
  `forceStartConfirm`, ...), it lives in `app-state.js`'s in-memory `S`
  only.

## Decisions

### Decision 1: Multi-select state shape — one Set per bulk-able section, keyed by ticket id

`app-state.js` gains `S.multiSelect = { failed: new Set(), queued: new Set() }`.
Ticket id (not row index) is the key, matching how both sections' existing
single-row actions already resolve `ticket` before dispatching (`action.ticket`
throughout `fleet.js`'s FAILED/QUEUED cases) — an id survives a row's
position shifting between frames (a FAILED run respawned and re-sorted, a
QUEUED ticket admitted out from under the pending list) the way an index
would not, and mirrors CON-98/CON-39's own "re-resolve fresh at handling
time, never trust a cached value" discipline extended to a *set* of tickets
instead of one.

Two independent sets, not one shared set with a section tag, because the
two sections' selections are never combined (Non-Goals) and keeping them
separate means clearing one on section-exit (Decision 3) can never
accidentally touch the other.

**Alternatives considered:** a single `Set<ticket>` with the section
inferred from `focus` at action time — rejected: it would silently conflate
a leftover FAILED selection with a QUEUED action if the operator switched
sections without the leftover being visibly cleared, exactly the "silent
partial-batch" failure mode Decision 4's mixed-outcome reporting requirement
exists to prevent one level up.

**Threading (skeptic gate round 1, finding 1 — load-bearing, not optional):**
`app-state.js`'s `createAppState()` initializes `multiSelect`/`bulkConfirm`/
`bulkResult`, but `fleet/keys.js`'s `handleKey` and `fleet/render.js`'s
`mergeRenderOpts` never see raw `S` — both receive only the curated
`currentState(S)` snapshot (`app-state.js` line ~311), which explicitly
allowlists every other confirm/focus field this design touches
(`markDoneConfirm`, `forceStartConfirm`, `focus`, `queueFocus`,
`clearQueueConfirm`). All three new fields MUST be added to that allowlist
too, or `state.multiSelect.failed.size` throws a `TypeError` the first time
`a`/`d`/`f`/`space` is pressed after this ships. `render.js`'s
`mergeRenderOpts` needs `bulkConfirm`/`bulkResult`/`multiSelect` added
alongside its existing `markDoneConfirm` et al. for the same reason.

### Decision 2: `space` toggles the CURSOR row's ticket, resolved the same way the section's own action key already resolves it

`fleet/keys.js`'s `handleKey` binds `space` (`key === ' '`) in two places,
mirroring where `a`/`d`/`f` are already bound:
- Inside the `focus === 'queue'` block (alongside `f`'s existing branch):
  resolves `queueState.pending[queueFocus]` exactly as `f` does, and emits
  `{ type: 'toggle-multi-select', section: 'queued', ticket }` (`null`
  ticket is impossible here — the block already guards `f` on a resolved
  ticket, so `space` gets the identical guard).
- At the same top-level site as the existing `a`/`d` binding (`focus ===
  'runs' && runs[selected] && runs[selected].status === 'failed'`): emits
  `{ type: 'toggle-multi-select', section: 'failed', ticket:
  runs[selected].ticket }`.

`space` is unbound (falls through, no-op) everywhere neither condition
holds — a FAILED-focused space press while QUEUED-focused, or vice versa,
does nothing, exactly like `a`/`d`/`f` already do outside their own gate.
The controller (`fleet.js`) handler toggles the ticket in the matching
`S.multiSelect[action.section]` Set (add if absent, delete if present) and
returns `true`.

**Alternatives considered:** a single unconditional top-level `space`
binding that inspects `focus` itself to decide which set to toggle and
which ticket to resolve — rejected in favor of colocating each binding with
its section's existing action key: `a`/`d`/`f` are already split this way
(one at top level, one inside `focus === 'queue'`), and splitting `space`
identically keeps the "this key's resolution logic lives next to its
section's other keys" property intact rather than introducing the one
`focus`-dispatching key in an otherwise per-block key map.

### Decision 3: A non-empty multi-select set is what makes `a`/`d`/`f` bulk — no separate "bulk mode" toggle, and the set clears once its action resolves or the section is left

`a`/`d` (FAILED) and `f` (QUEUED) each check their section's Set BEFORE
resolving the single-row ticket: if `S.multiSelect.failed.size > 0` (for
`a`/`d`) or `S.multiSelect.queued.size > 0` (for `f`), the key emits a bulk
action (`{ type: 'open-bulk-address-confirm', tickets: [...set] }` /
`{ type: 'open-bulk-mark-done-confirm', tickets }` /
`{ type: 'open-bulk-force-start-confirm', tickets }`) instead of the
existing single-ticket one. An empty set (the default, and the state after
any bulk action resolves) falls through to today's unchanged single-row
behavior — this is the literal meaning of "additive, not a replacement" in
proposal.md's "What Changes."

The set is cleared (`S.multiSelect.failed = new Set()` /
`.queued = new Set()`) in three places: once a bulk confirmation resolves
(`y` or any-other-key-cancels, both — a stale selection surviving a
cancelled confirmation would be confusing, not helpful), and on
`exit-queue-focus`/leaving `focus === 'runs'` for the FAILED set's
equivalent (there is no discrete "leave FAILED" transition the way there is
`exit-queue-focus` — see the Risk below). It is NOT cleared by `j`/`k`
(Decision from the escalation), or by a plain cursor move with no toggle.

**Alternatives considered:** requiring an explicit "enter bulk mode" key
before `space` does anything — rejected: it adds a mode transition with no
matching escalated decision calling for one, and the size-gated dispatch
above already gives `a`/`d`/`f` an unambiguous single-row-vs-bulk signal
with strictly less new state (no `bulkMode: boolean` alongside the two
Sets, which would need to independently agree).

### Decision 4: The confirmation banner names the count; the post-`y` per-row result list renders as a new transient `S.bulkResult` state, not folded into the existing notice fields

`sections.js`'s `buildHeadTail` gains a bulk-confirm branch (checked in the
same newest-gate-first `if`/`else if` chain as `markDoneConfirm`/
`forceStartConfirm`/`clearQueueConfirm`, since a bulk confirm is exactly as
exclusive with those as the single-row ones already are): given
`S.bulkConfirm = { section: 'failed'|'queued', kind: 'address'|'mark-done'|
'force-start', tickets: [...] }`, it renders `confirmLines({ warning:
"mark N runs as done? ...", confirmHint: 'y confirm ... (any other key)
cancel' })` — the same `confirmLines` widget every existing gate already
uses, just with `tickets.length` in the warning text instead of one ticket
id.

On `y`, the controller performs the action once per ticket (re-resolving
each from `S.runs`/`S.queueState` fresh, exactly as the existing single-row
handlers already do — Decision 1's "re-resolve, don't trust a stale
reference" discipline applied per-row), collects `{ ticket, ok, error }`
per ticket into `S.bulkResult = { kind, results: [...] }`, and clears both
`S.bulkConfirm` and the now-consumed `S.multiSelect[section]` Set.
`buildHeadTail` renders `S.bulkResult` (when present) as a tail block
listing each ticket with a ✓/✗ marker and, for a failure, its error text —
mirroring `addressFailureNotice`'s existing single-line-per-failure
rendering, just one line per ticket instead of one line total.
`S.bulkResult` clears on the next keypress (any key, not just `y`/cancel —
it is a one-shot result display, not a gate; nothing about it is
`y`-confirmable itself). Concretely (skeptic gate round 1, finding 3): this
is NOT implemented as a fourth confirm-style intercept inside `handleKey`
(every existing intercept there — `markDoneConfirm`/`forceStartConfirm`/
`clearQueueConfirm`/`quitConfirm` — swallows the triggering key entirely,
which is wrong here: a `j` pressed to dismiss a visible `bulkResult` must
still move the cursor). Instead, `watch.js`'s `onKey` (immediately before
its `router.handleKey(key, currentState())` call, ~line 1214) clears
`S.bulkResult` first if set, then proceeds to call `router.handleKey`
exactly as it always does — so the key that dismisses the result also
still resolves its ordinary action, and no `fleet/keys.js` change is needed
for the clearing itself.

**Threading (skeptic gate round 1, finding 2):** `bulkConfirm`/`bulkResult`
each lengthen `buildHeadTail`'s `tail` (the confirmation banner and the
per-row result list respectively), so — mirroring exactly how
`markDoneConfirm` had to be added to three independent opts-construction
sites under CON-98, each with its own "why" comment already in the
codebase — both fields MUST be added to all three: `render.js`'s
`mergeRenderOpts` (the actual render), `controllers/fleet.js`'s
`scrollToShow`'s `winOpts` (the scroll-into-view decision on `move`/`jump`),
and `watch.js`'s own separate `heightOpts` (the `scrollOffset` re-clamp at
the top of `draw()`). `bulkResult` in particular can render up to
several lines (one per ticket in the batch), materially longer than any
single-ticket confirm banner, so omitting it from either scroll-budget site
is *more* likely to visibly desync scrolling than the historical
`markDoneConfirm` omission this mirrors.

A bulk action with EVERY row succeeding still populates `S.bulkResult`
(all-✓), rather than being special-cased to show nothing — an operator who
just confirmed "mark 4 runs as done" should see confirmation that all 4
actually resolved, not have the screen silently return to the ordinary
view with no acknowledgment.

**Alternatives considered:** reusing `addressFailureNotice`/a single
rolled-up string ("3 of 4 succeeded") — rejected per the escalated
decision itself: a rolled-up summary is exactly the "silently swallowed
into one pass/fail" failure mode the ticket's acceptance criteria call out
as unacceptable; only a genuine per-row list satisfies "reported per-row,
never silently swallowed."

## Risks / Trade-offs

[No discrete "leave FAILED section" transition exists the way
`exit-queue-focus` exists for QUEUED — `focus === 'runs'` is the default,
entered/left implicitly by entering/leaving `focus === 'queue'`/
`'quickstart'`, not a state the operator explicitly "exits."] → Clear
`S.multiSelect.failed` whenever `focus` transitions away from `'runs'`
(i.e. in the same handlers that already set `S.focus = 'queue'` /
`'quickstart'` — `focus-queue`/`focus-quickstart`), not only on bulk-action
resolution. This keeps a FAILED multi-select from silently surviving into
an unrelated QUEUED/QUICK-START session and being applied later against
rows the operator no longer has in view. `S.multiSelect.queued` gets the
mirror-image treatment: cleared on `exit-queue-focus` (already an existing
transition) in addition to bulk-resolution.

[A ticket bulk-marked in FAILED, then addressed singly via the existing
non-bulk `a` before the batch is confirmed (e.g. the operator changes their
mind mid-selection and presses `a` with the cursor on a DIFFERENT,
non-multi-selected row while `focus === 'runs'`) — wait, `a` with a
non-empty `multiSelect.failed` set always resolves to the bulk path per
Decision 3, so this can't happen for the CURSOR row while ANY row is
multi-selected, only entirely as designed.] → No mitigation needed; this
is exactly Decision 3's designed behavior, called out here to make the
apparent edge case explicit rather than leaving it implicit.

[A multi-selected ticket present in `S.multiSelect` disappears from
`S.runs`/`queueState.pending` between being marked and the bulk action's
`y` confirm (e.g. a QUEUED ticket gets admitted by an ordinary `tick()`
pass while multi-selected).] → Mirrors the existing single-row precedent
exactly (`confirm-force-start`'s "no-op if the ticket already left
pending", `confirm-mark-done`'s "stale — nothing left to mark done"): the
per-ticket bulk handler re-resolves each ticket fresh and records
`{ ticket, ok: false, error: 'no longer queued' }` (or the section's
equivalent stale-reason) in `S.bulkResult` rather than silently dropping it
from the result list — satisfying the same "never silently swallowed"
requirement for a ticket that vanished mid-batch, not just one whose
in-flight action call failed.
