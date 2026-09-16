## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `b92fc9efd1d7a4f9f667dbe15422c5efc13a93da` on
`task/typed-verdict-category-validation/CON-189`, diffed against LIVE-resolved
base `d246b703059e8b8e5ecea6de31c8e46491edacac` (via
`resolve-review-base.sh`). No servers involved — this is Concertino, a
zero-runtime-dependency CLI/TUI, so Phase 3 (UI review) is N/A.

### Phase 1: Spec Review — FAIL

Issues:

1. **Design.md Decision 9 / tasks.md 5.3 / `verdict-category` spec's
   "Historical uncategorized verdict events remain readable" scenario is
   only half-tested.** The scenario text reads: "any gate check reading
   those verdicts reaches the same outcome as before this change." Design.md
   states explicitly: "A test asserts an uncategorized historical event
   still renders and still satisfies the readiness check." Task 5.3 says the
   same: "the reducer folds it without throwing, and
   `check-merge-readiness.sh`'s verdict selection reaches the same outcome
   as before." Only the reducer half was implemented
   (`test/reducer.test.js` — 3 new tests, confirmed by diff). `grep -rln
   category test/` returns only `test/reducer.test.js` and
   `test/scripts/emit-event.test.sh`; `test/scripts/check-merge-readiness.test.sh`
   has zero diff and zero mentions of `category`. I independently confirmed
   by reading `scripts/concertino/check-merge-readiness.sh:372-417` that its
   jq selection (`select(.kind == "verdict" and .role == "evaluator")`,
   reading only `.verdict` and `.head_sha`) does not reference `category` or
   `gate` at all, so the *behavior* is almost certainly unaffected — but the
   promised committed proof of that claim does not exist. Task 5.3 is marked
   `[x]` in `tasks.md` for work that is only partly done.
   **Change Request:** add a `check-merge-readiness.test.sh` case that feeds
   a fixture log containing an uncategorized (and a malformed-`head_sha`)
   verdict and asserts the readiness outcome is unchanged, per the spec
   scenario and design.md's own stated intent.

2. **The `PRE_CHANGE_SCRIPT` vacuity question, ruled on as requested.** This
   is a real, if bounded, defect. Reproduced independently:
   `bash test/scripts/emit-event.test.sh` (no env var set) reports `161
   passed, 0 failed` and prints `WARNING: PRE_CHANGE_SCRIPT not set/executable
   — skipping RED-baseline proof …` (verified in the `npm test` run below,
   and in a standalone invocation). This means the mutation-baseline half of
   CON-197's own governing principle ("a validation that cannot fail is
   worse than none") does not run in CI going forward — it ran exactly once,
   manually, by the executor, and the transcript is pasted into
   `files-modified.md` as a historical artifact rather than committed,
   re-derivable coverage. CON-188's own precedent in this same batch REFUTED
   specifically on "missing committed shell-level coverage" — this is the
   same shape of gap one ticket later. The fix the ticket itself points to is
   cheap and available: `d246b703059e8b8e5ecea6de31c8e46491edacac` is
   permanently in this repo's history, so the test file can do `git show
   <base>:core/scripts/emit-event.sh` into a scratch file itself and run the
   RED half unconditionally — no env var, no operator action, no silent skip.
   **Change Request:** make the RED-baseline self-deriving via `git show`
   against the recorded base SHA (or a `BASE_SHA` constant the test file
   owns), so the proof runs on every `npm test` invocation rather than only
   when a human remembers to export `PRE_CHANGE_SCRIPT`.

   I separately confirmed the GREEN half (the part that *does* run
   unconditionally) is genuinely failable: I copied the whole worktree to a
   scratch directory (`/tmp/con189_mutcopy`, never touching the tracked
   worktree — the one in-worktree sed attempt was blocked by the permission
   system and reverted with no diff, confirmed via `git status --short`
   showing clean afterward), mutated the category-refusal branch's `exit 1`
   to `exit 0`, and re-ran the suite: 3 assertions went red (`GREEN: missing
   category refused`, `GREEN: bogus category refused`, `refused on illegal
   category: verdict itself still exits non-zero`), confirming those
   specific GREEN assertions are load-bearing, not decorative.

All other Phase 1 items pass:
- CON-189/CON-187/CON-194 ACs are each addressed (see Phase 2 evidence below
  for the mechanics); no AC silently reinterpreted.
- No scope creep found — `git diff --name-only` matches `files-modified.md`
  exactly (verified byte-for-byte list match).
- `core/roles/orchestrator.md` diff correctly widens the CON-152-scoped
  prohibition to a general rule while preserving the `workflow-state.md`
  recording requirement (confirmed by reading the diff hunk directly).
- CONSTRAINTS in `workflow-state.md` is `[]` — nothing to honor beyond the
  plan itself (CON-161 n/a this cycle).
- Planning artifacts (proposal/design/tasks) reflect the implemented
  behavior except for the 5.3 gap noted above.

### Phase 2: Code Review — PASS (with the above spec-coverage gap carried
forward as a Change Request, not a separate code defect)

Fresh gate run (never trusted the executor's own report):

```
npm test   →  exit 0 (full ~50-suite chain, ~9 min, no -n)
```

Full tail confirms `emit-event.sh: 161 passed, 0 failed` and no failures
anywhere in the chain (captured in `/tmp/npmtest_con189.log`, not committed
— ephemeral scratch per the task).

Targeted checks:
- **CON-171 placement (the single most consequential property).** Verified
  by direct line-number grep: `lease_release` call is at
  `core/scripts/emit-event.sh:411`; the new verdict-field validation block
  begins at line 414, strictly below. Confirmed by mutation-testing (via the
  scratch-copy method above) that a refused-on-illegal-category auditor
  verdict still releases the lease (`ok refused on illegal category: lease
  still released despite the refusal` — an existing, passing assertion I
  independently re-derived is meaningful the same way).
- **`category`/`gate` k=v-loop capture is byte-identical to the generic `*)`
  passthrough** — same `FIELDS`/`OTHER_FIELDS` encoding pattern, confirmed
  by reading the diff hunk directly; a non-verdict event passing `gate=`
  is unaffected in shape.
- **Omitted-`head_sha` paths untouched.** The new SHA-format check is
  wrapped in `if [ -n "$HEAD_SHA" ]`, guarding it to stated SHAs only; the
  pre-existing stated/inferred/unresolvable-HEAD block above it is
  unmodified in the diff. `test/scripts/emit-event.test.sh` still carries
  and passes the three pre-existing CON-166 assertions (`ok stated head_sha
  recorded`, `ok inferred head_sha equals git HEAD`, `ok unresolvable-HEAD
  case: emission still exits 0`), all green in the fresh run.
- **Non-verdict event kinds unaffected.** `phase.enter` assertions
  (`phase.enter with no category: exits 0`, `still appended`) are present
  and green; `resolution_channel`/escalation-family assertions above them in
  the same file are unchanged and still passing (confirmed in the log).
- **Render parity.** `cmp core/scripts/emit-event.sh
  scripts/concertino/emit-event.sh` → identical; both `-rwxr-xr-x`;
  `rendered-scripts-drift.test.sh` → `19 passed, 0 failed`.
- **`files-modified.md` completeness for the squash guard.** `git diff
  --name-only $BASE...HEAD` produces exactly the 19 files
  `files-modified.md` and the squash guard both list. Ran
  `DRY_RUN=1 bash scripts/concertino/squash-branch.sh "$PWD" origin main
  "CON-189 test" "openspec/changes/typed-verdict-category-validation"` →
  `READY dry run: guard passed, nothing committed` listing all 19 staged
  files, matching `files-modified.md`'s declared paths
  (`scripts/concertino/emit-event.sh`, `core/roles/*.md`, `test/**`) exactly.
- **Role docs.** Grepped all four enum values plus `category=` on the
  verdict-emission line in `evaluator.md`/`skeptic.md`/`auditor.md`;
  `skeptic.md` additionally carries `gate=<GATE>` and states it required;
  both `evaluator.md` and `skeptic.md` state the 40-character `head_sha`
  requirement near their `head_sha=` instruction; `executor.md` still emits
  zero `verdict` calls.
- **openspec validate**: `openspec validate "typed-verdict-category-validation"
  --type change` → `Change 'typed-verdict-category-validation' is valid`,
  exit 0 (captured directly, not through a pipe).
- **CON-197 / read_raised_field() (Decision 7).** Confirmed by reading
  `emit-event.sh:442-465`: `read_raised_field()` dispatches only over
  `escalation.raised` events and the three unrelated fields
  (`raised_at`/`escalation_id`/`sub_questions`); `category`/`gate`/`head_sha`
  are `verdict`-event fields and never reach that function. Decision 7's
  claim holds; filing the tightening as a spinoff rather than folding it in
  is correct scope discipline.
- No dead code, no untyped escape hatches (this is bash/shell, N/A for
  typed-language concerns), no magic values beyond the enum lists which are
  the point of the change, no over-engineering — the diff is minimal and
  contained to exactly the region proposal.md scoped.

### Phase 3: UI Review — N/A

No `frontend/**`, no backend routes, no schemas — this is the Concertino CLI
repo. No dev server exists to start; correctly not attempted.

### Overall: FAIL

The core mechanism (validation, placement, role docs, render parity,
authorship widening, squash-guard completeness) is solid and independently
re-verified by mutation, not just read. The FAIL is narrowly on two
verification-completeness gaps that this ticket's own governing documents
(design.md, tasks.md, and the `verdict-category` spec's own scenario text)
explicitly promised and did not fully deliver — both directly actionable in
one more cycle, neither requiring a design change.

### Change Requests

1. Add a `check-merge-readiness.test.sh` case exercising a category-less
   verdict and a malformed-`head_sha` verdict in a fixture log, asserting the
   readiness outcome is unchanged from the pre-change behavior — the test
   design.md Decision 9 and tasks.md 5.3 both state exists and does not.
2. Make the RED-baseline mutation proof in `test/scripts/emit-event.test.sh`
   self-deriving (e.g. `git show d246b703059e8b8e5ecea6de31c8e46491edacac:core/scripts/emit-event.sh`
   into a scratch file at test-run time) so it runs unconditionally on every
   `npm test` invocation instead of being skipped whenever `PRE_CHANGE_SCRIPT`
   is unset, which is every CI run today.

### Non-blocking Suggestions

- None beyond the above — the implementation quality is otherwise high and
  the design reasoning (Decisions 1–9) is unusually well justified against
  its own stated tensions.
