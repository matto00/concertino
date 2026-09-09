# Workflow State — CON-171

TICKET_ID: CON-171
CHANGE_NAME: guard-phase4-teardown
PHASE: Evaluation
CYCLE: 2
SKEPTIC_CYCLE: 1
SKEPTIC_DESIGN_ROUNDS_USED: 4 (budget 3, extended once by recorded decision)
BRANCH: bug/phase4-teardown-races-auditor/con-171
WORKTREE_PATH: /home/matt/Development/concertino/.concertino/worktrees/bug/phase4-teardown-races-auditor/con-171
DEV_PORT: 5418
BACKEND_PORT: 8325
AGENT_MERGE: true
TICKET_TYPE: feature
DESIGN_QUESTIONS: null
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 3
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
MODELS: {"orchestrator":"opus","executor":"sonnet","evaluator":"opus","skeptic":"opus","auditor":"sonnet"}
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
HARNESS: claude-code
PENDING_ESCALATION: null

## Notes
- Premise validated: CON-163 incident confirmed, but ticket's "verdict=MERGE with no ref" claim CORRECTED — zero auditor-role events exist in that run's log.
- Design decision: adopt directions 1+3 (prompt precision + cleanup.sh live-holder guard); REJECT direction 2 (persist-before-merge) — it would durably persist Verdict: MERGE before gh pr merge can fail to BLOCKER.
- CON-173 constraint: never run `concertino sync`; render scripts/concertino/ by direct cp.
