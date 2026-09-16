# Workflow State — CON-195

TICKET_ID: CON-195
CHANGE_NAME: bind-canonical-docs-all-roles
WORKTREE_PATH: /home/matt/Development/concertino/.concertino/worktrees/bug/canonical-docs-role-binding/CON-195
BRANCH: bug/canonical-docs-role-binding/CON-195
REVIEW_BASE_BRANCH: main
REVIEW_BASE_REMOTE: origin
PHASE: Delivery
CYCLE: 1
DEV_PORT: 5442
BACKEND_PORT: 8349
EXECUTOR_AGENT_ID: —
EVALUATOR_AGENT_ID: —
LAST_EVAL_VERDICT: PASS
LAST_EVAL_REPORT: openspec/changes/bind-canonical-docs-all-roles/evaluation-1.md
SKEPTIC_CYCLE: 1
LAST_SKEPTIC_VERDICT: CONFIRM
# Driver override for this run: the repo config sets agentMerge.enabled=true,
# but the driver requires a manual --squash merge with his own CI polling and
# a gate-chain audit before merging, which is incompatible with the auditor
# auto-merging. Resolved once here, never recomputed.
AGENT_MERGE: false
TICKET_TYPE: feature
DESIGN_QUESTIONS: null
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 3
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
MODELS: {"orchestrator":"sonnet","executor":"sonnet","evaluator":"sonnet","skeptic":"sonnet","auditor":"sonnet"}
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
PENDING_ESCALATION: null
CONSTRAINTS: []
CONSTRAINT_REVIEWS: [{"verdict_seq":1,"gate":"design","round":1,"verdict":"CONFIRM","promoted":[]},{"verdict_seq":2,"gate":"final","round":1,"verdict":"CONFIRM","promoted":[]}]
SKEPTIC_VERDICTS_TOTAL: 2
HEAD_SHA: c3fafbcad16cd8b5fd7f02b7fb603ff65b3d9ee2
