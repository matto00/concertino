# Workflow State — CON-192

TICKET_ID: CON-192
CHANGE_NAME: followup-survival-report
# Added scope (owner ruling): capability `verification-vacuity-analysis`; evidence ledger at class-evidence.md
WORKTREE_PATH: /home/matt/Development/concertino/.concertino/worktrees/feature/followup-survival-report/CON-192
BRANCH: feature/followup-survival-report/CON-192
REVIEW_BASE_BRANCH: main
REVIEW_BASE_REMOTE: origin
PHASE: Evaluation  # cycle 3 committed as e01b46e (7.1 REFUTE fix + verification-vacuity artifact)
CYCLE: 3
DEV_PORT: 5439
BACKEND_PORT: 8346
EXECUTOR_AGENT_ID: executor (a2b93ac) — warm-resumed for cycle 2
EVALUATOR_AGENT_ID: evaluator-cycle3 (a3b2f18); cycle1 was ad098a6
LAST_EVAL_VERDICT: PASS  # cycle 3 (evaluation-2.md) at e01b46e; cycle 1 PASS was at a0d66d2
LAST_EVAL_REPORT: openspec/changes/followup-survival-report/evaluation-2.md
SKEPTIC_CYCLE: 4  # design-gate round 4 (extended budget) over the added scope; final-gate rounds used 2/3
LAST_SKEPTIC_VERDICT: REFUTE  # FINAL gate round 3 at e01b46e; final-gate budget now 3/3 exhausted
AGENT_MERGE: false
TICKET_TYPE: feature
DESIGN_QUESTIONS: null
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 4  # 4/4 USED. Round 4 REFUTE; owner ruled proceed-on-reviewer-preapproved-fix (escalation #3, recorded via CLI) — NO 5th round. Fix applied, proceeding to execution.
SKEPTIC_FINAL_ROUNDS: 3  # 3/3 USED (REFUTE, REFUTE, REFUTE). Escalating rather than proceeding on an exhausted gate.
DEBUG_ATTEMPTS: 2
MODELS: {"orchestrator":"sonnet","executor":"sonnet","evaluator":"sonnet","skeptic":"sonnet","auditor":"sonnet"}
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
PENDING_ESCALATION: [{"question":"CON-192 scope amended after the design gate closed; design-round budget exhausted (3/3). How should the added verification-machinery class be handled?","options":"deliver-survival-spin-out-class,fold-in-with-extended-design-budget,deliver-class-defer-survival,halt","escalation_id":"CON-192-1789618231466-63f9e9","raised_at":1789618231491,"kind":"planning","recommendation":"deliver-survival-spin-out-class","OWNER_RULING":"fold-in-with-extended-design-budget","ruling_recorded_in_events":false,"why_not":"concertino answer has no escalation-id targeting and answer.json is write-once per ticket (flag wx); demonstrated rc=2 EEXIST. No event hand-composed. Coordinator filed the CLI limitation as its own ticket. THIS FIELD IS THE DURABLE RECORD.","status":"ANSWERED (against my recommendation); a 4th design round was granted and used"},{"question":"Final-gate budget exhausted (2/2, both REFUTE); round 2 found a second C5-class false claim in the empty-provenance branch. How to proceed?","options":"proceed-to-delivery,extend-final-gate,halt","escalation_id":"CON-192-1789622109821-389cd1","raised_at":1789622109848,"kind":"budget","recommendation":"extend-final-gate","OWNER_RULING":"extend-final-gate","ruling_recorded_in_events":false,"why_not":"an escalation.answered WAS written for this id earlier, but the subsequent --raise-only for escalation #3 discarded the stale answer.json; the event row remains in the log while answer.json no longer reflects it. THIS FIELD IS THE DURABLE RECORD.","status":"ANSWERED (with my recommendation); final-gate rounds now 2/3 used"}]
CONSTRAINTS: [{"id":"C1","text":"A text-matching probe over ticket/description prose must carry a POSITIVE control proving the needle matches the real-world markdown rendering (e.g. a backticked `origin_kind`: key) before any zero-hit result is reported as evidence. A negative control alone is insufficient — this change's own Planning shipped a false-negative zero on exactly that omission.","agreed_at":"design-gate","retired":false},{"id":"C2","text":"Never read ticket descriptions or state via fetchOneTicket/ISSUE_QUERY — it selects only id/identifier/labels and returns an empty description. Description- and state-bearing reads go through fetchTickets with explicit stateTypes.","agreed_at":"design-gate","retired":false},{"id":"C3","text":"Never render a survival percentage over a denominator below the stated minimum (default 5); print the counts and a small-sample marker instead. Applies per segment and per period, not only to the overall figure.","agreed_at":"design-gate","retired":false},{"id":"C4","text":"The recovered tier means strictly what the provenance tier missed: dedupe by ticket id and disclose the excluded count. The filing convention writes provenance markers into every filed ticket description unconditionally, so the tiers overlap unless explicitly made disjoint.","agreed_at":"design-gate","retired":false},{"id":"C5","text":"An explanatory annotation must be guarded on the VALUE actually observed, never on a condition that merely correlates with it. Rendering a cause ('the template hardcodes X') above data showing not-X is a false claim, not an imprecision — the report must name the observed value instead.","agreed_at":"final-gate","retired":false},{"id":"C6","text":"Name a failure shape for its MECHANISM, never for an incidental trigger observed in one demonstration. A mischaracterised shape is as much a defect as an overstated rule.","agreed_at":"design-gate","retired":false},{"id":"C7","text":"When a count changes, audit EVERY reference to it — body prose as well as headings, and in every artifact that restates it. Checking only headings is a narrower subject than the claim being licensed.","agreed_at":"final-gate","retired":false}]
CONSTRAINT_REVIEWS: [{"verdict_seq":1,"gate":"design","round":1,"verdict":"REFUTE","promoted":["C1","C2","C3"]},{"verdict_seq":2,"gate":"design","round":2,"verdict":"REFUTE","promoted":["C4"]},{"verdict_seq":3,"gate":"design","round":3,"verdict":"CONFIRM","promoted":[]},{"verdict_seq":4,"gate":"final","round":1,"verdict":"REFUTE","promoted":["C5"]},{"verdict_seq":5,"gate":"final","round":2,"verdict":"REFUTE","promoted":[]},{"verdict_seq":6,"gate":"design","round":4,"verdict":"REFUTE","promoted":["C6"],"note":"verdict event duplicated by an emit-event.sh exit-status/append mismatch; one review"},{"verdict_seq":7,"gate":"final","round":3,"verdict":"REFUTE","promoted":["C7"],"note":"R3 sentence asserted a stale section-E count (nine) against eleven items; orchestrator-origin drift never audited beyond headings"}]
# NOTE: 7 REVIEWS (4 design + 3 final). Verdict EVENTS in events.jsonl = 10,
# of which 9 are distinct on (gate, verdict, head_sha, ref): the round-4 design
# verdict was appended TWICE because emit-event.sh reported a non-zero exit while
# having succeeded, so the caller retried. Any per-verdict metric must de-duplicate
# on (gate, round, ref) rather than counting rows. See ledger instance 14 / S6.
SKEPTIC_VERDICTS_TOTAL: 7
