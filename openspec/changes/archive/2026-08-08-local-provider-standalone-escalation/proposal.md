## Why

`core/roles/orchestrator.md`'s "Triaging a suggested follow-up" sub-procedure renders its
`standalone` branch unconditionally as "file a new Linear ticket (`mcp__linear__save_issue`, no
`id`)". Under `ticketProvider.kind: "local"` the rendered orchestrator agent has no Linear MCP
tools at all (`lib/cli/emit.js` grants `[]` when a provider has no `mcpTools` entry), so a human
answering `standalone` on a local-provider project sends the orchestrator down an instruction it
cannot execute. The orchestrator already has `Write`/`Bash` and the local provider's own rendered
prose documents the `tickets/<ID>.md` frontmatter shape (`core/roles/orchestrator.md`'s
`ticketProvider` block, CON-44) — the gap is that the `standalone` branch never says to write one,
and there is no script to pick the next free `<PREFIX>-N` id the way `next-report-number.sh`
already does for review-report filenames.

## What Changes

- `core/roles/orchestrator.md`'s `standalone` triage bullet becomes provider-conditional (a new
  `{{block:standaloneTicket}}` seam in `lib/cli/render.js`, mirroring the existing `ticketProvider`
  block): `linear` and `github` keep today's exact wording; `local` instructs the orchestrator to
  allocate the next ticket id and write `tickets/<PREFIX>-<N>.md` with the same frontmatter shape
  the local provider already documents (`title:`, `state: backlog`) and a body summarizing the
  suggestion and linking back to the current ticket.
- New canonical script `core/scripts/next-ticket-id.sh <tickets-dir> <prefix>`, mirroring
  `core/scripts/next-report-number.sh`'s disk-scan convention: scans `<tickets-dir>` for
  `^<prefix>-([0-9]+)\.md$`, prints `READY id=<prefix>-<next> path=<tickets-dir>/<prefix>-<next>.md`
  on success, `FAIL <reason>` on stderr and non-zero exit otherwise (unreadable/missing dir created
  on demand, invalid prefix shape, or an unexpected pre-existing target).
- Mirror the new script byte-for-byte into `scripts/concertino/next-ticket-id.sh` (this repo
  dogfoods itself — see CONTRIBUTING.md's `core/` → rendered `scripts/concertino/*` relationship),
  chmod +x.
- Update `test/scripts/local-provider-render.test.sh`'s comment that currently documents the
  `standalone` triage option as a *pre-existing, out-of-scope* unconditional Linear mention — that
  is no longer true for `local` after this change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `followup-triage`: the "A standalone verdict files a concrete Linear ticket" requirement becomes
  provider-conditional — `linear`/`github` unchanged, `local` files a `tickets/<ID>.md` entry
  instead of a Linear ticket.

## Impact

- Affected template: `core/roles/orchestrator.md`.
- Affected code: `lib/cli/render.js` (new `standaloneTicket` block case).
- New script: `core/scripts/next-ticket-id.sh`, mirrored to `scripts/concertino/next-ticket-id.sh`.
- Test coverage: new `test/scripts/next-ticket-id.test.sh`; extend
  `test/scripts/local-provider-render.test.sh` to assert the `local` rendering names
  `next-ticket-id.sh` and `tickets/`; extend the linear/github render fixtures (or an equivalent
  existing render test) to assert the `standalone` bullet's wording is byte-identical to before.
- No breaking changes; `linear`/`github` rendered output for the `standalone` bullet is unchanged.
