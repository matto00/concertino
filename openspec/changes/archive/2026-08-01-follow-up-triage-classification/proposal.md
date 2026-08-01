## Why

Deliveries routinely surface suggested follow-up work (evaluator non-blocking
suggestions, skeptic non-blocking notes, the orchestrator's own one-shot
post-cleanup observation). Today every one of these reaches the human as a
bare suggestion with no structured basis for "fold this into the current
change" vs. "file it separately" vs. "not worth doing" — and CON-30 shows the
concrete cost: a fold-in was approved and recorded (`escalation.answered`
fired correctly) but the current run's plan was never actually revised to
cover the added scope, so the work silently never happened until it was
split back out later. A cheap, mechanical classification step run before the
question ever reaches the human — and a hard requirement that a "fold-in"
verdict trigger a real re-planning pass, not just a flag — closes both the
"uninformed approval" gap and the "recorded but not executed" gap in the same
change.

## What Changes

- Add `core/scripts/triage-followup.sh`: given a one-line description of a
  suggested follow-up, the files it would touch, and two caller-supplied
  judgment calls (acceptance-criteria relevance, effort/size), it computes
  the one signal that is genuinely mechanical — file overlap between the
  follow-up's files and the current change's already-modified files (via
  `git -C WORKTREE_PATH diff --name-only <base>...HEAD`) — and combines all
  four signals through a fixed decision table into a `fold-in` / `standalone`
  / `discard` recommendation with stated reasoning, printed to stdout for use
  as an escalation `context=` value. Mirrors `gather-escalation-context.sh`'s
  contract (`FAIL <reason>` to stderr + non-zero exit on bad input, nothing
  printed on failure) without being folded into that script, since its inputs
  (git state, a decision table) differ from that script's pure-formatting
  kinds.
- Add a new `core/roles/orchestrator.md` sub-procedure, **"Triaging a
  suggested follow-up,"** that both existing follow-up-surfacing points call
  by name instead of reimplementing:
  - **Phase 3 Delivery**, before presenting non-blocking evaluator/skeptic
    suggestions to the human: for each suggestion that names discrete
    additional work (not a one-line style nit), run the triage procedure and
    present its recommendation — not just the bare suggestion — at approval
    time.
  - **Phase 4 step 4** (the orchestrator's own post-cleanup follow-up
    observation): run the same triage procedure before raising the one-shot
    escalation, replacing today's bare `question=`/`options=` call (and the
    "no kind fits this case" reasoning it was built on) with a triage-informed
    one.
  - Both call sites raise the same escalation shape: `context=` carries the
    triage script's output, `options=fold-in,standalone,discard`.
- **Fold-in must actually happen.** When the human picks `fold-in` at either
  call site, the orchestrator does not merely record the decision: it revises
  the current run's planning artifacts to cover the added scope (extends
  `ticket.md`'s acceptance criteria along with `proposal.md`/`design.md`/
  `tasks.md`, re-validates with `openspec validate`) and re-runs the
  design-soundness skeptic gate on the revised plan before
  Execution proceeds (Phase 3 call site) or before Phase 4 cleanup runs
  (Phase 4 call site, which reopens Execution for the added scope instead of
  proceeding to cleanup). This is the direct fix for CON-30's failure mode.
- `standalone` files a new Linear ticket capturing the suggestion (so the
  decision has a concrete artifact, not just a recorded escalation answer);
  `discard` requires no further action.
- Modify `openspec/specs/orchestrator-turn-discipline/spec.md`'s "Any
  post-cleanup suggestion is raised through escalation" requirement: it
  currently justifies the generic `question=`/`options=` shape by asserting
  no `gather-escalation-context.sh` kind fits — that's superseded by the new
  triage procedure, which does supply structured context (just via a
  different, purpose-built script rather than another
  `gather-escalation-context.sh` kind).
- `core/roles/evaluator.md` / `core/roles/skeptic.md` are unchanged in
  behavior: they still only write suggestions into their reports. The triage
  logic lives entirely in the orchestrator, which is the one place all three
  surfacing points already converge.

## Capabilities

### New Capabilities
- `followup-triage`: the `triage-followup.sh` classification script, the
  orchestrator's shared "Triaging a suggested follow-up" sub-procedure, its
  two call sites (Phase 3 delivery-time suggestions, Phase 4 post-cleanup
  observation), the `fold-in` re-planning requirement, and the `standalone`
  ticket-filing behavior.

### Modified Capabilities
- `orchestrator-turn-discipline`: the post-cleanup-suggestion requirement's
  escalation shape changes from a bare `question=`/`options=` call to a
  triage-informed one; the "no kind fits" justification is removed/updated
  accordingly. No other requirement in this capability changes.

## Impact

- `core/scripts/triage-followup.sh` (new), synced to `scripts/concertino/triage-followup.sh`.
- `core/roles/orchestrator.md` (new sub-procedure + two call-site edits),
  synced to `.claude/agents/concertino-orchestrator.md`.
- `openspec/specs/followup-triage/spec.md` (new, via this change's spec delta).
- `openspec/specs/orchestrator-turn-discipline/spec.md` (modified via this
  change's spec delta).
- `test/scripts/triage-followup.test.sh` (new), added to `package.json`'s
  `test` script.
- No change to `core/roles/evaluator.md` / `core/roles/skeptic.md` behavior,
  `gather-escalation-context.sh`, or `emit-event.sh`.
