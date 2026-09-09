## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `01c0ce8` on `feature/squash-branch-dry-run-mode/CON-164`, base
`2101a78`. No conclusions inherited from the design gate or `evaluation-1.md`;
every statement below is grounded in a command I ran or a file I read.

### What I verified (with evidence)

**Ground truth.** `git diff --stat 2101a78 HEAD` — 14 files, 880 insertions, 0
deletions. The only non-artifact files are `core/scripts/squash-branch.sh` (+23)
and `test/scripts/squash-branch.test.sh` (+266). Read
`core/scripts/squash-branch.sh` in full (318 lines) plus the full diff of both.

**AC1 — spelling.** `core/scripts/squash-branch.sh:94-97`:
`if [ "${DRY_RUN:-0}" = "1" ]` normalized into `DRY_RUN_MODE`. Exact string
match, `set -u`-safe default, same spelling as helio's `cut-release.sh:81`.
Bound next to `ALLOW_EMPTY_DECLARATION`, mirroring the existing convention. MET.

**AC2 — all validations still run.** Structural, and I confirmed it by reading
rather than trusting the claim: the only dry-run conditional in the file is at
line 302, *below* every validation. Merge-base/criss-cross (113-125),
base-advancement logging (127-134), staged-set computation (138-142), CON-162
on-disk/staged-blob/divergence/D4a checks (157-198), declaration parsing
(200-226), allowlist comparison (228-255), staged count+list print (257-264),
and both refusals (267-298) are all above it. There is no second path that could
drift. MET.

**AC3 — exit-code identity.** Every refusal is reached by executing literally
the same code with no dry-run conditional in scope, so identity on the refusing
paths is structural, not asserted. Confirmed empirically by Scenario 7b, which
runs the *same fixture* wet and dry and compares — `ok 2.4 ... refusal exit code
matches` and `ok 2.4 ... refusal diagnostic is byte-identical`. The one genuine
divergence (empty prospective staged set: guard passes, dry exits 0, wet exits 1
from the post-guard `git commit` failure) is named explicitly in design.md D6
and scoped out honestly in the spec delta's third scenario, rather than papered
over. AC3's wording ("passing and every refusing path") is satisfied; the
divergence is not a guard verdict. MET.

**AC4 — diagnostics.** Refusals get no dry-run banner (byte-identical, proven by
7b). The passing path prints `READY dry run: guard passed, nothing committed
(DRY_RUN=1)` — unambiguous, and asserted both positively and negatively (7a
asserts the wet `squash commit created` wording is absent). MET.

**AC5 — no branch mutation.** The early return at 302-305 precedes `git reset
--soft` (307) and `git commit` (312), which are the script's only mutations. MET.

**AC6 — proven on a branch that WOULD pass.** Scenario 7a's fixture is the same
shape as the pre-existing 4.5 fixture (declared `own-file.txt` + consistent
staged `files-modified.md`), and 7c proves that exact shape commits on the wet
path. I checked the vacuity trap specifically: if the fixture secretly *refused*,
the no-mutation assertions would pass for the wrong reason. It cannot — 7a also
asserts `RC7A -eq 0` **and** that the output contains the dry-run marker, and
that marker is printed from nowhere except the post-guard early return. So the
run demonstrably reached the passing path. Snapshots are HEAD, `git write-tree`,
`git status --porcelain`, and `rev-list --count`. MET.

**AC7 — genuinely failable.** I tried to construct a broken implementation that
7a would still pass: commit-without-reset moves HEAD (caught); reset-without-
commit moves HEAD (caught); index-only mutation is caught by `write-tree` +
`--porcelain`; ignoring the flag entirely is exactly the 7d mutation. Ran the
suite myself: `ok 3.1 ... deleting the dry-run early return makes DRY_RUN=1
commit anyway (HEAD moved: f8bdaa38 -> 9a6ce246)`, followed by `ok 3.2 restored
real script leaves HEAD unchanged`. The red/green pair is real and mechanically
produced, not narrated. 7d also asserts the mutation actually changed the file
(`3.1a` sha256 before != after), closing the no-op-mutation hole. MET.

**AC8 — judgment not weakened.** `git diff 2101a78 HEAD -- core/scripts/
squash-branch.sh` is purely additive: a comment block (40-52), the inert
`DRY_RUN_MODE` binding (94-97), and the 4-line early return (302-305). Zero
deletions. No refusal condition, allowlist rule, or declaration-parsing rule was
moved, reordered, or reworded. With `DRY_RUN` unset, `DRY_RUN_MODE=0` and line
302 is a no-op. All 41 pre-existing assertions still pass. MET.

**AC9 — fix in core/.** `git diff --name-only 2101a78 HEAD | grep -c
'scripts/concertino/squash-branch.sh'` → `0`. The rendered copy is untouched
(and still divergent from core/, which is CON-172's, per design.md's Risks). MET.

**Gate re-run (fresh, by me).** `bash test/scripts/squash-branch.test.sh` →
**53 passed, 0 failed**. Reproduced twice (second run under the post-archive
simulation below). This repo has no `.husky/` directory, so the design's
gate-chain classification is moot rather than merely argued.

### Verdict: REFUTE

The implementation of the script itself is clean, minimal, and correctly
evidenced — AC1-AC9 are all met and I could not break the mutation proof. The
blocker is not in `core/scripts/squash-branch.sh`; it is that the permanent test
suite was given a permanent write into an ephemeral directory.

### Change Requests

1. **`test/scripts/squash-branch.test.sh:1029-1057` — the suite writes evidence
   into a tracked change directory on every run, and self-degrades once this
   change is archived. This is a blocking defect, and it is the evaluator's
   non-blocking item (b) escalated, because I measured a second consequence it
   did not cover.**

   Two reproduced facts:

   - Running the suite rewrites the committed
     `openspec/changes/squash-branch-dry-run-mode/mutation-transcript.txt` with
     fresh SHAs, leaving the tree dirty. `git status --short` after my run shows
     ` M openspec/changes/squash-branch-dry-run-mode/mutation-transcript.txt`
     with `4 insertions(+), 4 deletions(-)`. `npm test` (package.json:23) runs
     this suite, so every contributor and every CI run dirties a tracked file.
   - **After this change is archived the write target ceases to exist and the
     suite errors on every future run, forever.** I simulated it by moving the
     change dir aside and re-running:

     ```
     test/scripts/squash-branch.test.sh: line 1057: .../openspec/changes/squash-branch-dry-run-mode/mutation-transcript.txt: No such file or directory
     squash-branch.test.sh: 53 passed, 0 failed
     ```

     The redirect fails, the whole `{ ... }` block is skipped, and — because the
     file runs under `set -uo pipefail` without `-e` — nothing fails. It is a
     permanently dead, permanently noisy line that no assertion protects. The
     existing two-path fallback at 1030-1033 does not help: neither candidate
     directory survives archiving.

   No other test script in `test/scripts/` writes into `$ROOT` (`grep -ln '>
   *"\$ROOT/' test/scripts/*.sh` → no matches), so this is off-pattern as well
   as self-degrading.

   Required: stop the permanent suite from writing into the repo tree. The
   transcript is one-time delivery evidence, not a test output. Either write it
   to a temp path and have the executor copy the generated content into the
   change dir once (keeping the committed file static), or gate the whole block
   behind an opt-in such as `[ -n "${CON164_WRITE_TRANSCRIPT:-}" ]`. Either way
   the committed `mutation-transcript.txt` stays as-is and the suite becomes
   side-effect-free. Do **not** simply delete the committed transcript — AC7's
   evidence obligation rests on it, and my re-run above independently reproduces
   its red/green pair.

2. **`test/scripts/squash-branch.test.sh:31-34` — `restore_script` does not
   sweep `.bak3.*`.** This is the evaluator's item (a). I confirmed it: the
   cleanup `rm -f` lists `.bak.*` and `.bak2.*` only, while the new Scenario 7d
   snapshots to `$SCRIPT.bak3.$$` (line 959). Ruling on whether it blocks *on its
   own*: **it does not.** The `EXIT` trap still restores the real script from
   `PRISTINE_SCRIPT`, so an interrupted run can never leave `squash-branch.sh`
   mutated — the only consequence is a stranded untracked
   `core/scripts/squash-branch.sh.bak3.<pid>`, and only if the run is
   interrupted. I verified no stray `.bak*` files exist after my runs.

   I am nonetheless listing it as a change request rather than a note because it
   is a one-line edit in the same file CR1 already reopens, and leaving a known
   asymmetry in cleanup machinery that three other scenarios get right is not
   worth a follow-up ticket. Add `"$ROOT/core/scripts/squash-branch.sh".bak3.*`
   to the sweep.

### Non-blocking notes

- design.md D6 and the spec delta's "does not predict failure of the reset or
  commit" scenario are the right call and are unusually well argued — the
  divergence is real, named, and deliberately not "fixed" into an unrequested
  behaviour change. I checked the alternative and agree: adding `--allow-empty`
  or a new emptiness refusal would both violate AC8. No action.
- The `READY` prefix is retained on the dry-run success line so caller
  prefix-matching keeps working, with the disambiguation in the trailing text.
  Correct trade-off; worth remembering if any caller ever starts matching the
  full line rather than the prefix.
- `core/` and `scripts/concertino/squash-branch.sh` remain divergent at this
  commit, so this run's own delivery squash is guarded by the stale rendered
  copy. design.md's Risks section already records this and correctly assigns it
  to CON-172. Flagging only so no reader mistakes a green delivery for evidence
  about `core/`.
