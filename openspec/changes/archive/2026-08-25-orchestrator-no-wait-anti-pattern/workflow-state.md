PHASE: Execution
TICKET_ID: CON-140
CHANGE_NAME: orchestrator-no-wait-anti-pattern
BRANCH: task/orchestrator-no-wait-anti-pattern/CON-140
WORKTREE_PATH: /home/matt/Development/concertino/.concertino/worktrees/task/orchestrator-no-wait-anti-pattern/CON-140
DEV_PORT: 5387
BACKEND_PORT: 8294
AGENT_MERGE: true
TICKET_TYPE: feature
DESIGN_QUESTIONS: null
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 3
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
MODELS: {"orchestrator":"sonnet","executor":"sonnet","evaluator":"sonnet","skeptic":"opus","auditor":"sonnet"}
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
CYCLE: 1
SKEPTIC_CYCLE: 1
NOTES: Mechanical phase-script assertion scoped out via escalation, filed as CON-141. AGENT_MERGE=true is config default (agentMerge.enabled=true); not explicitly requested/overridden by human but not overridden false either, so config default applies. Skeptic MUST be spawned with explicit model:"opus" override per human's budget instruction (frontmatter pins sonnet). Design gate hit its 3-round budget with a standing REFUTE at round 3 (skeptic-design-3.md, CR1: lib/cli/render.js's harnessResume block independently re-emits the offending sentence). Human product owner extended one round; 5 revisions applied to proposal/design/tasks/spec; round 4 skeptic CONFIRMed (skeptic-design-4.md).

POLLING DEMONSTRATION (task 4.2, orchestrator-owned, tasks.md section 4):

Instance 1 (during Planning, design-gate round 4 skeptic spawn): the Agent tool call for the round-4 skeptic returned asynchronously with a background-task notification rather than a synchronous blocking return. Instead of ending my turn to wait for that notification, I polled directly for the skeptic's expected report artifact: `for i in $(seq 1 40); do ls -la skeptic-design-4.md 2>/dev/null && break; sleep 15; done` in `openspec/changes/orchestrator-no-wait-anti-pattern/`. Observed: file `skeptic-design-4.md` appeared with sha256 `6e653d1c0d8a5f820b2703ffe88dacd1842ef7dc1ff936e70523c15f3a46c986` at wall-clock `2026-08-25T08:49:53-07:00`, containing `### Verdict: CONFIRM` — established independent of any notification. (The notification for this same spawn did in fact arrive afterward, confirming the same CONFIRM verdict — but the terminal state was established from the artifact first, by polling.)

Instance 2 (during Execution cycle 1, executor spawn — the loop task 4.1 explicitly targets): the executor's Agent tool call was also dispatched asynchronously. Rather than ending my turn to wait for its completion notification, I polled the worktree's git log directly: `BEFORE_SHA=869789f240e19379fa34b7a6e7dcfc3bc23c89af; for i in $(seq 1 80); do CUR=$(git rev-parse HEAD); if [ "$CUR" != "$BEFORE_SHA" ]; then echo "NEW COMMIT DETECTED: $CUR"; break; fi; sleep 15; done`. Observed: new commit `b5e4a13cdac792473ce670d4d12bfe5e97b6cbcb` ("CON-140 Fix the \"waiting is free\" contradiction in the orchestrator no-wait rule"), committed at `2026-08-25T08:56:42-07:00`, detected by my own polling loop by `2026-08-25T08:56:55-07:00` — established from `git log` alone, before consuming the spawn call's own return value/notification. tasks.md and the spec delta on disk were also independently re-read post-poll and found already updated to reflect the executor's completed work (tasks 1.1-2.2, 3.1-3.3, 4.3, 5.1 all checked off), corroborating the commit.

Both instances used artifact inspection (report file existence/hash, git log SHA + commit message + timestamp) as the primary signal, not the call's return value or an arriving notification — the demonstration task 4.1/4.2 requires.
