## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: a186fdea6d6eaffc6a5317184fd7b074f7f8a80f (base main @ 8c746fb).
No UI in this change (Concertino repo, no frontend) — step 4 of the final gate
is not applicable; no servers started.

### What I verified (with evidence)

- **Diff is what is claimed.** `git diff main...HEAD --stat`: 20 files, only
  `core/roles/{orchestrator,executor,evaluator}.md`,
  `core/workflow-state.template.md`, `core/scripts/check-constraints-carryover.sh`,
  its render mirror, the new test, `package.json`, and change-dir artifacts.
  No unrelated edits.
- **AC1 (constraint written at the moment agreed).** `core/roles/orchestrator.md`
  gains three write points, each with an explicit "immediately, before resuming
  the executor / re-running the gate — never defer": Planning-ESCALATION
  resolution (`gate:"planning"`, excluded from `SKEPTIC_VERDICTS_TOTAL`),
  design-gate verdict, final-gate verdict (CONFIRM and REFUTE alike, every
  round). Read the full hunks, not the summary.
- **AC2 (every resume path picks them up).** `grep -ln workflow-state.md core/roles/*.md`
  returns exactly `executor.md`, `evaluator.md`, `orchestrator.md` — all three
  are amended (executor/evaluator Resumability lines; orchestrator "binds you
  too", including sub-agent resume-input composition). `auditor.md` has zero
  `workflow-state` hits, so it is correctly out of scope; the skeptic is cold
  by design. No role that reads the file was missed.
- **AC3 (mechanical, loud check).** `core/scripts/check-constraints-carryover.sh`
  read in full. Three-way id comparison (tasks.md `## Standing Constraints`
  markers / `CONSTRAINTS[].id` / union of `CONSTRAINT_REVIEWS[].promoted`
  across all gates incl. `planning`) plus
  `count(reviews where gate != "planning") == SKEPTIC_VERDICTS_TOTAL`.
  Absent field → `[]`/`0`; present-but-malformed → exit 1, never conflated with
  absent; missing file → exit 2. Wired as orchestrator Phase 3 **step 0**
  (pre-archive) with non-zero → `BLOCKER`, no squash/archive.
- **Never wired into assert-phase.sh (explicitly required).** `grep -rn
  "constraints-carryover" scripts/concertino/assert-phase.sh core/scripts/assert-phase.sh`
  → no hits. The rationale (assert-phase `delivery` fires *after* the archive
  moved the change dir) is stated in both the script header and orchestrator
  step 0.
- **Render mirror byte-identical.** `diff core/scripts/… scripts/concertino/…`
  → no output; `md5sum` both = `b9a9500efc82b2f10038bceeeb0f07e3`. The repo's
  own `rendered-scripts-drift` suite passes (19/19).
- **AC5 (red-first, actually failable — my own mutation testing, not the
  executor's narrative).** I copied the worktree to `/tmp/mut161` and applied
  three independent mutations to the real script, re-running
  `test/scripts/check-constraints-carryover.test.sh` after each:
  1. count check neutered (`if false`) → 14 passed, **2 failed**
  2. third leg dropped from the id comparison (`|| [ "$SET_B" != "$SET_C" ]`
     removed) → 14 passed, **2 failed** (`expected to find [DIVERGED] … got OK`)
  3. malformed-JSON branch replaced with "treat as absent" → 14 passed,
     **2 failed**
  Each of the three legs is independently load-bearing. The suite drives the
  REAL script against `mktemp -d` fixtures (verified by reading the harness:
  `SCRIPT="$ROOT/core/scripts/check-constraints-carryover.sh"`, `run_check`
  invokes it) — no inline reimplementation, so this is not evidence-shaped
  non-evidence.
- **Full gate re-run myself.** `npm test` → `NPM_TEST_EXIT=0`, `# fail 0` on the
  node suite; the new file is wired into the `test` script (last entry), so it
  is not an orphan test. `npx openspec validate promote-methodology-into-state
  --type change` → `Change 'promote-methodology-into-state' is valid`.
- **AC4 (level decision recorded).** design.md Decision 3: Concertino level, in
  `core/`, with reasoning (the gap is structural to the orchestrator/executor/
  evaluator resume contract, not repo-specific).
- **Honest-scope claim checked, not taken on trust.** design.md lines ~85-134
  explicitly retract the earlier "closes the silence gap" claim and state the
  narrower truth: the check cannot detect a constraint that was never
  recognised, only an omission turned into an affirmative false record. This
  matches what the script can actually prove. No overclaim survives in
  proposal.md, design.md, or the spec delta.
- **Self-referential backfill (task 5.2).** `workflow-state.md` carries
  `SKEPTIC_VERDICTS_TOTAL: 3` and three design-gate `CONSTRAINT_REVIEWS`
  entries (REFUTE/REFUTE/CONFIRM), matching the three `skeptic-design-*.md`
  files actually present on disk — a real count, not an invented one. All
  `promoted: []`, consistent with `CONSTRAINTS: []` and no `## Standing
  Constraints` section in tasks.md. Running the check against this very
  change dir would return `OK (none)`.
- **Batch traps searched for.** No `TODO`/`TBD`/"will be added" in the script,
  orchestrator doc, or tasks.md. No assertion whose precondition guarantees it:
  the two exit-0 cases ((e) absent-fields, (f) planning-only) are genuine
  negative controls, and mutations 1-3 above show the exit-1 cases are not
  vacuous. No announced-but-unexecuted fix: every task box ticked corresponds
  to text or code I located in the diff.

### Verdict: CONFIRM

### Non-blocking notes

1. `core/workflow-state.template.md`'s new lines carry literal placeholders
   (`CONSTRAINTS: [{"id":"C<n>",...}] | []`). If an orchestrator ever copies the
   line verbatim instead of resolving it, `jq` sees invalid JSON and Phase 3
   step 0 raises a `BLOCKER`. This matches the existing `PENDING_ESCALATION:
   {...} | null` convention and fails loudly rather than silently, so it is not
   blocking — but a false BLOCKER on a first run is a plausible papercut.
2. `jq -r '.[].id'` on a present-but-non-array JSON value (e.g. `{}`) exits 0
   and yields an empty id set, so a structurally wrong-but-valid `CONSTRAINTS`
   value reads as empty rather than `DIVERGED`. `CONSTRAINT_REVIEWS` already
   guards this with `jq -e 'type == "array"'`; the same one-liner on
   `CONSTRAINTS` would close the asymmetry.
3. `evaluation-2.md` is present but untracked at the reviewed commit
   (`git status --porcelain` → `?? …/evaluation-2.md`). Orchestrator bookkeeping,
   not a code defect.
