- `lib/ui/screens/launchpad.js` — item 1: the `lp.refreshing` line now renders
  provider-neutral `'fetching tickets…'` instead of the hardcoded
  `'fetching tickets from Linear…'`.
- `lib/ui/tickets/local.js` — item 2: added a `STATE_NAMES` map and set
  `parseTicket`'s `state.name` from it (`state.type` unchanged), matching
  linear.js's `state.type`/`state.name` contract. Item 4: added
  `fetchOneTicket(opts)`, reading `tickets/<id>.md` directly (not the
  whole-directory scan) and rejecting with a `local: ...`-prefixed message on
  a missing/malformed file.
- `lib/ui/ticket-provider.js` — item 4: added `fetchOneTicket(config, opts)`,
  dispatching to `linear.fetchOneTicket`/`local.fetchOneTicket` via
  `moduleFor`, mirroring the existing `fetchTickets` dispatch shape.
- `lib/ui/controllers/draft.js` — item 3: the `open-ticket-draft` gate now
  resolves the kind via `ctx.deps.linear.kindFor(ctx.config)` (the
  `ticket-provider.js` resolver) instead of comparing the raw
  `ctx.config.ticketProvider.kind`, so a `manual`-configured project gets the
  same local-specific message a `local`-configured one does. The fallback
  error message now interpolates the resolved kind too.
- `lib/cli/validate.js` — item 4: `buildTicketHarnessCheck` now goes through
  `ticket-provider.js` (`kindFor` + the new `fetchOneTicket`) instead of
  importing `fetchOneTicket` directly from `lib/ui/linear.js`; the gate is now
  `kind !== 'linear' && kind !== 'local'` (so `local`/`manual` are supported);
  `cmdValidate`'s already-resolved `out` is threaded through as `root`.
- `lib/config.js` — item 4: the `unsupported-provider` message
  (`collectConfigIssues`, ~line 438) no longer claims live-checking is
  "only implemented for ... linear today"; it now names whichever kind is
  actually unsupported.
- `lib/cli/help.js` — item 4: the `validate` command's `--ticket` help text
  updated to say `"linear" or "local"/"manual"` instead of `"linear" only`.
- `test/launchpad.test.js` — new test asserting the refreshing line never
  mentions "Linear" under any provider.
- `test/tickets-local.test.js` — updated the existing `state.name` assertion
  (was `'unstarted'`, now `'Todo'`); added a test covering all five
  `state.name`/`state.type` pairs; added `fetchOneTicket` unit tests (found,
  missing file, malformed file).
- `test/validate.test.js` — replaced the stale "manual is unsupported" test
  (manual now resolves to local and is supported) with a genuinely
  unsupported-provider (`github`) case using the updated message text; added
  local-provider `--ticket` tests (no-override, valid override, missing file,
  `manual`-alias parity).
- `test/watch.test.js` — new test: a `manual`-configured project pressing `n`
  with free text gets the same local-specific drafting message a `local`
  project gets, not the raw-kind `"this project uses \"manual\""` message.
