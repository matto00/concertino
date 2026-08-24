## Why

Planning currently takes a ticket's description as given. Nothing checks whether the ticket is still true against the live tree before the orchestrator derives a branch and builds a worktree around it. Six real 2026-08-22/23 instances (CON-128, CON-131, CON-127, HEL-805, HEL-633/634, HEL-637) show the failure mode: a stale premise does not fail loudly — the agent builds correct, well-tested machinery for a problem that no longer exists, and every downstream gate passes because gates check the work against the ticket, not the ticket against reality. Every instance was caught only by a human re-deriving scope by hand.

## What Changes

- Add a new Setup step — **before branch derivation and worktree creation** — that validates the ticket's premise against the current tree: verifies cited facts (files/paths/symbols/counts, or a bug ticket's stated root cause), checks for acceptance criteria already satisfied on the base branch, and checks for collisions with recently-merged sibling tickets.
- The step's *prompt* is mechanically mandatory: the orchestrator must write a `premise-validation.md` evidence artifact, in a fixed required shape, before it may derive a branch name. `assert-phase.sh setup` is extended to fail closed when that artifact is absent or its required sections are unanswered — the same "prompt mandatory, answer judgment" split CON-132 established for the gate-chain implications checklist, applied here because the *answer* (is this ticket still true?) cannot be mechanically decided the way a diff-touches-`.husky/**` check can.
- A recorded verdict of `material-drift` requires an actually-raised `ticket-drift` escalation (checked against the run's own event log) before `assert-phase.sh setup` will pass — closing the same "recorded intent, no durable action" gap CON-30/CON-132 already closed elsewhere, at the Setup gate this time.
- Add `ticket-drift` as a seventh kind to `gather-escalation-context.sh`, alongside its existing six, so a material-drift escalation carries structured claimed-vs-actual context exactly like the other six kinds.
- Minor staleness (a moved path, an off-by-one count) is re-derived and reported inline in the artifact, not escalated — keeping the common, no-drift case cheap: one read/verification pass and a short evidence write, no new sub-agent spawn, no new loop.
- Explicitly document `core/laws/ticket-drafting-escalation.md`'s boundary against this new step: that law is about ambiguity present at drafting time; this step is about a well-drafted ticket that has since become untrue. Neither is weakened by the other.

## Capabilities

### New Capabilities
- `premise-validation`: a mandatory Setup-phase step, mechanically enforced by `assert-phase.sh`, that checks a ticket's stated premise (facts, root cause, acceptance criteria, sibling collisions) against the live tree before Planning proceeds, and defines when drift must escalate vs. be silently re-derived.

### Modified Capabilities
- `escalation-context`: adds `ticket-drift` as a seventh valid kind to `gather-escalation-context.sh`, with its own required fields (claimed, actual, options).

## Impact

- `core/roles/orchestrator.md` — new Setup step, before branch derivation (step 2) and worktree creation (step 3).
- `core/scripts/assert-phase.sh` — `setup)` case gains fail-closed evidence checks for `premise-validation.md` and (for `material-drift`) a corresponding raised escalation.
- `core/scripts/gather-escalation-context.sh` — new `ticket-drift` kind.
- `core/laws/ticket-drafting-escalation.md` — a short cross-reference note only (no weakening), distinguishing drafting-time ambiguity from post-drafting decay.
- Rendered outputs: `.claude/agents/concertino-orchestrator.md`, `scripts/concertino/assert-phase.sh`, `scripts/concertino/gather-escalation-context.sh` (via `concertino sync`), plus Codex/OpenCode renders.
