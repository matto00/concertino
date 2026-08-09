## Context

`core/scripts/cleanup.sh --phase4` fast-forwards local `main` after a merge as a best-effort nicety
(design intent documented in the script's own header: "a stale base is a risk for the NEXT run, never
a reason to leave THIS already-merged ticket's teardown incomplete"). When it can't fast-forward
cleanly (dirty tree, diverged base, or an unexpected `git` failure), it raises a blocking
`escalation --await` and, on a `retry` answer, tries once more. If that retry still doesn't resolve
to `updated`/`current`, today's code (`cleanup.sh:181-194`) only writes a stderr `echo` note and falls
through — `run.end status=delivered` fires immediately after, with nothing in the event log
distinguishing this outcome from a clean fast-forward. CON-90 through CON-94 show this pattern
repeatedly: `retry` answered, `run.end status=delivered` ~1s later, no durable trace of whether the
retry actually worked.

This was escalated back to the human per the ticket's own request ("this is exactly the kind of call
that should go back to me as an escalation rather than being assumed"). The resolved decision
(CON-99, corrected mid-session from an initial "re-raise a second blocking escalation" to the final
answer below): **the run should still terminate as `delivered`** — the underlying PR is genuinely
merged, and the fast-forward is a Phase-4 nicety, not grounds to fail an already-shipped ticket — but
the outcome must become a **distinct, dashboard-visible, non-blocking signal** instead of a
stderr-only note nobody but a terminal ever sees.

## Goals / Non-Goals

**Goals:**
- Make a second-consecutive unresolved fast-forward failure (after `retry`) durably visible in the
  run's event log, so the dashboard can show it, without requiring a human to be watching a terminal
  at the exact moment `cleanup.sh` runs.
- Keep the distinction already present in the stderr note — "confirmed still behind" (dirty/diverged/
  failed) vs. "unknown, couldn't even complete the comparison" (fetch-failed/no-local-base) — in the
  new telemetry too, not just in prose.
- Reuse an already-established, already-tested pattern rather than inventing a new one.

**Non-Goals:**
- Do NOT block Phase 4 or change `cleanup.sh --phase4`'s exit code on this account — it must still
  always exit 0 and `run.end status=delivered` must still fire unconditionally, exactly as today.
- Do NOT raise a second blocking escalation. (This was the initially-resolved answer, later corrected
  by the human mid-session; the final decision explicitly rejects it — a run whose PR is genuinely
  merged should not have Phase 4 pause a second time waiting on a human.)
- Do NOT introduce a new dashboard run-status value (e.g. a "delivered-with-warning" `run.endStatus`).
  The run still ends `status=delivered`; the warning is a separate, additive telemetry event a
  drill-down/timeline view can surface, not a change to the terminal status itself.
- Do NOT change the existing bounded retry/skip loop's shape (one escalation, one retry) — only what
  happens when that retry still doesn't resolve.

## Decisions

**Decision 1 — Reuse the `gate.warning` event kind, not a new one.**
`assert-phase.sh delivery` already established exactly this pattern for a structurally identical
problem (CON-80, `delivery-stale-base-warning`): a best-effort check that must never fail or block the
gate, whose outcome still needs to be dashboard-visible, implemented as an additive `gate.warning`
event alongside the gate's normal `gate.result`. `lib/ui/reducer.js` has no dedicated case for
`gate.warning` today (falls through to `default: break`) — it is `run.events.push(ev)`-only, i.e.
already generically visible to anything that reads a run's event log (the drill-down/timeline), with
no dashboard code change required to add another kind of `gate.warning`. Using the same kind for
`cleanup.sh` keeps this one recognizable pattern instead of two similar-but-different ones.
Alternative considered: a bespoke `cleanup.warning` kind — rejected, since nothing about this outcome
is cleanup-specific in a way `gate.warning`'s existing `gate=` field can't already express
(`gate=phase:cleanup`, mirroring `gate=phase:delivery` on the existing usage).

**Decision 2 — Emit the event for every non-`updated`/non-`current` retry outcome, not only the
"confirmed still behind" ones.**
The acceptance criteria's second bullet is general — "any escalation answer that doesn't actually
resolve the underlying blocker" — not scoped to only `dirty`/`diverged`/`failed`. The retry landing on
`fetch-failed` or `no-local-base` is exactly as unresolved (the comparison never even completed) as
landing on a confirmed-still-behind status, so it gets the same telemetry treatment. The event's
payload distinguishes the two cases via a `resolved=false` field plus a `reason=` string, reusing the
same distinction the existing stderr note already draws (`FF_STATUS` value at the note's call site).
Alternative considered: only emit for the confirmed-still-behind cases, leaving the unknown-state case
stderr-only — rejected as under-covering the AC's own wording.

**Decision 3 — No change to `run.end`'s `status=` value.**
`run.end status=delivered` is correct regardless of this outcome: the PR did ship. Overloading it
(e.g. `status=delivered-with-warning`) would touch `deriveStatus()` in `lib/ui/reducer.js`, the
`STATUS_ORDER` table, and every place that currently branches on `endStatus === 'delivered'` — a much
larger, riskier surface than this ticket's scope warrants, for a signal that `gate.warning` already
carries. If the dashboard later wants a dedicated "delivered, but check this" row treatment, that's a
natural follow-up once this telemetry exists to build it on top of — not a prerequisite for this fix.

## Risks / Trade-offs

- [A `gate.warning` with no dedicated reducer case is only as visible as whatever view already renders
  raw events (e.g. a drill-down/timeline panel).] → Acceptable: this is the exact same trade-off
  `delivery-stale-base-warning` already shipped with, and it satisfies "never indistinguishable from a
  clean run" — a clean run's log has no such event, a warned one does — without this ticket also
  having to design new dashboard chrome.
- [Emitting telemetry for the unknown-state case (fetch-failed/no-local-base) could read as
  over-eager, since that state doesn't necessarily mean `main` is actually behind.] → Mitigated by
  carrying the distinction in the event payload itself (`reason=` names which case it is), so a
  consumer can filter/downweight the unknown case without losing the signal entirely.
- [`emit-event.sh` calls are best-effort/non-fatal by contract.] → Unchanged risk profile: exactly like
  the existing stderr note and every other `emit-event.sh` call-site in this script, a failure to emit
  must not fail `cleanup.sh --phase4` itself.
