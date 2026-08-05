## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket ACs** (via `mcp__linear__get_issue CON-80`): four ACs — (1) one run dir/row for a
  lowercase-suffix branch, (2) `assert-phase.sh`/`start-servers.sh` take the ticket id explicitly
  with fallback documented, (3) CON-64-style regression test coverage, (4) an explicit decision on
  whether to migrate already-split run directories.

- **Planning artifacts read**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/gate-telemetry/spec.md`, `specs/ticket-id-path-safety/spec.md`.

- **Cross-checked every factual claim in design.md/proposal.md against the actual code**, not
  just the narrative:
  - `core/scripts/assert-phase.sh:94` — confirmed `GATE_TICKET="${WORKTREE_PATH##*/}"` is the sole
    inference site, computed once before the `case "$PHASE"` dispatch, and used at lines 158, 191,
    196 (`gate.result`/`gate.warning`). Confirmed the per-phase positional-arg counts the design's
    Decision 1 lists (`setup` 2 args, `servers` 4, `delivery` 3, `cleanup` 2-4) match the script
    exactly, so the claimed trailing-`$N` slot for each phase's new `[TICKET_ID]` argument is
    correct.
  - `core/scripts/start-servers.sh:66,76,83` — confirmed `local T="${WORKTREE_PATH##*/}"` inside
    `start_one()` is the only inference site and the only place `T` feeds `gate.result` events;
    the design's plan to add a 4th positional `TICKET_ID` and thread it into `start_one()` is
    mechanically sound against the real signature (`WORKTREE_PATH DEV_PORT BACKEND_PORT`, 3 args
    today).
  - `core/scripts/cleanup.sh:41-44,78` — confirmed the CON-64 shape design.md claims to mirror is
    real: `TICKET_ID="${4:-}"` then `T="${TICKET_ID:-${WORKTREE_PATH##*/}}"`. The proposed fix for
    the other two scripts is the identical pattern, not an invented convention.
  - `core/scripts/emit-event.sh:279-293` — confirmed the exact insertion point Decision 2/Task 3.1
    describes: `looks_like_ticket "$TICKET"` gate at line 279, `RUN_DIR="${ROOT}/.concertino/runs/${TICKET}"`
    at line 287. Canonicalizing between those lines covers every later use of `$TICKET`
    (`build_line` at 300, the `persist-evidence.sh` call at 392, the escalation-answer reader at
    582) — verified via `grep -n '\$TICKET'`, no use of the raw value occurs before line 279 or is
    missed by inserting the fix there.
  - `test/scripts/ticket-pattern.test.sh` — confirmed the shape regex
    (`^[A-Za-z#][A-Za-z0-9_-]*[0-9]$`) is carried identically in `assert-phase.sh`,
    `start-servers.sh`, `emit-event.sh`, `persist-evidence.sh`, and that this test enforces byte-
    identity across copies. Design's Decision 2 claim that `tr` only touches letters (leaving `#`,
    digits, `_`, `-` untouched) is consistent with this regex.
  - `core/roles/orchestrator.md:174,571,639` and `core/roles/evaluator.md:148-149` and
    `core/roles/skeptic.md:93-94` — confirmed the exact call sites tasks 4.1/4.2 target exist and
    currently omit the ticket id, and confirmed `$TICKET_ID` is already an available input
    parameter in both `evaluator.md` and `skeptic.md` (their own "Input" sections), so appending it
    is mechanical, not a new plumbing problem.
  - `core/scripts/setup-worktree.sh:11` — confirmed the design's non-goal reasoning ("`setup-worktree.sh`
    never derives its ticket id from the branch/worktree path — it already receives `TICKET_ID`
    explicitly as its first argument") is accurate: usage line reads
    `setup-worktree.sh <TICKET_ID> <BRANCH> [SPEED] [HARNESS_OVERRIDE]`.
  - `openspec/specs/gate-telemetry/spec.md` and `openspec/specs/ticket-id-path-safety/spec.md` —
    confirmed both capabilities already exist with different, non-overlapping requirements (gate
    duration/first_error; path-traversal validation), so labeling the new requirements in this
    change's deltas as `## ADDED Requirements` (net-new requirement titles within a
    pre-existing capability) is the correct openspec convention, not a mislabel.
  - `core/scripts/README.md:51-52` — confirmed the args columns for `start-servers.sh` and
    `assert-phase.sh` that Task 6.1 targets exist as described.

- **Placeholder/hand-waving scan**: `grep -rniE "TODO|TBD|FIXME|figure out|placeholder"` across
  the change directory — no matches.

### Acceptance-criteria trace

1. One run dir/row for a lowercase-suffix branch → Decision 1 (explicit trailing arg) + Decision 2
   (unconditional `emit-event.sh` uppercasing as a second, independent line of defense) together
   close this even for callers that are never updated to pass the new argument. Traced to real
   insertion points above.
2. Explicit ticket id with documented fallback → Decision 1's exact signatures, tasks 1.1-2.3,
   spec `gate-telemetry` requirement 1 and its four scenarios.
3. CON-64-style regression coverage → tasks 5.1-5.3, explicitly targeting the same test files
   CON-64 itself extended, with the "explicit id + wrong-case basename" shape as the regression
   case.
4. Explicit decision on migrating split directories → Decision 3, proposal's Impact section, with
   reasoning (telemetry-only blast radius per the ticket's own text, existing reap policy,
   migration-script risk/reward) rather than silence.

All four ACs trace to specific tasks/decisions grounded in the real code, not asserted in the
abstract.

### Internal consistency

- proposal.md's "What Changes" → design.md's three Decisions → tasks.md's six task groups form one
  coherent chain with no contradictions I could find between them.
- The two spec deltas match the proposal's "Modified Capabilities" section exactly (one
  requirement set per capability, matching the two scripts/one script split).
- No scope drift: everything in tasks.md maps to the ticket's own three-item "Fix" list or its ACs;
  item 3 of the ticket's Fix list ("consider whether `setup-worktree.sh` should normalise...") is
  explicitly addressed and closed as a non-goal with a verified-accurate reason, not silently
  dropped.

### Verdict: CONFIRM

Sound enough to implement. Every mechanism described (argument threading, the `emit-event.sh`
canonicalisation insertion point, the role-template call sites, the test files to extend) was
checked against the actual current source and matches. No placeholders, no contradictions between
proposal/design/tasks, no ambiguous task an implementer could misread, and no AC left uncovered.

### Non-blocking notes

- `core/scripts/README.md`'s `cleanup.sh` row (line 50) still doesn't show `[TICKET_ID]` even
  though `cleanup.sh` has carried that argument since CON-64 — a pre-existing doc gap, not
  introduced by this change, but Task 6.1 is already touching adjacent rows in the same table and
  could pick it up for free.
- Task 4.3's re-render step ("`concertino sync` or the project's equivalent render step") is a
  little vague about exactly which command the executor should run in this repo; worth confirming
  during execution that `concertino sync` (self-hosting case per `cleanup.sh`'s own comments) is
  in fact the right invocation here, though this is unlikely to block implementation.
