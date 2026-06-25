# Workflow State — <TICKET_ID>

# Written by the orchestrator on every phase transition so a compacted or resumed
# session can recover. Holds ONLY ids/paths/counters — never prose procedure.

TICKET_ID: <id>
CHANGE_NAME: <name>
WORKTREE_PATH: <abs path>
BRANCH: <branch>
PHASE: Setup | Planning | Execution | Evaluation | Delivery | Cleanup
CYCLE: <n>
DEV_PORT: <port>
BACKEND_PORT: <port>
EXECUTOR_AGENT_ID: <id-or-name>
EVALUATOR_AGENT_ID: <id-or-name>
LAST_EVAL_VERDICT: PASS | FAIL | BLOCKER | —
LAST_EVAL_REPORT: <path or —>
SKEPTIC_CYCLE: <n>
LAST_SKEPTIC_VERDICT: CONFIRM | REFUTE | BLOCKER | —
