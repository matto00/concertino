# CON-192: Follow-up survival report: the first scoreable proxy for whether a suggestion was worth making

## Description

Filing a follow-up is cheap. Delivering it is the revealed judgment that it mattered. Nothing currently measures the second.

This is the closest available thing to a **fitness signal on taste**. Concertino's objective function is gate pass/fail, CI green, and satisfaction of stated acceptance criteria. Nothing in it scores *whether a piece of work was worth doing*, which is the one judgment that has consistently resisted delegation — and is exactly the judgment `triage-followup.sh` explicitly refuses to make, on the stated grounds that it has no signal for "not worth doing," only for scope and cost.

A per-role survival rate would be the first signal of that kind the system has ever had.

## Scope

Depends on CON-190 (`origin_kind` recorded on the ticket). Once that lands:

1. Report over Linear: for issues where `origin_kind=followup`, the fraction reaching `Done`, and the median age of those that do not.
2. Segment by **originating role** (executor / evaluator / skeptic / auditor / orchestrator) and by the persisted `triage.overlap` bucket.
3. Backfill what is recoverable for tickets already filed; flag the rest as unknown rather than guessing.

## Why it matters beyond a backlog metric

The follow-up channel's traffic fell sharply over the corpus period — helio triage escalations run 16, 14, 3, 9, 2, 1 per week (W33-W38) against flat throughput. (The ticket body states "fell 7x" and "16, 14, 3, 7, 2, 1"; the canonical probe — `escalation.raised` whose `options` contains `fold-in` — measures W36 as 9, not 7, and an endpoint ratio of 16x, not 7x. Corrected here per premise validation; the qualitative decline is real and confirmed.) The decline is confirmed behavioral, not a recording artifact: orchestrator-raised escalation volume is flat across the same weeks (53, 53, 31, 60, 53, and a partial W38 of 5), and every triage escalation is orchestrator-raised.

Three explanations remain open and the survival rate distinguishes them:

* **Backlog exhaustion** — later follow-ups should show *lower* survival than earlier ones.
* **Triage friction suppressing raises** — survival should hold flat or rise while volume falls.
* **Attention shifted to design/budget classes** — survival flat, and the rise in those classes accounts for the difference.

## Acceptance criteria

* A report, runnable on demand, giving follow-up survival overall and segmented by originating role.
* Survival computed over time, so the exhaustion-versus-suppression question above is answerable.

## Known acceptance-criterion defects (stated loudly, per premise validation)

* **The `origin_role` segmentation axis is degenerate by construction.** The only code path that emits `ticket.filed` is the `standaloneTicket` render template in `lib/cli/render.js`, which hardcodes `origin_role=orchestrator`. The five-way role axis (executor/evaluator/skeptic/auditor/orchestrator) can only ever produce one populated bucket. The axis must still be implemented and reported, but the report must **label it single-valued** rather than implying five-way resolution it cannot deliver. `suggested_by` (agent|human) is the axis that actually discriminates today.
* **`ticket.filed` count is currently 0.** Provenance accrues only from the next `standalone` triage onward. The report must render a well-formed, explicitly-empty result rather than a misleading 0% or a crash, and must say what is empty and why.
* **"Fraction reaching Done" needs Linear state types the existing client excludes.** `fetchTickets` accepts `opts.stateTypes`, but `OPEN_STATE_TYPES` = [backlog,unstarted,started] excludes completed states, and neither `QUERY` nor `normaliseTicket` carries `completedAt`. A report reusing the client unchanged would silently see zero Done tickets — an evidence-shaped non-result.
* **Escalation data before CON-188 is untrustworthy.** Exactly ONE escalation in the 378-raise corpus carries `escalation_id`; the boundary is CON-188's merge at t=1789595291000. Any escalation-derived figure must segment pre/post that boundary rather than averaging across it.

## Context

Filed from the Concertino research artifact (`~/obsidian/concertino`, doc `05 - Instrumentation Spec`, item I4). Blocked on CON-190 (merged, 5a8edb8). See `01 - The Follow-Up Channel` for the decline and `03 - Emulation and Origination` for why a scoreable proxy for worth is the prerequisite to any selection mechanism worth building.

---

## ADDED SCOPE 2026-09-17 (owner direction): the verification-machinery failure class

Folded into this ticket by owner ruling on escalation `CON-192-1789618231466-63f9e9`
(`fold-in-with-extended-design-budget`), which also granted a 4th design round. This
section had NOT been design-reviewed when the scope landed, which is why the run
halted and escalated rather than building it ungated.

It is the same question the survival report already asks, one level down: filing a
follow-up is cheap and delivering it is the revealed verdict that it mattered; a gate
reporting green is cheap, and actually measuring something is the revealed verdict
that it was a gate. Treat it as one analysis over two subjects, not an appended
section.

### What it must deliver

* **Enumerate and classify** the instances, verifying each before citing it — the
  seven in the Linear description are a starting set, not the answer.
* **Test the candidate signature** rather than adopting it: subject absent/unset;
  success inferred from absence of failure; measuring a copy rather than the artifact
  in use; the check's own mechanism being the thing it guards; exit status taken from
  the wrong process. Whether that decomposition survives contact with the data is
  itself a finding.
* **State the detection rule WITH its limits** — "demonstrate failability by mutation,
  plus count the assertions that actually executed" — naming explicitly which
  instances it would and would **not** have caught. An overstated rule is the same
  failure class as the bugs it describes.
* **Recommend, do not implement.** Concrete fixes become their own tickets.

### Acceptance bar (carried from the base ticket, doubly load-bearing here)

Any computed count or rate must carry an injected control proving it can come out
differently. A report about machinery that reports success while measuring nothing
must not itself be an instance of the class.
