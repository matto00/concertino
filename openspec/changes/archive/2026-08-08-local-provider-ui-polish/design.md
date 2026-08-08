## Context

CON-44 shipped the local ticket provider (`lib/ui/tickets/local.js`,
`lib/ui/ticket-provider.js`) as a first slice. Its review left four small,
independently-fixable cosmetic gaps (CON-93's ticket.md items 1-4) where the
dashboard/CLI still assumes or names Linear specifically instead of going
through the provider-neutral seams CON-44 itself established
(`ticket-provider.js`'s `kindFor`/alias table, `linear.js`'s
`state.type`/`state.name` contract). None of the four touch `lib/ui/linear.js`
itself — CON-44's design already committed to leaving that module unchanged,
and this change follows the same constraint.

## Goals / Non-Goals

**Goals:**
- Fix all four items with the smallest change that removes the Linear-specific
  assumption, reusing the alias/dispatch seams `ticket-provider.js` already
  provides rather than duplicating provider-kind logic at each call site.
- Keep `lib/ui/linear.js` unchanged.
- Keep Linear-provider behavior byte-identical.

**Non-Goals:**
- Comment authoring, comment sync, or any other local-provider feature CON-44
  explicitly deferred to a child ticket.
- Changing `docs/dashboard.md` — item 2's fix makes the doc's existing
  `Todo`/`In Progress` claim true for local tickets, rather than needing the
  doc corrected to match the (former) lowercase rendering.

## Decisions

### Decision 1 — Item 1: provider-neutral refresh copy, not provider-aware copy

`lib/ui/screens/launchpad.js`'s `renderLaunchPad(lp, runs, opts)` has no
`ticketProvider.kind` in scope — `appState.currentState(S)` (what feeds
`opts`/`lp` through `router.render`) carries no `config` today, and plumbing
one through for a single string is disproportionate. The fix is to change the
copy from `'fetching tickets from Linear…'` to `'fetching tickets…'` —
accurate under every provider, zero new plumbing, and the smallest possible
diff. Rejected alternative: thread `ticketProvider.kind` through
`currentState`/`opts` to render `'fetching tickets from local…'` etc. — real
provider-awareness, but adds a config dependency to a screen module that
currently has none, for a message that is only ever visible for the width of
one poll tick (the existing code comment already calls the fetch itself
"fast" — see item 1's ticket.md text).

### Decision 2 — Item 2: map `state.type` to human labels in `local.js`, not `docs/dashboard.md`

`lib/ui/linear.js:352-353`'s own contract is `state.type` = what code branches
on, `state.name` = what a human reads. `parseTicket` in `local.js` currently
sets both to the same raw value (`f.state`, e.g. `'unstarted'`). The fix adds
a small `STATE_NAMES` map (`backlog`→`Backlog`, `unstarted`→`Todo`,
`started`→`In Progress`, `completed`→`Done`, `canceled`→`Canceled`) and sets
`state.name` from it, leaving `state.type` as the raw value unchanged (every
existing `state.type` branch — `stateTypesFromConfig`, `inlineStatus`'s
`type === 'started'` check, `deriveEpics`'s open-state filtering — is
untouched). This is the "map the five types to human labels" branch the
ticket poses as one of two options, chosen over "fix the doc" because
`docs/dashboard.md:413` already describes the CORRECT target behavior
(`Todo` / `In Progress`) — the doc was never wrong; the code was.
`inlineStatus`'s existing `type === 'started'` override (always renders
`'In Progress'` regardless of `state.name`) is unaffected either way, so this
change is only visible for `backlog`/`unstarted`/`completed`/`canceled`
tickets.

### Decision 3 — Item 3: route `draft.js`'s gate through `ctx.deps.linear.kindFor`

`ctx.deps.linear` is not `lib/ui/linear.js` — `watch.js`'s own header comment
(line 23-28) documents that the binding is deliberately named `linear` for
`ticket-provider.js`'s resolver, to avoid touching every `ctx.deps.linear`
call site for a rename. `draft.js` already calls
`ctx.deps.linear.teamKeyFromConfig` elsewhere in the same file (line 138), so
`ctx.deps.linear.kindFor(ctx.config)` is already reachable with no new wiring.
The fix replaces the raw `provider.kind !== 'linear'` comparison (and the raw
`provider.kind` interpolated into the fallback message) with the resolved
kind from `kindFor`, matching `local.js`'s own `launchPadStatus` gate (which
already benefits from `canonicalConfig`'s alias resolution per
`ticket-provider.js`'s own comment at line 101-103). No change to
`ticket-provider.js` itself is needed for this item — `kindFor` already
exists and is exported.

### Decision 4 — Item 4: a `fetchOneTicket` dispatch on `ticket-provider.js`, plus a synchronous local implementation

`lib/cli/validate.js`'s `buildTicketHarnessCheck` currently imports
`fetchOneTicket` directly from `lib/ui/linear.js` and gates on
`tp.kind !== 'linear'` (the raw, non-aliased value). The fix:

1. Add `local.fetchOneTicket(opts)` to `lib/ui/tickets/local.js`: reads
   `tickets/<ID>.md` directly (not the whole-directory `readTickets` scan,
   since only one id is needed), reusing the existing `parseTicket` for
   frontmatter parsing, and returns the same `{ id, identifier, labels }`
   shape `linear.js`'s `fetchOneTicket` already returns. A missing or
   malformed file rejects with a message in the same style as
   `createTicket`'s existing "local: ..." rejection, not a bare ENOENT.
2. Add `fetchOneTicket(config, opts)` to `ticket-provider.js`, dispatching
   through `moduleFor`/`canonicalConfig` exactly like `fetchTickets` (line
   139-143) does — the linear branch stays synchronous-looking at the call
   site (`mod.fetchOneTicket(opts)` already returns a Promise), the local
   branch is wrapped in `Promise.resolve` for the same "both branches are
   awaitable" reason `fetchTickets`'s own comment gives.
3. `validate.js`'s `buildTicketHarnessCheck` switches its provider gate from
   `tp.kind !== 'linear'` to `kind !== 'linear' && kind !== 'local'` (using
   `ticket-provider.js`'s `kindFor`, so `manual` resolves too), and its fetch
   call from `fetchOneTicket({ id: ticketId })` (the raw `lib/ui/linear.js`
   import) to `ticketProvider.fetchOneTicket(cfg, { id: ticketId, root })` —
   `root` is `cmdValidate`'s own already-resolved `out` (the project
   directory `resolveOut(args)` produces), matching how `watch.js` passes
   `root` to `linear.fetchTickets` today.
4. `lib/config.js:438`'s message and `lib/cli/help.js:42`'s doc line both
   drop the "only ... linear today" framing; `lib/config.js`'s message names
   the actually-unsupported kind (still surfaced via
   `thc.providerKind`) rather than hardcoding "linear" as the one supported
   kind.

Rejected alternative: keep `buildTicketHarnessCheck` calling
`lib/ui/linear.js` directly and add an `if (tp.kind === 'local') {...} else
{...}` branch inline in `validate.js`. Rejected because it would duplicate
the alias-resolution logic `ticket-provider.js` exists to centralize (this
module's own header comment: "every call site... goes through here instead of
requiring linear.js directly"), and because it would leave `validate.js` as
the one remaining caller bypassing that seam.

## Risks / Trade-offs

- [Decision 1's provider-neutral copy is a narrowing, not a full fix — a
  future provider-aware message would still need the `currentState`/`opts`
  plumbing this decision avoids] → Acceptable: the ticket's own acceptance
  criterion explicitly allows a provider-neutral message, and the string is
  visible for one poll tick.
- [Decision 4 adds a new on-disk read path (`local.fetchOneTicket`) parallel
  to the existing whole-directory `readTickets` scan — two places read
  `tickets/*.md` frontmatter] → Mitigation: both funnel through the same
  `parseTicket`, so the parsing/validation logic itself has exactly one
  implementation; only the file-selection (one file vs. a directory listing)
  differs.

## Migration Plan

No data migration. All four fixes are behavior-only changes to existing code
paths; no config schema, cache format, or on-disk ticket format changes.

## Open Questions

None — all four items have a single clear resolution per the decisions above.
