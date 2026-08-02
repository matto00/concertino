## Context

`fleet.js`'s `handleKey(key, state)` is a pure `(key, state) -> action | null`
function; `watch.js` is the one effectful layer that interprets an action and
mutates its own closure-scoped state (`mode`, `launchPad`, etc.) — see
`applyAction`'s existing `case` blocks. Three existing precedents this change
follows directly:

- **`focus === 'queue'`**'s `f` key** (`open-force-start-confirm`): resolves
  `queueState.pending[queueFocus]` — an identifier string — directly inside
  `handleKey`, since `queueState` is already part of `state`, and no-ops
  (`return null`) when nothing resolves.
- **`focus === 'quickstart'`**'s `a` key** (`quickstart-add`): `handleKey` has
  no access to the QUICK START eligible-ticket list at all — it lives only in
  `opts`, which `handleKey`'s seam never receives — so it emits an
  unconditional `{ type: 'quickstart-add', index }` and lets `watch.js`
  re-derive the eligible list fresh (`quickStartEligible()`) and no-op there
  if `action.index` doesn't resolve.
- **`ticketview.js`'s existing single-destination `esc`**: hardcoded to
  `{ type: 'back-to-launchpad' }`, exactly like `docview.js`'s `esc` is
  hardcoded to `{ type: 'back' }` → `back-to-drilldown-from-doc`. Both are
  pure-function contracts pinned by existing tests
  (`ticketview.test.js`'s `esc backs out to the launch pad` /
  `routeHandleKey still dispatches back-to-launchpad on esc`).

This change reaches `ticketview.js` from a second place (the fleet view) for
the first time. `ticketview.js`'s pure `handleKey` contract and its tests stay
exactly as they are — the origin-awareness needed for `esc` to return to the
right screen is added entirely in `watch.js`'s effectful layer, not by
changing what action `ticketview.js` emits.

## Goals / Non-Goals

**Goals:**
- One new keybinding (`t`) opens `ticketview.js` for the focused/selected
  ticket in QUICK START, QUEUED, RUNNING, and DONE.
- RUNNING/DONE's existing `l` → drilldown binding is untouched.
- A row with no resolvable ticket identifier at keypress time is a true
  no-op: no mode change.
- `esc` from a fleet-opened ticket view returns to the fleet view, not the
  launch pad; `esc` from a launchpad-opened ticket view is unchanged.

**Non-Goals:**
- No change to `ticketview.js`'s rendering, scrolling, or pure `handleKey`
  contract.
- No change to how the launch pad's own `↵` → `open-ticketview` flow works.
- No general "return-to-caller stack" — this adds exactly one more concrete
  destination (`'fleet'`) alongside the existing hardcoded one
  (`'launchpad'`), consistent with how every other screen in this codebase
  (`docview.js`, `ticketdraft.js`, `settings.js`) hardcodes a single known
  destination rather than maintaining a generic navigation stack.
- No change to the full keybinding audit beyond what's needed to add the `t`
  row and reconcile the table with keys already bound (`l`, digit jump, `Q`,
  `f`, `C`, `s`) — this is a documentation pass, not new behavior.

## Decisions

### Decision 1: One shared action, `{ type: 'view-ticket', ticket }`, for QUEUED and RUNNING/DONE

QUEUED's `queueState.pending[queueFocus]` and RUNNING/DONE's
`runs[selected].ticket` are both already full identifier strings, already
present in `state` (not `opts`-only), and already gated inside `handleKey`
exactly like `open-force-start-confirm`'s `ticket` resolution. Both therefore
resolve to the same action shape and the same `watch.js` handler — no need
for two near-identical cases.

- **Alternative considered**: a separate `view-ticket-queue` /
  `view-ticket-run` pair, mirroring the run-drilldown's `open-drilldown`
  naming exactly. Rejected — the two call sites are byte-identical in shape
  (`{ ticket: <identifier> }`) once resolved, so a single action name is less
  code and one less thing `watch.js` has to keep in sync.

QUICK START cannot share this: `handleKey` has no access to the eligible
ticket list (`opts`-only, per the existing `quickstart-add`/`a` comment), so
it must emit `{ type: 'view-ticket-quickstart', index: quickStartFocus }`
unconditionally and let `watch.js` resolve it against a freshly-recomputed
`quickStartEligible()[index]`, exactly like `quickstart-add` already does.

### Decision 2: `t` is gated inside each focus block, not at the bottom of `handleKey`

`focus === 'queue'` and `focus === 'quickstart'` are two `if` blocks partway
through `handleKey`, each handling a fixed set of keys and otherwise falling
through (deliberately — `q`/digit-jump/`N`/`s` all fall through regardless of
focus, per the existing comments). `t` is **not** in either block's current
suppressed-key list (`l`/`\r`/`n`/`N`/Escape), so adding a bottom-of-function
`t` binding alone would let it act on `runs[selected]` — whatever the run
selection was pointing at *before* focus moved to QUEUED/QUICK START — while
the operator is actually looking at an unrelated queue/quick-start row. That
is exactly the bug `open-drilldown`/`\r`/`attach` were deliberately suppressed
to avoid for the very same reason.

So `t` gets its own explicit branch inside both `focus === 'queue'` and
`focus === 'quickstart'` (each branch always returns — either the resolved
action or `null`), and a separate, `runs[selected]`-gated `t` branch at the
bottom of `handleKey`, next to the existing `l` binding, which only fires
when neither focus block was entered (`focus === 'runs'`).

### Decision 3: Ticket data lookup happens inside `ticketview.js`'s existing `findTicket`, not pre-resolved by the new action handlers

The new `watch.js` cases only need to resolve **an identifier** (or, for
QUICK START, an index → identifier) and route into `mode = 'ticketview'` with
`launchPad.viewingTicket` set. They do **not** need to look up the full
ticket object themselves — `ticketview.js`'s `render()` already does that via
`findTicket(state.launchPad, state.launchPad.viewingTicket)` against
`launchPad.cache.tickets`, and already degrades honestly
(`ticket no longer in the cache`) when the identifier isn't found there. This
keeps the new code symmetric with the existing `open-ticketview` case, which
also only sets `viewingTicket` and lets `render()` do the lookup.

- **Consequence**: if `launchPad` was never initialized (the operator never
  opened the launch pad this session), `findTicket` would look up against
  `undefined`. See Decision 4.

### Decision 4: Factor `openLaunchPad`'s lazy cache-init out into `ensureLaunchPad()`, called (but `mode` left alone) from the three new fleet-originated actions

`openLaunchPad()` today does two things: lazily builds the `launchPad` object
(cache read + defaults) *if it doesn't already exist*, then unconditionally
sets `mode = 'launchpad'`. The new fleet-originated actions need the first
half only — `launchPad.cache` must be populated so `findTicket` has something
to search, but `mode` must become `'ticketview'`, not `'launchpad'`.
`openLaunchPad()` is refactored into a no-mode-change `ensureLaunchPad()`
(the existing lazy-init body, verbatim) plus a two-line `openLaunchPad()`
that calls it and then sets `mode = 'launchpad'` — behaviorally identical to
today for every existing caller of `openLaunchPad()`.

- **Alternative considered**: give the three new `watch.js` cases their own
  independent `cache.read(root)` call, bypassing `launchPad` entirely, and
  add a new top-level `viewingTicketId`/`viewingTicketData` state pair for
  `ticketview.js` to read instead of `launchPad.viewingTicket`. Rejected —
  it would fork `ticketview.js`'s single read path into two (`launchPad`-
  backed vs. not), doubling what `findTicket`/`render()` need to handle and
  diverging from the "one shared renderer, one shared read path" precedent
  `launchpad-detail-pane`'s own spec already established for this exact
  screen.

### Decision 5: `esc`'s return destination is tracked via a new `ticketviewReturnMode` field, not a change to the action `ticketview.js` emits

`ticketview.js`'s `handleKey` keeps returning
`{ type: 'back-to-launchpad' }` on `esc` — unchanged, so its existing pure
tests (`esc backs out to the launch pad`,
`routeHandleKey still dispatches back-to-launchpad on esc, taking priority
over scroll handling`) need no edits. `watch.js` adds one new closure-scoped
field, `ticketviewReturnMode` (`'launchpad' | 'fleet' | null`), set
alongside `mode = 'ticketview'` at each of the three entry points (the
existing `open-ticketview` sets it to `'launchpad'`; the three new actions
set it to `'fleet'`). The `'back-to-launchpad'` case in `applyAction` reads
it: `'fleet'` → `mode = 'fleet'`; anything else (including the pre-existing
`null` default, so an already-running process upgraded mid-session degrades
safely) → the existing `backToLaunchPad()` call, unchanged. Reset to `null`
whenever the field is consumed, and defensively in `backToFleet()`, matching
the existing "leaked per-visit state must never survive into an unrelated
screen" discipline `docTitle`/`ticketDraft`/`settings` already follow in that
same function.

- **Alternative considered**: rename the action itself (e.g.
  `ticketview-back`) and let its *name* carry no destination, resolving
  destination purely from `ticketviewReturnMode`. Rejected as unnecessary
  churn — the action's `type` string is not what encodes the destination
  today (`watch.js`'s handler body is), so renaming it buys nothing and
  breaks two passing tests for no behavioral gain.

## Risks / Trade-offs

- **[Risk]** A row's ticket identifier could theoretically change between
  render and keypress (e.g. a run finishes and the row shifts sections) →
  **Mitigation**: identical risk already exists for `l`/`\r`'s existing
  `runs[selected]` gate and is handled the same way here — resolution happens
  at keypress time against current `state`/freshly-recomputed
  `quickStartEligible()`, never against a stale render-time snapshot.
- **[Risk]** `ensureLaunchPad()` performs a synchronous `cache.read(root)` on
  every fleet-originated `t` press (not just the first) if `launchPad`
  already exists — no, it doesn't: `ensureLaunchPad()` is a no-op once
  `launchPad` is non-null, identical to today's `openLaunchPad()` behavior →
  **Mitigation**: none needed; this is unchanged from existing behavior, not
  a new cost.
- **[Risk]** `docs/dashboard.md`'s keybinding table reconciliation could
  silently drift from what's actually bound in `fleet.js`/`drilldown.js`
  again in the future → **Mitigation**: out of scope for this change to fix
  structurally; noted here only so the acceptance criterion ("worth
  reconciling the whole table while touching it") isn't quietly narrowed to
  just the new `t` row.

## Migration Plan

None — pure feature addition, no persisted-data shape changes, no
backward-compatibility concerns (a mid-session process upgrade sees
`ticketviewReturnMode` default to `null`/`undefined`, which resolves to the
pre-existing `backToLaunchPad()` behavior).

## Open Questions

None outstanding — `t` was already proposed and grounded against the
existing `l`/Enter collision table in the ticket itself.
