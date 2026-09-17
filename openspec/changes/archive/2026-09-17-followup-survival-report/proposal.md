## Why

Concertino's objective function scores gate pass/fail, CI green, and satisfaction of stated acceptance criteria. Nothing in it scores **whether a piece of work was worth doing** — the one judgment that has consistently resisted delegation, and precisely the judgment `triage-followup.sh` explicitly refuses to make ("no signal for 'not worth doing,' only for scope and cost"). Filing a follow-up is cheap; delivering it is the revealed judgment that it mattered. CON-190 landed the provenance (`ticket.filed` with `origin_kind`/`origin_role`/`suggested_by`/`triage`) that makes the second measurable for the first time.

## What Changes

- **New `concertino report followup-survival` subcommand** — a read-only, on-demand report giving follow-up survival (the fraction of `origin_kind=followup` tickets reaching a `completed` Linear state) overall, segmented by originating role, by `suggested_by`, and by the persisted `triage.overlap` bucket.
- **Survival over time** — survival bucketed by the filing week of each follow-up, so the ticket's three competing explanations for the observed decline in follow-up traffic (backlog exhaustion / triage friction suppressing raises / attention shifted to other escalation classes) become distinguishable rather than merely asserted.
- **Two provenance sources, never averaged together** — the `ticket.filed` event log (authoritative, structurally complete, and **currently empty**) and a recoverable-backfill scan of Linear ticket descriptions for CON-190's `origin_kind: followup` / `origin_ticket:` convention. Every reported figure states which source it came from and how many rows were `unknown`.
- **Honest-emptiness contract** — with zero `ticket.filed` events the report renders a well-formed, explicitly-empty result naming what is empty and why, never a misleading `0%` and never a crash.
- **A stated-defect section in the report's own output** — the `origin_role` axis is degenerate by construction (the only `ticket.filed` emitter hardcodes `origin_role=orchestrator`), and escalation-derived figures are unreliable before CON-188. The report labels both rather than presenting a precise-looking number over untrustworthy input.
- Linear query surface extended to reach `completed` states and to carry `createdAt`/`completedAt`, which the current launch-pad query omits — without which a survival report silently measures zero completions.

## Capabilities

### New Capabilities
- `verification-vacuity-analysis`: a standing, on-demand-readable analysis artifact enumerating and classifying the "verification machinery that reports success while measuring nothing" class — verified instances, the tested shared signature, a detection rule with its explicitly stated limits, and recommendations (never fixes). Added by owner ruling on escalation `CON-192-1789618231466-63f9e9` under an extended design budget.
- `followup-survival-report`: an on-demand, read-only report computing follow-up survival from `ticket.filed` provenance plus a recoverable Linear backfill, segmented by originating role, `suggested_by`, and `triage.overlap`, bucketed over time, with explicit source attribution, `unknown` accounting, and a documented empty-corpus result.

### Modified Capabilities
<!-- None. The Linear client gains optional query fields and the CLI gains a
     new subcommand, but no existing capability's REQUIREMENTS change: the
     launch-pad fetch keeps its current default state types and shape. -->

## What Changes (added scope)

- **A new tracked analysis artifact**, `docs/verification-vacuity-2026-09.md`, following the existing `docs/*-audit-*.md` precedent (numbered findings, tracked, referenced from `CONTRIBUTING.md`).
- It enumerates **13 verified instances** — the ticket's seven (one of whose framing is corrected), five unlisted ones recovered from the corpus, and one newly found in `concertino doctor` — each with the evidence that verified it and its status.
- It **tests** the ticket's candidate five-shape signature rather than adopting it, concluding that the decomposition holds but is not a partition, that shape (c) must be restated as a property of the reviewer's mutation target, and that a **sixth shape** is required for ambient-state contamination.
- It states the detection rule **with its limits**, naming which instances R1/R2 would and would **not** have caught (roughly 6 of 13), and proposes R3 (positive control) and R4 (name the consumer).
- It records the orchestrator's **own six probe failures** during this analysis as first-party evidence, each caught only by a control.
- Every computed count carries a control, and the mention-vs-instance distinction is stated explicitly rather than elided.
- **Recommendations only** — five spinoffs named, no fixes applied.

## Impact

- **New (added scope)**: `docs/verification-vacuity-2026-09.md` (analysis artifact), sourced from the orchestrator's verified ledger at `openspec/changes/followup-survival-report/class-evidence.md`.
- **New**: `lib/cli/report.js` (subcommand implementation), `lib/followup-survival.js` (pure computation, unit-testable without network or event-store I/O), `test/followup-survival.test.js`, `test/cli-report.test.js`.
- **Modified**: `bin/concertino` (dispatch), `lib/cli/help.js` (`USAGE`/`USAGE_ORDER` — `test/cli-help-flags.test.js` requires every subcommand honour `--help`), `lib/ui/linear.js` (additive: `createdAt`/`completedAt` in `QUERY`/`normaliseTicket`; `fetchTickets` already accepts `opts.stateTypes`).
- **Reads**: `.concertino/runs/*/events.jsonl` via the existing `lib/ui/store.js` readers; Linear via `LINEAR_API_KEY`.
- **Unchanged**: `emit-event.sh` and every other procedure script under `core/scripts/` — this change consumes CON-190's instrumentation and adds none of its own. No `schema.change` event is warranted.
- **Dependencies**: none added; the zero-runtime-dependency constraint in `CONTRIBUTING.md` holds.
