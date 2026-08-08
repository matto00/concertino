## Why

CON-44's first slice (PR #78) shipped a working local ticket provider, but its
reviewers found four small places where the dashboard/CLI still read as
Linear-specific rather than provider-neutral: a hardcoded "fetching tickets
from Linear…" string, raw lowercase machine state names shown as a local
ticket's status, a draft-gate message that doesn't resolve the `manual`→`local`
alias, and `concertino validate --ticket` refusing to live-check local
tickets even though their labels are on disk and free to read. None are
correctness bugs, but together they are what makes a local-provider project
still look and feel like a half-finished Linear integration.

## What Changes

- `lib/ui/screens/launchpad.js`'s refreshing-state line no longer says
  "fetching tickets from Linear…" unconditionally — it renders a
  provider-neutral "fetching tickets…" instead, since the render layer has no
  provider-kind context plumbed through it and adding that plumbing for one
  string is not worth the surface-area increase.
- `lib/ui/tickets/local.js` now maps its five `state.type` values to the same
  human-readable `state.name` labels Linear supplies (`Backlog`, `Todo`,
  `In Progress`, `Done`, `Canceled`), matching the `state.type`/`state.name`
  contract `lib/ui/linear.js` already documents and the human-readable labels
  `docs/dashboard.md` already advertises. `state.type` (what code branches on)
  is unchanged.
- `lib/ui/controllers/draft.js`'s draft-gate check now resolves
  `ticketProvider.kind` through `ticket-provider.js`'s existing alias table
  (already reachable via `ctx.deps.linear`, which is actually the
  `ticket-provider.js` resolver — see that module's own header comment)
  instead of comparing the raw config value, so a `manual`-configured project
  gets the same local-specific guidance a `local`-configured one already
  does.
- `lib/ui/ticket-provider.js` gains a `fetchOneTicket(config, opts)` dispatch
  function, mirroring its existing `fetchTickets`/`resolveTeam`/`createTicket`
  pattern. `lib/ui/tickets/local.js` gains a synchronous `fetchOneTicket(opts)`
  that reads `tickets/<ID>.md` directly and returns the same
  `{ id, identifier, labels }` shape `lib/ui/linear.js`'s `fetchOneTicket`
  already returns.
- `lib/cli/validate.js`'s `buildTicketHarnessCheck` and `lib/config.js`'s
  `collectConfigIssues` now support `ticketProvider.kind` `local` (and its
  `manual` alias) for `--ticket <ID>` live-checking, going through the new
  `ticket-provider.js` dispatch rather than requiring `lib/ui/linear.js`
  directly. `lib/config.js:438`'s "only implemented for ... linear today"
  message and `lib/cli/help.js:42`'s matching doc line are updated to reflect
  that `local`/`manual` are now supported and only a genuinely unsupported
  kind (e.g. `github`, or none configured) still shows the unsupported-provider
  message.

## Capabilities

### New Capabilities

- `launchpad-local-parity`: the launch pad's refresh-in-progress copy is
  provider-neutral, and a local ticket's `state.name` reads as the same
  human label Linear would supply for the equivalent `state.type`.
- `validate-ticket-local-provider`: `concertino validate --ticket <ID>`
  live-checks a local ticket's on-disk labels the same way it already
  live-fetches a Linear ticket's labels over the network.

### Modified Capabilities

- `ticket-draft`: the provider-kind gate used by the `n`-prompt draft flow now
  resolves the `manual`→`local` alias before comparing, so its non-Linear
  branches dispatch on the same resolved kind `launchPadStatus` already uses.

## Impact

- `lib/ui/screens/launchpad.js` — one string literal.
- `lib/ui/tickets/local.js` — `parseTicket`'s `state` field, plus a new
  `fetchOneTicket` export.
- `lib/ui/controllers/draft.js` — the `open-ticket-draft` gate's kind
  comparison.
- `lib/ui/ticket-provider.js` — new `fetchOneTicket` dispatch export.
- `lib/cli/validate.js` — `buildTicketHarnessCheck`'s provider gate and its
  fetch call.
- `lib/config.js` — the `unsupported-provider` message text.
- `lib/cli/help.js` — the `validate` command's `--ticket` help text.
- `docs/dashboard.md` — no change needed; its existing `Todo`/`In Progress`
  claim becomes accurate for local tickets rather than needing correction.
- No changes to `lib/ui/linear.js` (kept unchanged, per CON-44's own design
  precedent) or to any Linear-provider behavior.
