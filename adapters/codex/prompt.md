# concertino-deliver — sequential ticket delivery (Codex)

Run the Concertino ticket-delivery workflow for the ticket id in the request.
The request may also carry a trailing `fast` or `slow` speed token (e.g.
"CON-17 fast") — extract it the same way you'd extract the ticket id; absent
means `default`. Pass it as `setup-worktree.sh`'s third argument in step 1
below — this resolves the run's budgets (execution cycles, skeptic rounds,
debug attempts) at runtime exactly like Claude Code does, read from
`workflow-state.md` throughout. **The model each role runs on is fixed at the
last `concertino sync`, not re-resolved per invocation** — Codex's
orchestration is sequential in a single thread with no per-spawn model
override the way Claude Code's `Agent` tool has, so `models.codex.<role>` /
`modelTiers.codex.<tier>` only affect what `concertino sync` already baked
into `.codex/agents/concertino-<role>.toml` at the `default` speed. A
`fast`/`slow` run here still gets its rigour tuned (budgets/round-counts),
just not a different model per role — a stated, documented limit of this
feature on Codex, not a silent gap.

You have no warm sub-agents here. Run the loop **sequentially in a single thread**,
playing each role from `AGENTS.md` in turn:

1. **Orchestrator** — fetch the ticket, run `scripts/concertino/setup-worktree.sh`
   with the extracted speed (or omit for `default`) as its third argument,
   then `assert-phase.sh setup`. Parse the extended `READY` output
   (`speed=`/`budgets=`/`models=`/`second_final_gate_skeptic=`/
   `evaluator_clean_worktree=`) into `workflow-state.md` alongside the
   existing `worktree=`/`branch=`/`dev_port=`/`backend_port=` fields — this
   one call already resolved the run's speed; never call
   `resolve-speed.sh` again yourself. Plan the change. Persist
   `workflow-state.md`.
2. **Skeptic (design gate)** — re-read the plan from scratch; CONFIRM or list required revisions.
3. **Executor** — implement; run the verification gates; commit.
4. **Evaluator** — re-run the gates yourself; three-phase review; PASS or change requests.
5. **Skeptic (final gate)** — re-establish ground truth, trace each AC, run the app,
   judge the UI; CONFIRM or change requests (bounded loop back to Executor).
6. **Orchestrator** — squash, archive, push, open PR, comment on the ticket.
7. **Auditor** — when agent-merge is enabled for this run, verify the four merge
   conditions (`check-merge-readiness.sh` plus a cold AC trace) and merge, or
   escalate with the reason. This stage runs strictly after step 6, never before —
   it operates on the PR step 6 just created. On `ESCALATE`/`BLOCKER`, there is no
   "wait in chat" concept the way Claude Code's slash-command layer has: this
   single thread stops here, states the reason, and hands off to whoever is
   watching the session, rather than attempting Phase 4 on an unmerged PR. When
   agent-merge is disabled, skip this stage entirely — Phase 4 proceeds only
   after a human confirms the merge, exactly as before.

Respect the circuit-breaker budgets in the Orchestrator spec; when a budget is
exhausted, stop and ask the human. Persist `workflow-state.md` after every phase so
a fresh session can resume.
