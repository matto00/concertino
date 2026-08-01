## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth re-established.** Read `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, both spec deltas (`specs/followup-triage/spec.md`,
  `specs/orchestrator-turn-discipline/spec.md`), `evaluation-1.md`, and the full
  `core/roles/orchestrator.md` diff and `core/scripts/triage-followup.sh` from
  this worktree directly (not from any agent's narrative). The branch is stacked
  on unmerged CON-49/CON-50 commits, so I isolated CON-51's own diff with
  `git diff e92a0ad...HEAD --stat` (16 files, 1553 insertions) rather than
  reading the full `main...HEAD` diff, which also contains those two prior
  tickets' unrelated changes.

- **Gates independently re-run, not trusted from the evaluator's report:**
  - `npm test` → exit 0, `0 failed` across every reported test file (captured
    full log; `grep -c "^not ok"` on the log → `0`).
  - `openspec validate follow-up-triage-classification --strict` →
    `Change 'follow-up-triage-classification' is valid`.

- **Script correctness.** Read `core/scripts/triage-followup.sh` in full: the
  k=v parsing, the four required-field validation, the overlap computation
  (`git -C <worktree> diff --name-only <base>...HEAD`, >=50% threshold for
  `high`), and the decision table all match `design.md` §Decisions/1 and
  `specs/followup-triage/spec.md` line-for-line. `core/scripts/
  triage-followup.sh` and `scripts/concertino/triage-followup.sh` are byte-
  identical (`diff` → no output). `test/scripts/triage-followup.test.sh` is
  wired into `package.json`'s `test` script immediately after
  `gather-escalation-context.test.sh`.

- **Scope check.** `git diff e92a0ad...HEAD --stat` (this ticket's own two
  commits) touches exactly the files `proposal.md`'s Impact section names,
  plus this change's own planning artifacts. `core/roles/evaluator.md` /
  `core/roles/skeptic.md` unchanged, matching the stated non-goal.

- **UI review — confirmed genuinely N/A, not assumed.** `concertino.config.json`
  → `"ui": { "enabled": false, "tool": "none" }`, and this ticket's diff touches
  only `core/roles/orchestrator.md`, a shell script (times two, canonical +
  synced), a shell test file, and `package.json` — no frontend/UI files.
  Skipped the screenshot/dev-server phase of Phase 3 UI review as genuinely
  N/A, confirmed from the config rather than inherited from the evaluator's
  claim.

- **The specific point I was asked to adjudicate — the fold-in
  archive/un-archive resolution.** Read `core/roles/orchestrator.md`'s
  "Triaging a suggested follow-up" sub-procedure in full (lines 382-494,
  particularly the `fold-in` branch's three numbered sub-steps around
  lines 450-491) against `design.md` §Decisions/4. The executor's resolution —
  edit `ticket.md`/`proposal.md`/`design.md`/`tasks.md` at the archived path,
  temporarily move the directory back to `openspec/changes/<CHANGE_NAME>/` for
  `openspec validate`'s duration, then re-archive once the added scope ships —
  is *directionally* correct and I confirmed its factual premises hold:
  - `openspec validate <archived-change-name>` genuinely cannot find an
    archived change (`Unknown item 'force-escalation-ticket-ambiguity'` when
    run against the still-archived directory) — moving it back to
    `openspec/changes/<name>/` is in fact required, exactly as documented.
  - I reproduced this directly: copied the real archived
    `force-escalation-ticket-ambiguity` change back to
    `openspec/changes/force-escalation-ticket-ambiguity/` unmodified,
    `openspec validate force-escalation-ticket-ambiguity --strict` →
    `Change 'force-escalation-ticket-ambiguity' is valid` (so the "move back
    for validate" half of the resolution genuinely works).

  **But the "re-archive once shipped" half does not, as documented, actually
  work — and I reproduced this as a hard failure, twice, independently:**
  - Same setup (archived `force-escalation-ticket-ambiguity` moved back,
    unmodified — the state the sub-procedure's own step 1 leaves it in before
    validate/design-gate/execute): `openspec archive
    force-escalation-ticket-ambiguity --yes` →
    `escalation-context ADDED failed for header "### Requirement:
    gather-escalation-context.sh formats structured context for a sixth kind,
    ticket-ambiguity" - already exists` / `Aborted. No files were changed.`
  - Repeated with a second, unrelated archived change
    (`launchpad-queue-status-action`) to rule out a fixture-specific fluke:
    same failure mode — `launchpad-queue-status ADDED failed for header
    "### Requirement: The launch pad shows a distinct queued status..." -
    already exists` / `Aborted. No files were changed.`
  - Root cause: the change's own `specs/<capability>/spec.md` delta files
    still contain the `## ADDED Requirements` blocks that were already merged
    into `openspec/specs/<capability>/spec.md` during the *first* archive
    pass. `openspec archive` re-processes every delta file in the (now
    un-archived) change's `specs/` directory on the second pass and aborts
    when it tries to re-add a requirement header that's already present in
    the canonical spec.
  - Neither `design.md` §Decisions/4 (items 1-2) nor `core/roles/
    orchestrator.md`'s fold-in steps say anything about resetting or pruning
    the change's `specs/` delta directory before this second archive call —
    the orchestrator text treats re-archiving as a mechanical formality
    ("re-archiving it once the added scope has shipped is part of this same
    `fold-in` obligation, not a separate step to skip"), when in fact it is a
    call that will abort exactly as reproduced above unless something prunes
    those already-merged delta entries first.
  - This isn't a corner case: it is the documented, literal path every
    `fold-in` verdict at the Phase 3 call site must take (the design
    explicitly requires re-archiving "once the added scope has shipped" as
    part of the same obligation), so it will be hit on essentially every
    real fold-in that reaches this point, not just an edge case.
  - `openspec archive --skip-specs` exists and would sidestep the collision,
    but is never mentioned as the answer here — and reaching for it
    unconditionally would be wrong whenever the added scope genuinely needs a
    new/modified spec requirement (which `design.md`'s own "design.md if the
    added scope needs its own decisions" language anticipates is plausible),
    silently dropping exactly the kind of requirement update CON-30's failure
    was about — recorded intent with no corresponding durable spec change.

  This is a real, reproducible workflow gap in the resolution the executor
  and evaluator signed off on, not a documentation-staleness nit (the
  evaluator's non-blocking note about `design.md`'s prose being stale is a
  different, cosmetic issue — this is a functional break in the one
  procedure the fold-in path exists to guarantee "actually happens").

### Verdict: REFUTE

### Change Requests

1. **`design.md` §Decisions/4 (items 1-2) and `core/roles/orchestrator.md`'s
   "Triaging a suggested follow-up" fold-in steps (around lines 450-471) must
   explicitly account for re-archiving a change whose `specs/` delta
   directory already reflects a prior archive pass.** As written, following
   the documented steps literally (edit plan artifacts at the archived path →
   move back → validate → design-gate → execute → re-archive) causes
   `openspec archive` to abort on the re-archive step whenever the change's
   `specs/` subdirectory hasn't been reset first — reproduced above against
   two independent real archived changes in this repo. Required: add an
   explicit instruction that before re-archiving, the change's `specs/`
   delta files are reset to contain only deltas for the newly-added scope
   (removing/rewriting the entries the first archive pass already merged),
   or, when the added scope introduces no new spec requirements at all, use
   `openspec archive --skip-specs` — and require the orchestrator to state
   explicitly which of the two applies (tied to whether `design.md`'s own
   fold-in revision added any new/modified requirement), rather than leaving
   this to be discovered as a broken command mid-run.

### Non-blocking notes

- Confirms the evaluator's own non-blocking note: `design.md` §Decisions/4
  item 1's prose still describes fold-in edits as happening "in the *current*
  change's `openspec/changes/<CHANGE_NAME>/` directory" with no mention of
  the archive/restore handling `core/roles/orchestrator.md` actually
  documents. Worth folding into the same revision as Change Request 1 above
  rather than a separate pass.
- `core/scripts/README.md` / `scripts/concertino/README.md`'s script table
  still doesn't list `triage-followup.sh` (evaluator already flagged this;
  confirmed still true) — non-blocking, doesn't affect functionality.
