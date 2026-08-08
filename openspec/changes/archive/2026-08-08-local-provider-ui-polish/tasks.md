## 1. Item 1 — provider-neutral launch pad refresh copy

- [x] 1.1 In `lib/ui/screens/launchpad.js`, change the `lp.refreshing` line
      (~line 326) from `'fetching tickets from Linear…'` to
      `'fetching tickets…'`.
- [x] 1.2 Update/add a test asserting the refreshing line never contains
      "Linear" under any provider.

## 2. Item 2 — human-readable local ticket state names

- [x] 2.1 In `lib/ui/tickets/local.js`, add a `STATE_NAMES` map (`backlog`→
      `Backlog`, `unstarted`→`Todo`, `started`→`In Progress`, `completed`→
      `Done`, `canceled`→`Canceled`) near the existing `STATES` array.
- [x] 2.2 In `parseTicket`, set `state: { name: STATE_NAMES[f.state], type:
      f.state }` (type unchanged; name now the mapped human label).
- [x] 2.3 Add/update tests in the local-ticket-provider test file covering
      all five states' parsed `state.name`, and confirm `state.type`-based
      consumers (`stateTypesFromConfig`, `inlineStatus`'s `started` override,
      `deriveEpics`) are unaffected.

## 3. Item 3 — draft-gate alias resolution

- [x] 3.1 In `lib/ui/controllers/draft.js`'s `open-ticket-draft` case, replace
      `const provider = (ctx.config && ctx.config.ticketProvider) || {}; if
      (provider.kind !== 'linear')` with a resolved-kind check using
      `ctx.deps.linear.kindFor(ctx.config)` (recall `ctx.deps.linear` is
      `ticket-provider.js`'s resolver, per `watch.js`'s header comment).
- [x] 3.2 Update the fallback (non-`local`, non-`linear`) error message to
      interpolate the resolved kind, not the raw `provider.kind`.
- [x] 3.3 Add a test: `ticketProvider.kind: 'manual'` submitting free text at
      the `n` prompt gets the same local-specific message a `local`-kind
      project gets, not the raw-kind message.

## 4. Item 4 — `concertino validate --ticket` local support

- [x] 4.1 Add `fetchOneTicket(opts)` to `lib/ui/tickets/local.js`: reads
      `tickets/<opts.id>.md` from `opts.root`, parses via the existing
      `parseTicket`, and returns `{ id, identifier, labels }`. Rejects with a
      `local: ...`-prefixed message (matching `createTicket`'s existing
      style) when the file is missing or malformed.
- [x] 4.2 Add `fetchOneTicket(config, opts)` to `lib/ui/ticket-provider.js`,
      dispatching via `moduleFor`/`canonicalConfig` like `fetchTickets` does;
      export it from the module's `module.exports`.
- [x] 4.3 In `lib/cli/validate.js`, switch `buildTicketHarnessCheck` to
      import and use `ticket-provider.js` (its `kindFor` and new
      `fetchOneTicket`) instead of importing `fetchOneTicket` directly from
      `lib/ui/linear.js`; gate on `kind !== 'linear' && kind !== 'local'`;
      pass `root` (the CLI's resolved `out`) through to the call.
- [x] 4.4 Update `lib/config.js:438`'s `unsupported-provider` message to drop
      the "only ... linear today" framing and name the actually-unsupported
      `thc.providerKind`.
- [x] 4.5 Update `lib/cli/help.js:42`'s `validate` command help text to match
      (drop the "linear only" claim).
- [x] 4.6 Add tests: `--ticket <ID>` against a `local`-provider project with
      no override / a valid override / a missing file, plus a `manual`-alias
      case, plus confirming a genuinely unsupported provider (`github`) still
      reports `unsupported-provider`.

## 5. Verification

- [x] 5.1 Run the full test suite; confirm no Linear-provider test's expected
      output changed.
- [x] 5.2 Run `concertino validate` against both a `linear`-configured and a
      `local`-configured fixture project (with and without `--ticket`) and
      confirm the Integrations section output for each.
- [x] 5.3 Grep the diff for any remaining raw `ticketProvider.kind` (or
      `provider.kind`) comparisons in `lib/ui/` outside `ticket-provider.js`
      and `local.js`'s own `launchPadStatus`/`teamKeyFromConfig` (which are
      allowed to read the raw config since they receive the already-aliased
      `canonicalConfig` from their caller).
