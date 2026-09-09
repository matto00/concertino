## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `a186fdea6d6eaffc6a5317184fd7b074f7f8a80f` (cycle-1 review was
`07523c2`; this report covers the delta plus a fresh re-run of every gate).

### Phase 1: Spec Review — PASS

Issues: none.

Both cycle-1 change requests are resolved, verified against the diff rather
than the executor's summary:

**CR2 (stale `assert-phase.sh` wiring text) — resolved at all three sites:**

- `proposal.md:31-36` now reads "run as an explicit new Phase 3 step 0 (before
  `design.md`'s re-persist and before the squash/archive — `assert-phase.sh`'s
  `delivery` phase fires only after archiving has already moved these files, so
  this check is never wired into it)". No longer contradicts its own Impact
  section.
- `design.md:73` now reads "the divergence check, run as an explicit Phase 3
  step 0".
- `design.md:287-292` — the Risks bullet is retitled "**Phase 3 step 0
  timing.**" and restated in terms of the shipped wiring, while preserving the
  substantive trade-off (caught once before archiving/squashing, not per cycle).
- The round-1/round-2 historical flaw narratives in Decisions 2/2a are untouched
  (`git diff 07523c2..HEAD -- design.md` shows only the two hunks above), as
  requested — the record of what was rejected and why is intact.

Non-blocking notes from cycle 1 also addressed: the two `agreed_at` JSON quote
typos in `orchestrator.md:498,776`, the missing blank line before Phase 3
step 1, and an `extract_field` comment documenting the trailing-space
convention.

Ticket ACs all remain satisfied (unchanged from cycle 1's verification), and AC5
("new assertions proven red-first") is now strictly stronger: the evidence is
automated rather than a one-time pasted transcript.

### Phase 2: Code Review — PASS

**Gates re-run fresh by me in `WORKTREE_PATH`** (`CLEAN_WORKTREE` unset):

- `npm test` → **exit 0**; zero suites reporting any failures
  (`grep -Ec ", [1-9][0-9]* failed"` → 0 over the whole log,
  `/tmp/con161-c2.log`). The new suite appears in the chain and reports
  `check-constraints-carryover.sh: 16 passed, 0 failed`.
  `rendered-scripts-drift.test.sh` is still green, including its
  `1.1 real tree` case.
- `npx openspec validate promote-methodology-into-state --type change` → valid.
- `check-constraints-carryover.sh` against the live change dir → exit 0, `OK`
  (still the non-vacuous `OK`, not `OK (none)` — the 3-vs-3 count leg is live).
- `git status --porcelain` clean.

**CR1 (no automated test) — resolved, and the new test is provably failable.**
`test/scripts/check-constraints-carryover.test.sh` (163 lines, 16 assertions)
ports all eight red-first scenarios a–h, each driving the **real** script
against a throwaway `mktemp -d` change dir (never a reimplementation), and is
registered as the last entry of `package.json:23`'s `test` chain.

I did not take its green run as evidence on its own. Four independent mutations
of `core/scripts/check-constraints-carryover.sh`, each run against a scratch
copy of the tree, each turned it red with a non-zero exit:

| mutation | result |
|---|---|
| M1 — drop the `SET_B != SET_C` leg (three-way → two-way) | `(h)` red: `expected [1] got [0]` / `expected to find [DIVERGED] in: OK`; suite `14 passed, 2 failed`, exit 1 |
| M2 — drop the review-count check | `(c)` red; suite `14 passed, 2 failed`, exit 1 |
| M3 — treat malformed JSON as an absent field | `(g)` red: `expected to find [DIVERGED] in: OK (none)`; exit 1 |
| M4 — make the missing-file branch exit 0 | `(d)` red; exit 1 |

So each of the four semantics the design turns on — the third leg of the
three-way comparison, the count leg, absent-vs-malformed, and
missing-file-vs-empty — is individually guarded by a failable assertion. This
is not an assertion whose precondition guarantees it.

**Render mirror byte-identical after the latest edit — re-confirmed:** `cmp`
identical; `md5sum` `b9a9500efc82b2f10038bceeeb0f07e3` for both
`core/scripts/check-constraints-carryover.sh` and
`scripts/concertino/check-constraints-carryover.sh` (both changed from cycle 1's
`7c2cbaf` by the same 4-line comment addition, so the `cp` was genuinely
re-run); render is `0755`; no `concertino sync` collateral in the diff.

**Still not wired into `assert-phase.sh` — re-confirmed:** `assert-phase.sh`
absent from `git diff --name-only main...HEAD`; `grep -rn
"constraints-carryover"` against both the core and rendered `assert-phase.sh`
returns nothing; the only invocation site remains `orchestrator.md` Phase 3
step 0, with non-zero → Phase-3 `BLOCKER`, ahead of the `design.md` re-persist
and the squash/archive.

Other code-review checks: no dead code, no TODO/FIXME, no duplication (the test
reuses the repo's standard `ok`/`bad`/`check` harness shape), naming and
structure match `test/scripts/check-merge-readiness.test.sh`'s precedent, and
the change is scoped exactly to the two CRs plus the three cosmetic notes.

### Phase 3: UI Review — N/A

No UI surface in this repo; the diff is markdown, a bash script, a bash test,
and one `package.json` line.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `test/scripts/check-constraints-carryover.test.sh:2` — the header says "Shell
  tests for `scripts/concertino/check-constraints-carryover.sh`" but line 10
  targets `core/scripts/...`. Targeting `core/` is the right choice (the mirror
  is covered by `rendered-scripts-drift.test.sh`); it is the comment that is
  wrong.
- The `has ... "DIVERGED"` assertions match only the substring, not the specific
  reason string, so a regression that produced the *right* verdict for the
  *wrong* reason would pass. Cases (a)/(c)/(h) each have only one reachable
  DIVERGED path given their fixtures, so nothing is currently unguarded —
  asserting the full reason text would just make that robustness explicit.
- No case covers a missing `tasks.md` (only a missing `workflow-state.md`) for
  the exit-2 path; task 4.2 only specified the latter, and both branches are
  three lines apart, so this is a completeness nicety.
- `proposal.md:37` still summarizes the count check as
  `len(CONSTRAINT_REVIEWS) == SKEPTIC_VERDICTS_TOTAL`, omitting the
  `where gate != "planning"` filter that `design.md` Decision 2, the spec, and
  the script all carry. The proposal is a summary and the authoritative
  statements are correct, so this is cosmetic.
