## Why

Starting a run today requires already having a ticket id. The thing a human
usually has is an intention ("add a share button to dashboards"), not an id.
Turning that intention into a ticket means leaving the dashboard, writing it
in Linear by hand, waiting for the launch pad's cache to refresh, then coming
back to launch. The TUI already has everything else needed to close this gap
in place.

## What Changes

- The `n` new-run prompt (fleet screen, `lib/ui/screens/fleet.js`) accepts
  either a ticket id or free text. Ticket-shaped input — including today's
  `TICKET speed`/`TICKET --agent-merge` forms — is classified by
  `parseTicketInput(value) !== null` (`lib/ui/prompt.js`, itself built on the
  single `looksLikeTicket` predicate in `lib/ui/ticket.js`) and behaves
  exactly as today — unchanged fast path, no regression risk.
- Non-ticket-shaped input opens a new ticket-draft flow: a headless,
  print-mode Claude Code invocation (`claude -p ... --output-format json`,
  spawned via `child_process`, not tmux) drafts a title, description, and
  acceptance criteria from the free text.
- A new TUI screen (modeled on `escalation.js`'s sub-question wizard, the
  closest existing multi-field edit precedent) shows the draft for review:
  the human can edit each field, confirm, or abandon without creating
  anything.
- On confirm, the ticket is created via a new, narrowly-scoped Linear
  mutation in `lib/ui/linear.js` (using the existing `httpsTransport`/
  `postRaw` plumbing) — the TUI's first write to the ticket provider ever,
  explicitly limited to issue creation only (never status transitions, which
  remain the orchestrator's sole responsibility).
- Immediately after creation, the flow calls the existing `submitTicket`
  (`lib/ui/prompt.js`) with the real, provider-issued ticket id — same launch
  path, same single `{{TICKET}}` substitution site, unchanged.
- After a successful creation, `refreshLaunchPad()` (`lib/ui/watch.js`) is
  triggered so the new ticket appears in the `N` launch-pad screen's cache
  without a manual refresh.
- Provider-gated: this flow is only reachable when `ticketProvider.kind ===
  'linear'`, matching the launch pad's existing provider gate
  (`launchPadStatus`, `lib/ui/linear.js`). `github`/`manual` show the same
  "not available for this provider" treatment the launch pad already uses —
  no new provider implementation in this change.

**BREAKING**: none. `lib/ui/linear.js` remains additive (new mutation
function alongside existing read-only queries); no existing call site or
exported signature changes.

## Capabilities

### New Capabilities

- `ticket-draft`: free-text-to-draft flow — headless drafting invocation,
  draft-review-edit-confirm TUI screen, and provider creation-on-confirm,
  gated to `ticketProvider.kind === 'linear'`.

### Modified Capabilities

(none — no existing capability's requirements change; `n`'s ticket-shaped
path is unmodified behavior, and the launch pad's cache-refresh is invoked
via its existing function, not a new contract)

## Impact

- `lib/ui/screens/fleet.js` — `promptKey` branches: ticket-shaped input keeps
  today's `submit-prompt` action; non-ticket-shaped input dispatches a new
  `open-ticket-draft` action instead of erroring.
- `lib/ui/watch.js` — new `applyAction` cases for the draft flow's actions;
  new headless-invocation helper (child_process, not tmux); calls
  `refreshLaunchPad()` post-creation.
- `lib/ui/linear.js` — new `createTicket({ apiKey, teamKey, title,
  description })` mutation, scoped to creation only. `description` is the
  fully composed markdown body; the caller folds the human-edited
  acceptance-criteria field into it (as a `## Acceptance Criteria` section,
  matching the format the orchestrator already writes into `ticket.md`)
  before calling — `createTicket` has no separate acceptance-criteria
  parameter and does no composition itself (see design.md Decision 1).
- `lib/ui/router.js` — new screen registration (`mode: 'ticketdraft'`).
- New file: `lib/ui/screens/ticketdraft.js` — `render`/`handleKey` pair
  following the existing screen contract.
- Out of scope (explicit non-goals, confirmed with the human at planning):
  the standalone `concertino-create-ticket` CLI command from `ROADMAP.md`
  (logic factored for future reuse, not built here); `github`/`manual`
  provider support; multi-ticket drafting; a cold-skeptic review gate on the
  draft before creation (left as a documented future enhancement).
