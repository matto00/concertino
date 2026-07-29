# CON-24: Agent-merge — let a verified run merge its own PR

## Description

Phase 4 currently stops dead until a human confirms the merge. That is right for a change you want to read, and pure toil for one you do not — a dependency bump, a one-line script fix, a docs correction. The run has already passed a cold design gate, an evaluation loop and a cold final gate; the human is then asked to be a fourth checkpoint on work three checkers already approved.

Add **agent-merge**: a fifth agent whose sole job is to verify a delivery actually completed and then merge it.

Name it `agent-merge`, not `auto-merge`. GitHub's auto-merge fires on *branch protection* and knows nothing about whether the delivery workflow completed — it would happily merge a run whose skeptic never confirmed. Different mechanism, different guarantee, and conflating them would be a real hazard.

### A fifth role in the ensemble

This is not a check bolted onto the orchestrator. It is a new member of the group, shipped with the other four, whose only task is verifying the delivery steps and the result.

The reason is structural. An orchestrator asserting "my run finished correctly" is exactly the blind spot the skeptic exists to cover — and this project has three cases where a run's own fix reintroduced the bug it was fixing, each caught only by a cold reviewer. The thing that approves a merge must never be the thing that produced the work.

**Naming matters here.** "Verifier" collides with the evaluator, which already reviews code mid-loop. Suggested: **auditor** — it audits a finished delivery against its ticket and its evidence, rather than reviewing code in progress. Whatever it is called, the distinction from evaluator and skeptic should be obvious from the name alone.

Its posture: **cold**, like the skeptic. It sees the ticket, the diff, the CI status and the event log — never the run's narrative.

What shipping a fifth role actually involves:

* `core/roles/<name>.md` — the neutral role spec.
* `adapters/claude-code/agents.json` — a fifth agent definition with its own tool grants.
* `adapters/codex/` — the sequential flow gains a fifth stage, and the optional worker template a fifth entry.
* `docs/harness-capabilities.md` — the capability matrix currently describes a four-agent topology.
* `bin/concertino` — rendering, plus `models.<name>` in the config schema.

### The evidence a merge requires

The project's premise is replacing *"human confirms Y"* with *"an evidence artifact plus a cold checker that verifies Y against ground truth."* Merging is the last step where that has not been done:

* **CI is green** — every required check passed, not merely "not failing". A pending check is not a pass.
* **The PR is mergeable** — no conflicts against the current base, checked at merge time rather than at PR creation.
* **The run's own gates passed** — evaluator PASS and final skeptic CONFIRM, read from the event log rather than from anyone's memory.
* **The diff satisfies the ticket's acceptance criteria** — judged cold.

Any one failing escalates rather than merging.

### Toggling

A **config setting**, on or off, with a **per-run override**. Set it once for a project that always wants it (or never does), and override for the run where you want different behaviour. Not per-run-only, which would mean setting it every time.

* `concertino.config.json` holds the default.
* `/concertino-deliver CON-17 --agent-merge` / `--no-agent-merge` overrides for one run.
* The `n` prompt and the launch plan expose the same override, and the launch plan shows which way it resolved before launching — same discipline as showing ports pre-flight.

This also pairs with CON-22's delivery speeds: a `fast` hotfix is the shape that wants agent-merge, a `slow` contract change is not. Worth deciding whether a speed carries a default, with the explicit override still winning.

## Acceptance Criteria

* A fifth role ships with the group, cold by construction, rendered into both harnesses.
* Its verdict is recorded as evidence via `persist-evidence.sh`, so the drill-down shows what approved the merge.
* All four evidence conditions are required; any failure escalates with the reason rather than merging.
* Config default plus per-run override, exposed at invocation, in the `n` prompt, and in the launch plan.
* Merge and the subsequent Phase 4 cleanup emit events, so a self-merged run is auditable after the fact.
* A failed merge attempt leaves the PR open and the worktree intact — never a half-merged state.
* Branch protection requiring human review is detected and escalated cleanly, not retried.

## Notes

**Merging changes the base for every other in-flight run.** A self-merging run makes every other open PR's base stale — the situation that produced a real conflict here when CON-7 merged while CON-8 was mid-flight. Agent-merge makes that more frequent and less observed, so it should land alongside CON-25 rather than before it.

Related issues: CON-22 (delivery speeds), CON-7, CON-8, CON-25 (local main goes stale after a merge).
