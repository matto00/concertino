# CON-93: Local launch pad still shows Linear-flavoured strings and raw state names

## Description

Cosmetic follow-ups from the CON-44 first slice (PR #78) reviews. None are correctness bugs; together they are what makes a local-provider dashboard still read as a Linear one.

## Items

### 1. "fetching tickets from Linear…" during a local refresh

`lib/ui/screens/launchpad.js:326` renders that string unconditionally. Observed in the final re-reviewer's end-to-end frames for both `local` and `manual`. Transient (a directory read is fast), but wrong.

### 2. The status column shows `unstarted`, not `Todo`

`lib/ui/tickets/local.js` sets `state.name` and `state.type` to the same value. `lib/ui/linear.js:352-353` defines the contract as `state.type` = "what code branches on", `state.name` = "what a human reads" — and Linear supplies `Backlog` / `Todo` / `In Progress` for the latter. So `lib/ui/screens/launchpad.js:132` renders lowercase machine names for local tickets.

This follows design Decision 4 as written, so it is a design choice rather than a slip — but `docs/dashboard.md:413` still advertises `Todo` / `In Progress`, so the docs and the local rendering disagree. Either map the five types to human labels, or fix the doc.

### 3. A `manual` project gets the wrong draft-gate message

`lib/ui/controllers/draft.js:24-30` still compares the **raw** kind. The alias resolution added during the final fix wave lives in `lib/ui/ticket-provider.js`, which this gate does not go through. So a project still configured `manual` that presses `n` with free text gets:

> ticket drafting needs ticketProvider.kind "linear" — this project uses "manual"

instead of the local-specific message pointing at `tickets/<ID>.md`. Cosmetic, and `manual` is deprecated, so low value — but it is the last raw-kind comparison left in the UI layer.

### 4. `concertino validate --ticket <ID>` is still Linear-only

`lib/config.js:438` and `lib/cli/help.js:42` both say the live-fetch is "only implemented for ticketProvider.kind linear today". Local tickets carry their labels on disk, synchronously, at zero cost — it is now the cheapest provider to support and the only one where the check needs no network.

## Acceptance Criteria

- Item 1: the local/manual refresh path in `lib/ui/screens/launchpad.js` no longer unconditionally renders a Linear-specific "fetching tickets from Linear…" string; it reflects the actual provider in use (or a provider-neutral message).
- Item 2: local tickets' `state.name` reads as a human label (e.g. `Todo`, `In Progress`) rather than the raw machine `state.type` value, consistent with the `state.type`/`state.name` contract in `lib/ui/linear.js:352-353` — OR `docs/dashboard.md:413` is corrected to describe the actual local-provider behavior. A decision must be made and applied consistently (code+docs no longer disagree).
- Item 3: `lib/ui/controllers/draft.js`'s draft-gate check goes through the same kind-alias resolution as `lib/ui/ticket-provider.js` (or an equivalent resolved-kind check), so a `manual`-configured project pressing `n` with free text gets the correct local/manual-specific guidance rather than the `ticketProvider.kind "linear"` message.
- Item 4: `concertino validate --ticket <ID>` supports local tickets (reading labels from disk synchronously), and `lib/config.js:438` / `lib/cli/help.js:42` are updated to no longer claim the live-fetch is Linear-only.
- No regressions to existing Linear-provider behavior for any of the above.
