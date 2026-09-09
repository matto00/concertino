## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `07523c287a4cf17c53905c3fb73b3be0ed66b973` (base `8c746fb`).

### Phase 1: Spec Review — PASS (with one artifact-drift issue, carried as CR2)

Acceptance criteria, each checked against the diff:

1. **Constraint written into `workflow-state.md` at the moment it is agreed** — met.
   `core/roles/orchestrator.md` gains three write points: Planning-ESCALATION
   resolution (Phase 1 step 4 sub-bullet), design-gate verdict (step 5
   sub-bullet), final-gate verdict (Phase 2 verdict-handling list), each stating
   "record this verdict immediately, before re-running the gate or resuming the
   executor — never defer."
2. **Every role whose resume path reads `workflow-state.md` picks them up
   automatically** — met. `core/roles/executor.md` (Resumability) and
   `core/roles/evaluator.md` (Resumability + a Phase 1 checklist item) each gain
   the binding line; no new file to re-read. `orchestrator.md`'s "Guardrails"
   addition also binds the writer role itself when it composes sub-agent resume
   input (task 2.4).
3. **Mechanical divergence check that fails loudly** — met, and independently
   re-verified (see Phase 2).
4. **Concertino-vs-per-repo placement decision recorded with reasoning** — met.
   `design.md` Decision 3 records Concertino-level placement and the reasoning
   (the gap is structural to the role-doc resume contract, identical in every
   consuming repo; a per-repo fix would be re-derived per repo with no shared
   detection). The one per-repo artifact — the `scripts/concertino/` render
   mirror — is named explicitly.
5. **New assertions proven red against the pre-fix tree** — met, and
   independently re-verified rather than accepted from `files-modified.md` (see
   Phase 2, "Red-first re-verification").

Tasks: all 24 items marked `[x]`; each maps to a corresponding hunk in the diff.
No scope creep — the diff touches exactly the five `core/` files named in the
proposal's Impact section, the render mirror, and the change dir. `openspec
validate promote-methodology-into-state --type change` → "Change ... is valid".
`git status --porcelain` clean (no stray files).

`workflow-state.md`'s self-referential backfill (task 5.2) is present and
correct: `SKEPTIC_VERDICTS_TOTAL: 3` with three `design`-gate
`CONSTRAINT_REVIEWS` entries (REFUTE/REFUTE/CONFIRM, all `promoted: []`),
`CONSTRAINTS: []`. This makes the check *non-vacuous* on this very run — the
count leg is actively compared (3 vs 3), not defaulted away (proved by mutation,
below).

Issue: **planning artifacts contain stale text asserting the exact wiring
Decision 2a rejected** — see CR2. This is the one Phase 1 checklist item
("Planning artifacts reflect the final implemented behavior") not fully clear.

### Phase 2: Code Review — FAIL

**Gates re-run by me, fresh, in `WORKTREE_PATH`** (`CLEAN_WORKTREE` unset):

- `npm test` → **exit 0**, every suite `N passed, 0 failed`, zero failing
  assertions across the whole run (log: `/tmp/con161-npmtest.log`). Includes
  `rendered-scripts-drift.test.sh` → `1.1 real tree: drift check exits zero`,
  which is the gate that would have caught a missing/divergent render mirror.
- `npx openspec validate promote-methodology-into-state --type change` → valid.
- `bash -n core/scripts/check-constraints-carryover.sh` → clean.

Per `CONTRIBUTING.md:31`, `npm test` is this repo's entire verification gate
(no lint/format/hook tooling exists here) — nothing skipped.

**Red-first re-verification (task 4.2, 8 scenarios) — done from fixtures I built
myself, not from the executor's pasted output.** All eight reproduce exactly as
claimed:

| # | scenario | my observed result |
|---|---|---|
| a | `tasks.md` `C1` absent from `CONSTRAINTS` | exit 1 `DIVERGED: id sets disagree (tasks.md=[C1], CONSTRAINTS=[], CONSTRAINT_REVIEWS.promoted=[])` |
| b | reverse asymmetry | exit 1 `DIVERGED: id sets disagree (tasks.md=[], CONSTRAINTS=[C1], ...promoted=[C1])` |
| c | counter ahead of reviews | exit 1 `DIVERGED: review count mismatch (non-planning CONSTRAINT_REVIEWS=0, SKEPTIC_VERDICTS_TOTAL=2)` |
| d | `workflow-state.md` file absent | exit 2 `MISSING .../workflow-state.md` |
| e | legacy state file, no new fields, no markers | exit 0 `OK (none)` |
| f | `gate:"planning"` promotion, zero skeptic verdicts | exit 0 `OK` |
| g | malformed JSON in a present `CONSTRAINTS` | exit 1 `DIVERGED: CONSTRAINTS field present but not valid JSON` |
| h | markers + `CONSTRAINTS` agree, every `promoted` is `[]` | exit 1 `DIVERGED: id sets disagree (tasks.md=[C1], CONSTRAINTS=[C1], ...promoted=[])` |

Scenario (h) is the load-bearing one — it confirms a genuine **three-way**
comparison, not two-way-plus-count. Scenarios (e)/(f) confirm the pass is not a
false positive: absent-field defaulting and planning-gate exclusion both behave
as Decision 2a specifies.

**Wiring re-verification (task 4.4), done against the live change dir:**

- Live tree as committed → exit 0 `OK` (not `OK (none)` — the count leg is live).
- Mutation 1, drop the third recorded review from the live `workflow-state.md`
  (simulating an unrecorded verdict) → exit 1
  `DIVERGED: review count mismatch (non-planning CONSTRAINT_REVIEWS=2, SKEPTIC_VERDICTS_TOTAL=3)`.
- Mutation 2, additionally append an orphan `## Standing Constraints` / `- [C1]`
  marker → exit 1 `DIVERGED: id sets disagree (tasks.md=[C1], CONSTRAINTS=[], ...promoted=[])`.
- Negative control, the same live change dir with the three fields stripped back
  to their pre-fix state → exit 0 `OK (none)`.

So the red is attributable to the divergence itself, not to the fixture or to
pre-archive timing, and this run's own state is genuinely exercised rather than
passing by default. **This is not a "precondition guarantees its own assertion"
case** — the mutations above are the proof.

**Not wired into `assert-phase.sh` (Decision 2a) — confirmed three ways:**
`assert-phase.sh` does not appear in `git diff --name-only main...HEAD`;
`grep -rn "constraints-carryover" core/scripts/assert-phase.sh
scripts/concertino/assert-phase.sh` → no hits; the check appears only as
`orchestrator.md` Phase 3 **step 0**, explicitly ahead of step 1's `design.md`
re-persist and step 3's archive, with any non-zero exit specified as a Phase-3
`BLOCKER` that must not proceed to squash/archive.

**Render mirror byte-identical — confirmed:** `cmp` reports identical;
`md5sum` `7c2cbafa4cd63ad301a85af5cd861456` for both
`core/scripts/check-constraints-carryover.sh` and
`scripts/concertino/check-constraints-carryover.sh`; both `0755`. No
`concertino sync` artifacts in the diff (only the one new mirror file).

Script-quality notes: exit-code contract matches the spec exactly; absent /
malformed / missing-file are three distinct paths and are not conflated; the
`gawk match()`-array parse has a documented portable `sed` fallback; false-marker
risk is avoided by anchoring on `^## Standing Constraints` (`tasks.md` lines 8
and 21 mention that literal string mid-bullet and correctly do not match).

Issue: **the new script has no automated test** — CR1.

### Phase 3: UI Review — N/A

No `frontend/**` or equivalent UI surface exists in this repo; the diff is
role-doc markdown, a template, and one bash script.

### Overall: FAIL

Both change requests are small and neither disputes the design — the mechanism
itself is correct, well-evidenced, and passed every probe I could think to run
against it.

### Change Requests

1. **Add `test/scripts/check-constraints-carryover.test.sh` and register it in
   `package.json`'s `test` script.** `CONTRIBUTING.md:29` states that
   `test/scripts/*.test.sh` are the bash integration tests for the procedure
   scripts under `core/scripts/`, and `CONTRIBUTING.md:31` states `npm test` is
   this repo's *entire* verification gate. 19 of the 20 scripts in
   `core/scripts/` have a matching `test/scripts/<name>.test.sh` (the sole
   exception, `setup-worktree.sh`, actually creates git worktrees);
   `check-constraints-carryover.sh` is the only newly-added, trivially-testable
   one without one. As shipped, its eight red-first scenarios exist only as
   prose in `tasks.md` 4.2 and as ephemeral `/tmp` fixtures — nothing in CI
   would catch a future regression in this gate's semantics, which is the same
   "detection must be mechanical, not a one-time claim" principle this ticket
   exists to enforce. The eight scenarios are already fully specified; port them
   verbatim (scratch change dirs under `mktemp -d`, asserting exit code and
   message for each of a/b/c/d/e/f/g/h), following the structure of
   `test/scripts/check-merge-readiness.test.sh`. Append
   `&& bash test/scripts/check-constraints-carryover.test.sh` to
   `package.json:23`'s `test` value.

2. **Remove the stale `assert-phase.sh`-wiring text from the planning
   artifacts**, which currently assert the exact design that Decision 2a
   rejected — precisely the recorded-methodology drift this ticket is about:
   - `proposal.md:32-34` — "a `check-constraints-carryover.sh` script, **wired
     into `assert-phase.sh`'s existing `delivery` phase (no new phases — none
     exist for execution/evaluation)**" contradicts both the shipped code and
     this same file's own Impact section (`proposal.md:69-72`, "new, standalone
     — not wired into `assert-phase.sh`"). Reword to the standalone Phase 3
     step 0 form.
   - `design.md:73` — "make *detection* mechanical (the divergence check, **run
     at `assert-phase.sh`**)" — should read "run as an explicit Phase 3 step 0",
     per Decision 2a.
   - `design.md:287-291` — the entire third Risks/Trade-offs bullet
     ("**`delivery`-phase timing.** Hanging the check off `delivery` means ...
     no existing per-cycle gate exists to hang it off without inventing new
     phases (CR1)") describes the rejected round-1 wiring. The underlying
     trade-off (divergence is caught once, before delivery, not per cycle) is
     still real and worth keeping — restate it in terms of Phase 3 step 0 rather
     than the `delivery` phase.

   Do not touch the round-1/round-2 flaw narratives in Decisions 2/2a — those
   describe `assert-phase.sh` deliberately, as the record of what was rejected
   and why, and are correct as written.

### Non-blocking Suggestions

- `core/roles/orchestrator.md` (design-gate and final-gate bullets): the inline
  JSON fragments `(\`agreed_at":"planning"\`)` and `(\`agreed_at":"final-gate"\`)`
  are missing the opening double-quote on the key. Cosmetic, but it is prose an
  agent will copy from.
- `core/roles/orchestrator.md` Phase 3: the new `0.` item runs directly into the
  existing `1.` with no blank line between the closing prose and `1.`, which some
  markdown renderers will fold oddly. Purely presentational.
- `check-constraints-carryover.sh:75` — `extract_field` requires a trailing space
  (`^FIELD: `), so a hand-written `CONSTRAINTS:` with no value and no trailing
  space reads as *absent* rather than malformed. The template always writes a
  value, so this is not reachable in practice; worth a comment if the test in CR1
  makes it easy to pin.
