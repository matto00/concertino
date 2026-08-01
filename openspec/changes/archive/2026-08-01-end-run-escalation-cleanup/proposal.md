## Why

CON-15 made sure the orchestrator never ends its turn *too early*, with a
sub-agent outstanding. CON-48 is the mirror-image failure: the orchestrator
doesn't end its turn *at all* once its actual work is genuinely done, if it
has something left to say. CON-16's orchestrator emitted `run.end`
(status=delivered), passed its `phase:cleanup` gate, and had the worktree
removed, PR merged, and Linear marked Done — fully correct telemetry, so the
dashboard confidently rendered the run as `done`. But the orchestrator then
asked a genuine follow-up question in plain chat, with zero telemetry, and
the tmux window/process sat alive over an hour later with nothing to reap
(CON-34's reap logic correctly refuses to reap a live window, so a session
stuck in this bug persists forever, indistinguishable from one legitimately
still finishing Phase 4).

## What Changes

- Define precisely when Phase 4 is "genuinely complete" for the orchestrator
  role: `cleanup.sh --phase4` has run (worktree removed, `run.end` emitted),
  the ticket has been set to Done with a closing comment posted, and the
  hygiene check has been reported. Only once all three hold does the
  "must not linger" rule below apply — this is deliberately scoped so it
  cannot be read as license to stop early during Planning/Execution/
  Evaluation/Delivery, which is exactly the hazard CON-15 already closed off
  from the other direction.
- Require that once Phase 4 is genuinely complete, any further suggestion,
  observation, or question the orchestrator has for the human (e.g. "should
  I file a follow-up ticket for X?") MUST be raised through the existing
  escalation mechanism (`emit-event.sh escalation --await`) rather than as a
  bare chat question — giving it an `escalation.raised` event (dashboard
  `NEEDS YOU` visibility instead of a falsely-idle `DONE` row), the existing
  structured answer flow, and a bounded wait.
- Require that once that one-shot follow-up escalation resolves (answered,
  timed out, or skipped because there was nothing to raise), the
  orchestrator emits a single terminal summary message and then genuinely
  ends its turn — no further tool calls, no further open-ended questions, no
  continued conversation.
- Extend the `orchestrator-turn-discipline` capability (CON-15's spec) with
  this mirror-image half of the turn-boundary contract, and cross-reference
  it from `docs/harness-capabilities.md` the same way CON-15's finding is
  recorded there today, so the fact is discoverable independent of the role
  file.

## Capabilities

### New Capabilities
- `post-completion-escalation-visibility`: a live escalation raised after a
  run's `run.end` has already fired (e.g. the orchestrator's one-shot
  post-cleanup follow-up) SHALL render as `NEEDS YOU`, not a stale `DONE`
  row, for as long as the run's window is still alive to receive an answer.

### Modified Capabilities
- `orchestrator-turn-discipline`: adds the "never linger past genuine
  completion" half of the turn-boundary contract (mirror image of the
  existing "never end early" requirements), plus the requirement that any
  post-cleanup suggestion route through escalation instead of bare chat.

## Impact

- `core/roles/orchestrator.md` — Phase 4 gets a precise "genuinely complete"
  definition and a new terminal step describing the one-shot escalation +
  end-of-turn requirement; the Guardrails section gets a short cross-reference.
- `docs/harness-capabilities.md` — records the never-linger constraint as a
  harness-behavior fact, alongside CON-15's never-end-early fact.
- `lib/ui/reducer.js` — `deriveStatus`/`escalationStale` are corrected so a
  live escalation raised after `run.end` (window still alive) renders as
  `NEEDS YOU`, not a falsely-stale `DONE` row. Without this, the prose change
  above would emit an `escalation.raised` event the dashboard silently
  discards as stale. `test/reducer.test.js` gets new coverage for this case.
- No changes to `scripts/concertino/*.sh` or the existing `emit-event.sh
  escalation --await` mechanism — it already supports an arbitrary one-off
  question and needs no new flag or event kind.
