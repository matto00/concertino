# Workflow State — <TICKET_ID>

# Written by the orchestrator on every phase transition so a compacted or resumed
# session can recover. Holds ONLY ids/paths/counters — never prose procedure.

TICKET_ID: <id>
CHANGE_NAME: <name>
WORKTREE_PATH: <abs path>
BRANCH: <branch>
PHASE: Setup | Planning | Execution | Evaluation | Delivery | Cleanup
# Enforced by PHASE_ORDER in lib/ui/reducer.js — keep both lists in sync.
CYCLE: <n>
DEV_PORT: <port>
BACKEND_PORT: <port>
EXECUTOR_AGENT_ID: <id-or-name>
EVALUATOR_AGENT_ID: <id-or-name>
LAST_EVAL_VERDICT: PASS | FAIL | BLOCKER | —
LAST_EVAL_REPORT: <path or —>
SKEPTIC_CYCLE: <n>
LAST_SKEPTIC_VERDICT: CONFIRM | REFUTE | BLOCKER | —
# Resolved once at Setup (per-run override wins over agentMerge.enabled config
# default) and never recomputed — survives compaction/resume like every other
# run-level decision here.
AGENT_MERGE: true | false
# --- delivery-speed-presets (CON-22) — resolved once at Setup from
# setup-worktree.sh's extended READY contract (speed=/budgets=/models=/
# second_final_gate_skeptic=/evaluator_clean_worktree=), never recomputed —
# every role reads the bound it needs from here instead of a sync-time-baked
# {{var:budgets.X}} constant, since a speed's numbers vary per invocation.
SPEED: fast | default | slow
EXECUTION_CYCLES: <n>
SKEPTIC_DESIGN_ROUNDS: <n>
SKEPTIC_FINAL_ROUNDS: <n>
DEBUG_ATTEMPTS: <n>
# Per-role resolved model (Claude Code only — see core/roles/orchestrator.md's
# per-spawn model override instruction). Codex's model is fixed at the last
# `concertino sync`, not re-resolved per invocation — this field is still
# written on Codex for audit/reference, just not read for a per-spawn override.
MODELS: {"orchestrator":"<model>","executor":"<model>","evaluator":"<model>","skeptic":"<model>","auditor":"<model>"}
# slow-only flags — false at every other speed; see core/roles/evaluator.md /
# core/roles/orchestrator.md for how each is used.
SECOND_FINAL_GATE_SKEPTIC: true | false
EVALUATOR_CLEAN_WORKTREE: true | false
