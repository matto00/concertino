## Context

`core/roles/orchestrator.md` is a harness/project-neutral template rendered by `concertino sync`
into each configured harness's native layout (`lib/cli/render.js`'s `renderBody`). Provider-
conditional prose already has an established mechanism: `{{block:<name>}}` seams resolved by
`lib/cli/render.js`'s `block()` switch, keyed on `c.ticketProvider.kind` (see the existing
`ticketProvider` case, CON-44). The followup-triage sub-procedure's `standalone` branch
(`core/roles/orchestrator.md` ~line 479) is plain unconditional prose naming
`mcp__linear__save_issue`, predating that per-provider split.

`ticketProvider.kind: "local"` grants the rendered orchestrator agent no MCP tools for the ticket
provider (`lib/cli/emit.js`'s `mcpTools[c.ticketProvider.kind] || []`), only `Read`/`Write`/`Bash`/
etc. Under `local`, tickets live at `tickets/<ID>.md` (`lib/ui/tickets/local.js`), a tracked
directory the local provider's own `ticketProvider` block already documents: frontmatter
`title:`/`state:`/`priority:`/`epic:`/`labels:`, body = description, id = filename stem, state
values `backlog|unstarted|started|completed|canceled` (matching Linear's `state.type`
vocabulary — see `set-ticket-state.sh`).

`core/scripts/next-report-number.sh` already solves an analogous "next free numbered filename"
problem for review reports (disk-scan, not a run-local counter, so it is correct across a `fold-in`
re-run in a freshly re-created worktree). The same shape — scan, compute `next`, safety re-check,
`READY`/`FAIL` contract — fits the "next free `<PREFIX>-N` ticket id" problem needed here.

## Goals / Non-Goals

**Goals:**
- Under `local`, a human answering `standalone` sends the orchestrator down an instruction it can
  actually execute: write a real `tickets/<PREFIX>-<N>.md`.
- `linear`/`github` rendered output for the `standalone` bullet is preserved byte-for-byte.
- The new id-allocation logic is a canonical script (like every other state mutation in this
  workflow — `emit-event.sh`, `persist-evidence.sh`, `set-ticket-state.sh`, `next-report-number.sh`),
  not ad hoc bash the orchestrator improvises inline.

**Non-Goals:**
- Dashboard/TUI ticket authoring for `local` (`lib/ui/tickets/local.js`'s `createTicket()` already
  documents this as deferred to a separate child ticket of CON-44) — this change is scoped to the
  orchestrator's own `standalone` triage action, not the launch pad.
- The CON-62 harness-override note's own unconditional `mcp__linear__get_issue` mention
  (`core/roles/orchestrator.md` ~line 136) — CON-91 explicitly judges this cosmetic and
  out of scope; not touched here.
- Any change to `linear`/`github`'s `standalone` behavior — both keep filing a remote ticket exactly
  as today.

## Decisions

### Decision 1: A new `{{block:standaloneTicket}}` seam, not inline `{{var:}}` substitution

The `standalone` bullet's wording differs structurally per provider (a whole paragraph, not one
token), and this project already has a mechanism for exactly this shape: the `ticketProvider` block
case. A new `standaloneTicket` case in `lib/cli/render.js`'s `block()` switch keeps `linear`/`github`
literally the pre-existing string (verified byte-identical by test) and adds a `local` branch.
Alternative considered: parameterize with `{{var:ticketProvider.kind}}` inside a single shared
sentence — rejected because the `local` instructions need multiple extra steps (allocate an id, run
a script, write frontmatter) that don't fit as a single-sentence template with one substituted noun.

### Decision 2: A disk-scan id allocator script, mirroring `next-report-number.sh`

`core/scripts/next-ticket-id.sh <tickets-dir> <prefix>` scans `<tickets-dir>` for
`^<prefix>-([0-9]+)\.md$`, computes `next = highest + 1` (or `1` if none), and either prints
`READY id=<prefix>-<next> path=<tickets-dir>/<prefix>-<next>.md` and exits 0, or `FAIL <reason>` to
stderr and exits non-zero. This directly reuses `next-report-number.sh`'s proven contract (same
scan-not-counter rationale: a script the orchestrator calls fresh each time, so it is correct
regardless of how many tickets already exist, with no run-local state to go stale). Differences from
`next-report-number.sh`: the pattern's `<prefix>` is a caller-supplied argument (not a fixed
enum of three kinds) and is validated against its own, stricter shape —
`^[A-Za-z][A-Za-z0-9]*$` (letters then optional letters/digits, no `#`/`_`/`-`, and the regex
itself forbids a trailing digit only in the sense that a purely-numeric-suffixed candidate like
`CON9` still matches; the real invariant this shape protects is that `<prefix>` never contains the
`-` separator itself, so `<prefix>-<next>` cannot be ambiguously re-split). This is deliberately
narrower than `set-ticket-state.sh`'s own full-ticket-id validation
(`^[A-Za-z#][A-Za-z0-9_-]*[0-9]$`, which validates a complete `<PREFIX>-<N>` id, not just the
prefix component in isolation) — the two scripts validate different things and are not meant to
share a pattern. `<tickets-dir>` is created with `mkdir -p` if missing (unlike `next-report-number.sh`,
which fails on a missing `<change-dir>`) — a `local`-provider project's very first standalone
follow-up may be filed before any human has hand-created a `tickets/` directory, and there is
nothing unsafe about creating an empty tracked directory that the local ticket store's own reader
(`lib/ui/tickets/local.js#readTickets`) already treats as a legitimate empty state.

The orchestrator derives `<prefix>` from its own `$TICKET_ID` by stripping the trailing
`-<digits>` (e.g. `CON-91` → `CON`) — the current ticket's own prefix is always a valid, known-good
prefix for this project, so no new config field or extra lookup (`ticketProvider.idExample`,
`teamKey`) is needed.

### Decision 3: `core/scripts/` + a mirrored `scripts/concertino/` copy, not `scripts/concertino/` alone

Per `CONTRIBUTING.md`'s `core/` → rendered `scripts/concertino/*` relationship, `core/scripts/*.sh`
is the single source of truth and `scripts/concertino/*.sh` is copied byte-for-byte by
`concertino sync` (or hand-mirrored when no `concertino.config.json` is present, as in this
repo's own untracked-since-CON-70 self-hosting setup). This change adds the new script under
`core/scripts/next-ticket-id.sh` and mirrors it verbatim to `scripts/concertino/next-ticket-id.sh`
(chmod +x on both) so this repo's own tracked `scripts/concertino/` does not drift the way CON-52
already documented as a real, previously-hit bug class.

### Decision 4: Modify the existing `followup-triage` capability, not add a new one

`openspec/specs/followup-triage/spec.md`'s "A standalone verdict files a concrete Linear ticket"
requirement is the exact contract this change is correcting — it already names
`mcp__linear__save_issue` unconditionally. This change ships a `## MODIFIED Requirements` delta
against that capability (renaming/rewording it provider-conditionally) rather than introducing a
new capability, keeping one requirement as the single source of truth for `standalone`'s behavior
across all three providers.

## Risks / Trade-offs

- [Risk] A `local` project's `tickets/` directory does not yet exist when the first standalone
  follow-up is filed → Mitigation: `next-ticket-id.sh` creates it with `mkdir -p`, consistent with
  `readTickets()` already treating a missing directory as "zero tickets," not an error.
- [Risk] A malformed or empty `$TICKET_ID` produces a garbage `<prefix>` → Mitigation:
  `next-ticket-id.sh` validates `<prefix>` against the same shape convention `set-ticket-state.sh`
  already enforces for ticket ids, and fails loudly (`FAIL`) rather than writing a wrongly-named
  file; the orchestrator's own prose derives `<prefix>` mechanically from an already-validated
  `$TICKET_ID` (canonical shape enforced upstream by `assert-phase.sh`/`emit-event.sh`), so this is
  a defense-in-depth check, not the primary safeguard.
- [Risk] Editing `core/roles/orchestrator.md`'s block seam regresses `linear`/`github` wording
  → Mitigation: `test/scripts/local-provider-render.test.sh` (or a sibling render test) asserts the
  `standalone` bullet text is byte-identical to today's for both `linear`- and `github`-configured
  fixtures, in addition to asserting the new `local` wording.

## Migration Plan

No data migration. Purely template/script additions; `linear`/`github` projects see no behavior
change after their next `concertino sync`. `local` projects see the new `standalone` wording only
after re-syncing with this version of `core/`.
