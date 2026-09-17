# Workflow State — CON-190

# Lane delivers CON-190 AND CON-191 as one change (both add new event kinds to
# the same emitter). CON-190 is the run ticket because concertino keys one run
# directory per ticket; CON-191 shares the branch, PR and commit.

TICKET_ID: CON-190
SECONDARY_TICKET_ID: CON-191
CHANGE_NAME: ticket-filed-and-schema-change-events
WORKTREE_PATH: /home/matt/Development/concertino/.concertino/worktrees/feature/ticket-filed-and-schema-change-events/con-190
BRANCH: feature/ticket-filed-and-schema-change-events/con-190
REVIEW_BASE_BRANCH: main
REVIEW_BASE_REMOTE: origin
PHASE: Delivery
CYCLE: 2
DEV_PORT: 5437
BACKEND_PORT: 8344
EXECUTOR_AGENT_ID: cycle1-executor (warm-resumable)
EVALUATOR_AGENT_ID: —
LAST_EVAL_VERDICT: PASS
LAST_EVAL_REPORT: /home/matt/Development/concertino/.concertino/worktrees/feature/ticket-filed-and-schema-change-events/con-190/openspec/changes/ticket-filed-and-schema-change-events/evaluation-1.md
SKEPTIC_CYCLE: 2
LAST_SKEPTIC_VERDICT: CONFIRM
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
CONSTRAINTS: [{"id":"C1","text":"Never rewrite, reorder, or backfill any existing events.jsonl; new validation governs only new emissions, and the ~2,300-event corpus must still fold (CON-192 consumes it next).","agreed_at":"planning","retired":false},{"id":"C2","text":"Every core/scripts/ change must be mirrored into scripts/concertino/ byte-identically in the same commit, never hand-authored independently; concertino sync must NOT be run in this lane.","agreed_at":"planning","retired":false},{"id":"C3","text":"Every new refusal must sit below the CON-171 auditor-lease release in emit-event.sh, never in the argument-parsing loop, so a refused invocation never strands a Phase-4 teardown lease.","agreed_at":"planning","retired":false},{"id":"C4","text":"Every new validation must be proven failable by mutation: non-zero exit AND no event appended, plus evidence the pre-change script accepted the same input.","agreed_at":"planning","retired":false},{"id":"C5","text":"Any enumeration or hashing of rendered scripts MUST be recursive over scripts/concertino/**/*.sh, including the nested lib/ directory that emit-event.sh actually sources; and any drift test MUST mutate a NESTED fixture, because a top-level-only test certifies the wrong case and passes while the detection gap is live.","agreed_at":"final-gate","retired":false}]
CONSTRAINT_REVIEWS: [{"gate":"planning","round":1,"verdict":"n/a","promoted":["C1","C2","C3","C4"]},{"verdict_seq":1,"gate":"design","round":1,"verdict":"CONFIRM","promoted":[]},{"verdict_seq":2,"gate":"final","round":1,"verdict":"REFUTE","promoted":["C5"]},{"verdict_seq":3,"gate":"final","round":2,"verdict":"CONFIRM","promoted":[]}]
SKEPTIC_VERDICTS_TOTAL: 3
