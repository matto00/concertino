# CON-107: Make METRICS' recent-escalations list selectable and inspectable

## Description

METRICS' "recent escalations" list (`lib/ui/screens/fleet/metrics.js`, built from `escalation.raised`/`escalation.answered` events) renders as flat, unselectable text — time, ticket, role, truncated question. Unlike EVIDENCE's rows, there's no way to open one and see the full question, its options, and how it was answered. The underlying data (question, options, raiser, eventual decision) is already captured in each run's event log; this is purely a missing UI affordance.

## Proposed

Make the "recent escalations" list a navigable list (`j`/`k` to move selection, `↵` to open) reusing the existing (live) escalation screen's rendering in a read-only "historical" mode — same question/options layout, but no answer keys, since these escalations are already resolved.

## Design decisions to escalate

* Scope of "recent" — currently bounded by however many lines fit under `columnAreaHeight`. Does opening the list need its own scrollable/paginated view to see further back than what's currently visible, or is "recent" intentionally shallow (glanceable only)?

## Acceptance criteria

* Each row in METRICS' recent-escalations list is selectable and opens a detail view showing the full question, options, and the eventual decision (or "no answer recorded" for a timeout).
* A still-live escalation opened this way routes to the same answerable escalation screen `g`/`↵` already use elsewhere, rather than a second, divergent code path.
* Documented in `docs/dashboard.md`.
