## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff read in full** — `git diff main...HEAD` at `ca0585a`: `core/roles/orchestrator.md`,
  `core/scripts/{assert-phase.sh,gather-escalation-context.sh,README.md}`, the two rendered
  copies under `scripts/concertino/`, and two test files. Rendered copies confirmed byte-identical
  to their `core/` sources (`diff` → IDENTICAL). Rendered agent files are gitignored
  (`.gitignore:16`), correct for this repo.
- **Full suite re-run by me** — `npm test` in the worktree: exit 0, no failing subtest
  (grepped for `not ok` / non-zero `failed` counts; none).
- **Independent red-before-green probe** — built my own throwaway repo+linked worktree at
  `.concertino/worktrees/skeptic-probe-CON136` (removed after) and ran the **rendered**
  `scripts/concertino/assert-phase.sh setup` against my own fixtures. Observed, verbatim:
  - missing artifact → `FAIL premise-validation evidence missing: …` (rc=1)
  - `**Sibling collisions:** tbd` → `FAIL unanswered: Sibling collisions:` (rc=1)
  - field omitted entirely → same FAIL (rc=1)
  - `**Verdict:** bogus-value` → `FAIL invalid verdict: "bogus-value"` (rc=1)
  - heading removed → `FAIL missing heading` (rc=1)
  - complete `no-drift` → `PASS setup` (rc=0)  ← single-line mutations flip PASS↔FAIL
  - `material-drift` + no matching event → FAIL naming the missing escalation (rc=1)
  - `material-drift` + `escalation.raised` with `role=executor` → still FAIL (role enforced)
  - `material-drift` + `escalation.raised`, `role=orchestrator`, `context` produced by
    `gather-escalation-context.sh ticket-drift` (first line `TICKET-DRIFT-ESCALATION`) → `PASS setup`
  - a non-marker orchestrator escalation present alongside does not satisfy the check (prefix match real).
- **Path assumption verified end-to-end** — ran `persist-evidence.sh PRB-2 premise-validation.md`
  from my probe main-checkout root: landed at `.concertino/runs/PRB-2/evidence/premise-validation.md`,
  exactly where `assert-phase.sh setup` looks. The design's fixed-bare-filename reasoning holds.
- **Constraint 1 (mechanical prompt / judgment answer)** — read the `node -e` scan: it checks
  heading presence, three non-placeholder fields, and verdict enum only. It never inspects whether
  a claim is correctly judged. Satisfied.
- **Constraint 2 (proportionate no-drift cost)** — only the `material-drift` branch reaches the
  events-log check; `no-drift`/`minor-staleness` cost one artifact read. Orchestrator prose states
  the cost explicitly (no sub-agent, no loop, one evidence write). Satisfied.
- **AC trace** — AC1 ✓ (orchestrator.md new Setup step 2, before branch derivation); AC2 ✓ (Claims
  checked field + procedure); AC3 ✓ (material-drift → escalation w/ claimed/actual/options;
  minor-staleness re-derived, no escalation — verified no gate cost on that path); AC4 ✓ (reproduced
  above); AC6 ✓. **AC5 ✗** — see CR1.

### Verdict: REFUTE

### Change Requests

1. **AC5 is not traceable to any evidence — "demonstrated on a real stale ticket" was never
   recorded.** The ticket requires the step be demonstrated on CON-128's or CON-131's verbatim
   original premise *and shown to detect the drift*, and design.md Decision 7 explicitly forbids
   satisfying it with a hand-written `material-drift` conclusion. `tasks.md` 5.2 and 5.4 are checked
   off, but there is **no artifact anywhere**: `grep -n "CON-128\|CON-131\|bare checkout\|globally-installed"
   test/scripts/assert-phase.test.sh` → no matches; `.concertino/runs/CON-136/evidence/` contains only
   the planning artifacts + `evaluation-1.md` (no fixture/demonstration file); `events.jsonl` carries
   four `evidence` refs, none for a demonstration; and `evaluation-1.md` verifies only the *gate*
   mechanics (its five listed outcomes are all hand-built artifacts), never the detection.
   Everything I could reproduce demonstrates that `assert-phase.sh` can *read* a correctly-shaped
   file — which is precisely the assumed-answer failure Decision 7 named. Required: run the step's
   own procedure (e.g. `git config --get core.bare` for CON-131's "the helio repo root is a bare
   checkout"; the readlink/inode comparison for CON-128's stale-global-install claim) against the
   verbatim original text, record the *derived* finding plus the exact command output in a
   `premise-validation` demonstration artifact, persist it via `persist-evidence.sh`, and reference
   it from `files-modified.md`. If AC5 is instead judged out of scope, that is a product-owner call,
   not something to close by leaving 5.2/5.4 ticked.

2. **The renumbering left three stale step-number cross-references inside the new block — the exact
   defect class this ticket exists to prevent — and `files-modified.md` asserts the opposite.**
   After the insert, Setup is: 1 fetch, 2 premise-validation, 3 derive branch, 4 create worktree,
   5 `assert-phase.sh setup`, 6 AGENT_MERGE, 7 workflow-state. But:
   - `core/roles/orchestrator.md:263` — "step 4's gate below will still fail closed" → the gate is **step 5**; step 4 is worktree creation.
   - `core/roles/orchestrator.md:275` — "`assert-phase.sh setup` (step 4 below)" → **step 5**.
   - `core/roles/orchestrator.md:276-277` — "resolve against `$WORKTREE_PATH`, which step 3 creates" → the worktree is created by **step 4**.
   - `core/scripts/assert-phase.sh:101-103` (and the rendered `scripts/concertino/assert-phase.sh:101-103`) — "after `setup-worktree.sh` has already run at step 3" → **step 4**. (This same comment correctly says the gate runs at step 5, contradicting the role doc's "step 4".)
   - `files-modified.md:3` claims the change "fixed **every** internal step-number cross-reference" — false as written; correct it along with the refs.
   This is doc-only, but the doc *is* the product here: these four wrong pointers sit in the
   fail-closed paragraph an orchestrator reads to decide what the backstop is, and they point at
   the wrong step. Re-render (`concertino sync`) after fixing `core/`.

### Non-blocking notes

- `design.md:24` and `design.md:76` say the gate fires at "Setup step 4" using the pre-change
  numbering; now that the step landed, aligning those to step 5 (or marking them as pre-renumber)
  would keep the design readable, but a design doc frozen at authoring numbering is defensible.
- `openspec/changes/planning-premise-validation-gate/evaluation-1.md` is untracked in the worktree
  (`git status`); it is persisted to the run evidence dir, so this is cosmetic — flagging only so
  delivery doesn't lose it. The two WIP paths `scripts/concertino/{pricing-table.json,report-cost.sh}`
  are untracked as expected and were not touched.
- The material-drift escalation check is genuinely fail-closed on the degraded-raise path (no
  `context=`), and both the role prose and the script comment say so — good, this was the most
  likely thing for a future implementer to "fix" wrongly.
