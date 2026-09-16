## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed: the wait is now a condition wait on positive evidence (a marker the
  mutant writes right after its first read), bounded (10s @ 0.05s) with a loud `check()` on
  timeout, the STALE-content assertion remains failable (verified below via mutation 4.1), and
  the sibling fixed waits in the file were explicitly assessed in design.md Decision 3 with
  stated reasoning per wait (not silently skipped).
- No AC silently reinterpreted. Task 4.3's wording was self-corrected in tasks.md (the guarded
  line is present-but-inert when the var is unset, not "removed") — this matches what mutation
  4.2 actually showed (the guard fires false and never writes, confirmed below).
- Task 5.1 (scope) verified independently: `git diff <base>...HEAD --stat` shows only
  `test/scripts/escalation-loop.test.sh` plus this change's own openspec artifacts
  (`.openspec.yaml`, `design.md`, `files-modified.md`, `proposal.md`, `skeptic-design-{1,2}.md`,
  `tasks.md`, `ticket.md`, `workflow-state.md`). No `core/`, `lib/`, `adapters/`, or `bin/` touched.
- No regressions: full `npm test` (fresh run, see Phase 2) is green — 2303/2303 node tests, every
  bash suite 0 failed, including `escalation-loop.test.sh` itself (69/69).
- No API/schema contract here (test-only change).
- `--skip-specs` rationale (Decision 5) is sound and matches the established
  `2026-08-01-fix-cleanup-sh-comment-drift` precedent; `openspec validate condition-wait-con180-repro
  --type change` (exact form) reports "Change 'condition-wait-con180-repro' is valid".
- `workflow-state.md` CONSTRAINTS: none non-retired that bear on this diff.

### Phase 2: Code Review — PASS
Issues: none blocking. One observation below (non-blocking).

Gates run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` requested this cycle):
- `npm test` (600000ms timeout, full log read to completion, not truncated): exit 0.
  `node --test`: `# tests 2303`, `# pass 2303`, `# fail 0`. Every `test/scripts/*.test.sh` line
  reports `0 failed`, including `escalation-loop.test.sh` at `69 passed, 0 failed`.
- This is a Node CLI repo with no lint/format/typecheck gate per CONTRIBUTING.md ("There is no
  separate lint or format command... `npm test` is the whole verification gate") — confirmed by
  reading CONTRIBUTING.md directly rather than assuming frontend tooling applies.

Diff review (`test/scripts/escalation-loop.test.sh`, 31 lines):
- The marker-write line is inserted into the python-generated mutant string exactly where
  design.md Decision 1 specifies: after `reason=` is parsed, before the injected
  `CON180_RACE_WINDOW_SEC` sleep. Guarded on `${CON180_FIRST_READ_MARKER:-}` so the
  un-instrumented mutant shape is preserved when the var is unset — confirmed empirically via
  mutation 4.2 below (the printf never fires, no file appears).
- `mktemp -u` for `FIRST_READ_MARKER`: the file sources `lib/tmp-scratch.sh` at the top (line 12)
  and installs `trap con181_cleanup_scratch EXIT` (line 13), which redirects `TMPDIR` for the
  process. `mktemp -u` honors `$TMPDIR` identically to a real `mktemp` call, so the marker path
  lands inside the CON-181 scratch dir and is removed by the existing trap on exit — no leak, and
  no second file sourced or trap needed. This checks out against CON-181's own documented
  convention.
- The bound (10s @ 0.05s = 200 iterations) is ~10x the measured real event (~0.95s) and well
  under the file's own `wait_killed_bounded` 20s bound, per design.md's own comparison — checked
  against the actual numbers, consistent.
- On timeout, `check()` reports `MISSING` vs `recorded` by name, which is exactly the "loud
  failure naming the missing evidence" the ticket AC and task 2.3 require — confirmed via
  mutation 4.2.
- Comment accuracy (explicit check requested): the replacement comment's cited margins
  (0.943-0.947s unloaded; 0.106-0.179s / 1.048-1.050s loaded) match design.md's own measured
  table verbatim. I did not re-derive the margin numbers myself (that would require the same
  instrumented-probe rig the executor built, out of scope for re-verification here), but the
  comment does not misstate the design doc, and the *behavioral* consequence it claims (bimodal
  failure under load, fixed by a condition wait) is independently confirmed by the mutation and
  contention testing below — so the comment's causal claim is corroborated even though its raw
  timing figures are carried over rather than independently re-measured.
- No dead code, no scope creep, no untyped escape hatches (bash — n/a), no unnecessary
  duplication. The change is minimal and confined to the one fragile wait, matching design.md
  Decision 3's stated non-conversion of sibling waits (spot-checked lines 149/320/767/281 etc. by
  reading the surrounding context — each retains its original fixed `sleep`, matching the diff
  stat of one hunk).

Non-blocking observation: the new `check()` line's PASS message text
("the mutant recorded its first read of A before B was written") is itself a *new* assertion not
enumerated by name in the ticket's ACs, but it directly implements AC 2 ("fails loudly... rather
than silently proceeding") — this is additive test coverage, not scope creep, and is exercised by
the suite itself (69 passed vs the prior file's assertion count implies this is the added check).

### Phase 3: UI Review — N/A
No `frontend/**`, no `backend/src/main/scala/routes/ApiRoutes.scala`, no `schemas/**`, no
`openspec/specs/**` changed (this is a Node CLI repo with no dev servers per the task framing).
Confirmed via the diff stat above.

### Independent re-verification (not trusting the executor's own report)

1. **Contended trials (10x, pinned + 12 spin loops on 12 cores, matching design.md's slow-runner
   emulation):** 10/10 trials passed, all four CON-180-repro assertions green each time,
   including the new marker-recorded check. This directly re-confirms the "10/10 contended
   trials pass" claim.

2. **Mutation 4.1 (defeat the wait — write B immediately, no wait for the marker), 6 trials under
   the same contention:** 6/6 trials turned the
   `CON-180 repro: its reason describes the STALE content (A, missing subAnswers)` assertion RED
   (`FAIL ... expected [true] got [false]`, consistent with the pre-fix failure signature
   described in the ticket). File reverted to the original diff content and confirmed clean via
   `git diff --stat` afterward (no residual change). This confirms the assertion is still
   failable — the wait fix did not make it vacuous.

3. **Mutation 4.2 (prevent the marker from ever being written — drop
   `CON180_FIRST_READ_MARKER=...` from the mutant's env while leaving `FIRST_READ_MARKER="$(mktemp -u)"`
   in place so the poll loop still runs against a file that can never appear):** the new
   bounded-wait `check()` went RED
   (`FAIL CON-180 repro: the mutant recorded its first read of A before B was written`) after the
   full ~10s bound, naming the missing evidence exactly as designed, and the suite did NOT report
   a clean pass (`67 passed, 2 failed`) — the downstream `content_hash` assertion also went red as
   a consequence, so the reproduction is not silently reported as passing. File reverted;
   `git diff --stat` confirmed clean afterward.

4. **`openspec validate condition-wait-con180-repro --type change`** (exact form): "Change
   'condition-wait-con180-repro' is valid".

5. **Scope check:** `git diff <live-resolved-base>...HEAD --stat` — only the test file and this
   change's own openspec artifacts differ from `main`, as required.

All claims in the assignment's "Claims you must VERIFY" section that were in scope for
independent re-measurement were reproduced directly (contended-trial pass rate, mutation 4.1 red,
mutation 4.2 red-naming-the-evidence, full `npm test` green). The raw first-read margin numbers
(0.943-0.947s / 1.048-1.050s) were not independently re-derived — doing so would require
rebuilding the same instrumented-probe harness the executor used outside the shipped diff, which
is planning-phase evidence, not part of the diff under review — but the *behavioral* claims those
numbers support were independently reproduced via the mutation and contention tests above.

### Overall: PASS

### Non-blocking Suggestions
- None beyond the observation noted in Phase 2 (additive assertion, already covered by the ticket's own AC 2 intent).
