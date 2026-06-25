# concertino-deliver — sequential ticket delivery (Codex)

Run the Concertino ticket-delivery workflow for the ticket id in the request.

You have no warm sub-agents here. Run the loop **sequentially in a single thread**,
playing each role from `AGENTS.md` in turn:

1. **Orchestrator** — fetch the ticket, run `scripts/concertino/setup-worktree.sh`,
   then `assert-phase.sh setup`. Plan the change. Persist `workflow-state.md`.
2. **Skeptic (design gate)** — re-read the plan from scratch; CONFIRM or list required revisions.
3. **Executor** — implement; run the verification gates; commit.
4. **Evaluator** — re-run the gates yourself; three-phase review; PASS or change requests.
5. **Skeptic (final gate)** — re-establish ground truth, trace each AC, run the app,
   judge the UI; CONFIRM or change requests (bounded loop back to Executor).
6. **Orchestrator** — squash, archive, push, open PR, comment on the ticket.

Respect the circuit-breaker budgets in the Orchestrator spec; when a budget is
exhausted, stop and ask the human. Persist `workflow-state.md` after every phase so
a fresh session can resume.
