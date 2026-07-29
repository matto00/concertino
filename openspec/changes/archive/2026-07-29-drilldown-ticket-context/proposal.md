## Why

The drill-down identifies a run by ticket id and the change name derived
from its branch (`CON-7  reap-finished-run-tmux-windows`). That tells you
which run you are looking at, but nothing about what it is *for*. Reading the
timeline, gates and verdicts without the ticket in front of you means holding
the requirement in your head, or leaving the dashboard to go find it in
Linear.

## What Changes

- A new bounded **TICKET** panel on the drill-down screen shows the ticket's
  title (also surfaced in the header) and its description, rendered as plain
  text (markdown stripped) with control bytes stripped the same way
  `f.truncate` already strips them everywhere else on this screen.
- A run whose ticket text cannot be resolved renders the honest fallback
  `ticket text unavailable`, styled identically to the existing `no evidence
  recorded` / `no gate results recorded` degradation strings — never an empty
  frame.
- A long description does not grow unbounded and push TIMELINE/GATES/EVIDENCE
  off screen: the panel caps itself to a fixed number of content rows and, when
  truncated, says so visibly (`… N more lines`) rather than silently dropping
  the tail — the same convention TIMELINE already uses for events beyond
  `MAX_TIMELINE`.
- Ticket text is resolved from whichever of two existing sources survives the
  run, preferring the more durable one:
  1. The **persisted `ticket.md`** at
     `.concertino/runs/<TICKET_ID>/evidence/ticket.md` in the main
     checkout — a snapshot of exactly what the run worked from, and the one
     source that survives `cleanup.sh --phase4` destroying the worktree.
  2. The **launch pad cache** (`.concertino/cache/linear.json`), matched by
     ticket identifier, for a run whose `ticket.md` was never persisted (e.g.
     a run from before this change, or one that escalated before Planning
     finished writing it).
  3. Neither present → `ticket text unavailable`.
- The orchestrator now persists `ticket.md` through `persist-evidence.sh`
  alongside the other planning artifacts (`proposal.md`, `design.md`,
  `tasks.md`, spec deltas) at the point Planning already stops to do this —
  a one-line addition to `core/roles/orchestrator.md`'s existing loop, plus
  the corresponding `evidence-telemetry` spec update to its enumerated
  artifact list. `ticket.md`'s existing convention also gains one small
  requirement — a `## Description` heading immediately following the title —
  so the description can be parsed out of a file that also carries
  acceptance-criteria and metadata sections, without those bleeding into the
  bounded TICKET panel (see design.md Decision 3).
- This works for a finished run whose worktree has been destroyed, because
  the dashboard never reads `ticket.md` from the worktree path — only from
  its persisted, main-checkout copy (source 1 above) or the cache (source 2).

## Capabilities

### New Capabilities
- `drilldown-ticket-context`: the drill-down's TICKET panel — what it shows,
  how it resolves ticket text from the two sources above in preference order,
  how it degrades when neither is available, and how it bounds/truncates a
  long description without displacing the other panels.

### Modified Capabilities
- `evidence-telemetry`: the orchestrator's "persist each planning artifact"
  requirement's enumerated artifact list grows to include `ticket.md`.

## Impact

- `lib/ui/ticket-text.js` (new): resolves `{ title, description } | null` for
  a ticket from the persisted `ticket.md` first, the launch pad cache second.
- `lib/ui/markdown.js` (new): a small, dependency-free markdown-to-plain-text
  helper (strips heading/list/emphasis/code/link markup) shared by whichever
  screens want plain-text rendering of Linear-authored markdown.
- `lib/ui/textwrap.js` (new, extracted from `lib/ui/screens/ticketview.js`):
  the existing visible-column-aware greedy word-wrap, so `drilldown.js` does
  not duplicate it. `ticketview.js` switches to the extracted module with no
  behavior change (existing `test/ticketview.test.js` coverage is unaffected).
- `lib/ui/screens/drilldown.js`: new TICKET panel, header gains a title row.
- `lib/ui/watch.js`: reads ticket text (gated on `mode === 'drilldown'`, same
  pattern as the existing `queuedTitles` cache read) and passes it through
  `opts` to the router, same seam `queuedTitles` already uses.
- `core/roles/orchestrator.md`: `ticket.md` added to the Phase 1 persist-evidence
  loop.
- New tests: `test/ticket-text.test.js`, `test/markdown.test.js`, additions to
  `test/drilldown.test.js`, `test/textwrap.test.js` (moved/renamed from the
  wrap-specific cases in `test/ticketview.test.js`).
