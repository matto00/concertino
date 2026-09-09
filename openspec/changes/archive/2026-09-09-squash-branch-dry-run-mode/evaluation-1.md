## Evaluation Report — Cycle 1 (evaluation-1.md)

Scope: commit `01c0ce8` on `feature/squash-branch-dry-run-mode/CON-164`, diffed
against base `2101a78`. Read: ticket.md, proposal.md, design.md, tasks.md,
specs/delivery-squash-guard/spec.md, skeptic-design-1/-2/-3.md, files-modified.md.

### Phase 1: Spec Review — PASS

Issues: none.

Per-AC verification (all against the diff and the file, not the handoff):

- **AC1 (spelling)** — `core/scripts/squash-branch.sh:94-96` uses exactly
  `if [ "${DRY_RUN:-0}" = "1" ]`, normalizing into `DRY_RUN_MODE`, placed beside
  the existing `ALLOW_EMPTY_DECLARATION` normalization. Matches the cited
  `cut-release.sh` convention. The `:-0` default is present (mandatory under
  `set -u`).
- **AC2 (all validations still run)** — structurally guaranteed, not asserted:
  the single dry-run branch point is at line 302, below every validation. Diff
  confirms nothing above line 299 changed except the header comment block.
- **AC3 (exit-code identity)** — holds for every guard verdict; the two non-zero
  exits below the branch point (reset-failure, commit-failure) are the carve-out
  the round-1/2 skeptic litigated and the spec delta now explicitly scopes out.
  Implementation matches the *revised* spec, not the ticket's unqualified wording.
- **AC4 (distinguishable output)** — `READY dry run: guard passed, nothing
  committed (DRY_RUN=1)`, distinct from the wet `READY squash commit created`.
- **AC5/AC6/AC7** — see Phase 2 test analysis below; satisfied.
- **AC8 (judgment unweakened)** — zero refusal paths touched (diff is +14 header
  lines, +4 normalization lines, +5 branch-point lines; nothing removed).
- **AC9 (source of truth)** — fix is in `core/scripts/squash-branch.sh`.
  `git diff --name-only 2101a78..01c0ce8 | grep -c scripts/concertino/squash-branch.sh`
  returns `0`; `grep -c DRY_RUN scripts/concertino/squash-branch.sh` returns `0`.
  The stale render target (CON-172) was correctly left alone.

All 20 task items are checked and each matches implemented reality. No scope
creep: the diff outside the change dir is exactly the two files declared in
`files-modified.md`.

### Phase 2: Code Review — PASS

Gates re-run by me, fresh, in `WORKTREE_PATH` (executor's report not trusted):

- `bash test/scripts/squash-branch.test.sh` → **53 passed, 0 failed**, exit 0.
  The 30 pre-existing assertions (Scenarios 1–4.5) all still pass alongside the
  23 new Scenario 7 ones.
- `npm test` → **exit 0**; three suites, each `N passed, 0 failed`, no failures
  anywhere in the chain.

Specifically verified rather than taken on trust:

- **Exactly one DRY_RUN conditional.** `grep -n DRY_RUN core/scripts/squash-branch.sh`
  yields 5 hits: one header-comment line (41), the normalization block (94-96),
  and the single branch point (302-303). There is no second conditional, no
  per-call guard on `reset`/`commit`, and no `DRY_RUN` reference in any refusal
  path — exit-code and diagnostic identity on refusals is structural, exactly as
  task 1.3 requires.
- **Placement.** The branch point sits after the final guard refusal block and
  immediately before `git reset --soft "$MERGE_BASE"`, under the existing
  "Guard passed" comment. Confirmed by reading the diff hunk at line 299.
- **Exact-match, not truthiness.** `= "1"` string comparison, not `[ -n ]` /
  `((...))`. Pinned positively by test 2.5, which asserts `DRY_RUN=true` takes
  the **wet** path and commits — a looser test would go green under a truthiness
  implementation, so this assertion has real discriminating power.
- **7a is not vacuous.** The fixture is a *passing* one (declared `own-file.txt`
  plus a consistent staged `files-modified.md`, mirroring the existing 4.5
  fixture). Against an implementation that ignored `DRY_RUN` entirely, the script
  would reach `reset --soft` + `commit`, so HEAD, `write-tree`, `status
  --porcelain` and commit count would all change and five assertions would go
  red. This is the load-bearing test and it discriminates correctly.
- **7d's failability proof is anchored and self-checking.** The mutation is a
  Python in-place edit anchored on the `READY dry run:` marker, with `assert`s on
  the enclosing `if`/`fi` lines so a mis-anchored edit aborts loudly rather than
  no-opping. Critically, `sha256sum` is captured before and after and asserted
  **different** (task 3.1a) *before* the mutated run — closing exactly the
  "sed matched nothing, so HEAD legitimately moved" false-pass the round-1
  skeptic warned about. The mutated run moves HEAD; the restored run on a fresh
  fixture does not. Both directions are asserted.
- **7b is correctly labelled non-evidence.** The comment block above it restates
  task 2.6 verbatim — it passes vacuously against a script ignoring the flag and
  is not cited as proof dry-run mode exists. Honest framing.
- **Restoration mechanism.** 7d uses `cp $SCRIPT $SCRIPT.bak3.$$` / `mv` back,
  matching the file's own existing `.bak.$$` / `.bak2.$$` precedent (lines 152,
  263, 348) rather than introducing a new pattern. The pre-existing
  `PRISTINE_SCRIPT` + `trap restore_script EXIT` (lines 28-37) still covers an
  interrupted run: an abort mid-mutation restores the real script from the
  pristine snapshot. Task 3.2 satisfied.
- **D6 left alone.** `grep -n "allow-empty" core/scripts/squash-branch.sh` shows
  only pre-existing `--allow-empty-declaration` usage-string and flag-parsing
  hits. No `git commit --allow-empty` was added, and no new emptiness refusal
  exists above the guard. The empty-prospective-staged-set case remains CON-170's.
- **Task 4.3b's caller check reproduced.** The only non-source reference to the
  script is `core/roles/orchestrator.md:990`, which branches on exit code only.
  `grep -rn "\^READY\|grep -q READY" core/` finds no prefix matcher that could
  misread the dry-run marker as a completed squash. The finding is accurate.
- Fixtures use `mktemp -d` and a bare remote; nothing operates on this repo's
  own branches. Header documentation (lines 40-52) covers behaviour, exit-code
  identity, the no-mutation guarantee, and the exact-match caveat.

No DRY / readability / dead-code / over-engineering findings. The change is
minimal and behaviour-additive.

### Phase 3: UI Review — N/A

No UI-affecting files. This is a Node CLI + shell project; per the brief, no dev
servers were started.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `test/scripts/squash-branch.test.sh:1005` restores via `.bak3.$$`, but
  `restore_script` (line 32-33) only sweeps `.bak.*` and `.bak2.*`. An interrupt
  between the `cp` and the `mv` restores the script correctly but strands a
  `core/scripts/squash-branch.sh.bak3.<pid>` file. Adding `.bak3.*` to that `rm`
  list is a one-line completion of the existing cleanup.
- `mutation-transcript.txt` is committed evidence that the test suite rewrites on
  every run with fresh fixture SHAs, so `git status` is dirty after any test run
  (confirmed locally). It cannot trip the squash guard, since it lives inside the
  always-allowed change dir — but a committed file regenerated non-deterministically
  by the suite is avoidable churn. Writing it to a gitignored path, or committing
  it once and having the test compare rather than rewrite, would remove it.
