# Workflow State — <TICKET_ID>

# Written by the orchestrator on every phase transition so a compacted or resumed
# session can recover. Holds ONLY ids/paths/counters — never prose procedure,
# except CONSTRAINTS, a bounded exception carrying short standing-constraint
# text (see the methodology-carryover spec) — every other field keeps the
# original invariant.

TICKET_ID: <id>
CHANGE_NAME: <name>
WORKTREE_PATH: <abs path>
BRANCH: <branch>
# CON-152: the review diff base, resolved ONCE at Setup via
# resolve-review-base.sh (merge-base of HEAD against a freshly-fetched
# origin/<baseBranch>) and never recomputed. Every review-bearing role
# (executor's gate-selection diff, evaluator, skeptic, auditor) reads THIS
# value instead of hand-computing its own `<base>...HEAD` — a bare local
# base-branch ref never moves for the life of the worktree, while the
# remote base branch keeps advancing as sibling tickets merge mid-run, so a
# role that recomputes its own base silently reviews a diff padded with
# unrelated work (or, worse, a base that differs role-to-role, which is its
# own failure mode). See resolve-review-base.sh's header for the incident.
REVIEW_BASE_SHA: <sha>
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
# design-ticket-type (CON-100). Resolved once at Setup, alongside AGENT_MERGE:
# label `type:design` (exact match) wins; else title prefix `[DESIGN] `; else
# `feature`. Never recomputed later in the run.
TICKET_TYPE: design | feature
# design-ticket-type (CON-100). One entry per open question a design ticket's
# Planning raised: its answer, the "Triaging a suggested follow-up" verdict
# (fold-in|standalone|discard), and, once actioned, a reference to the result
# (a merged PR link for fold-in, a new ticket id for standalone, or null for
# discard/unactioned) — so a resumed/compacted session recovers exactly which
# questions were raised, answered, and triaged. null for TICKET_TYPE: feature.
DESIGN_QUESTIONS: [{"question":"...","answer":"...","verdict":"fold-in|standalone|discard","action_ref":"..."}] | null
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
# escalation-bubble-up (CON-76). Set only while a --raise-only escalation is
# outstanding and this orchestrator has returned control to its parent,
# waiting to be SendMessage-resumed with the resolution. null otherwise.
PENDING_ESCALATION: {"question":"...","options":"...","context_ref":"...","raised_at":<ms>,"kind":"planning|blocker|budget|followup|final-gate"} | null
# --- methodology-carryover (CON-161). CONSTRAINTS: standing methodology
# constraints agreed at Planning or a design-gate/final-gate skeptic verdict,
# binding for the rest of the run, mirrored as `- [C<n>] <text>` bullets under
# tasks.md's `## Standing Constraints` section. Never deleted — a superseded
# or expired constraint is marked retired: true instead, and resuming roles
# skip retired entries. Absent from an existing file reads as [] (never a
# parse failure).
CONSTRAINTS: [{"id":"C<n>","text":"...","agreed_at":"planning|design-gate|final-gate","retired":false}] | []
# CONSTRAINT_REVIEWS: one entry per skeptic verdict at the design/final gate
# (every round, CONFIRM and REFUTE alike) plus one entry per Planning
# ESCALATION resolution that promotes a constraint (gate: "planning",
# verdict: "n/a", excluded from SKEPTIC_VERDICTS_TOTAL). `promoted` lists any
# CONSTRAINTS ids newly written as a result of that verdict/resolution
# (empty if none). Absent from an existing file reads as [] (never a parse
# failure).
CONSTRAINT_REVIEWS: [{"verdict_seq":<n>,"gate":"design|final|planning","round":<n>,"verdict":"CONFIRM|REFUTE|n/a","promoted":["C<n>",...]}] | []
# SKEPTIC_VERDICTS_TOTAL: incremented immediately after every skeptic spawn
# returns (design gate or final gate), independent of promotion — a count of
# skeptic spawns only, never incremented for a planning-gate review entry.
# Absent from an existing file reads as 0 (never a parse failure).
SKEPTIC_VERDICTS_TOTAL: <n> | 0
