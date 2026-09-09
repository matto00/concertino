## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review of `35f3b0a` on `feature/squash-branch-dry-run-mode/CON-164`, base
`2101a78`. I re-derived AC1–AC9 from my own diff rather than inheriting round 1's
conclusion, and verified both CR fixes against the file and by running them.

### What I verified (with evidence)

**Ground truth.** `git diff --stat 2101a78...HEAD` — 16 files, 1192 insertions,
1 deletion. Non-artifact files: `core/scripts/squash-branch.sh` (+23) and
`test/scripts/squash-branch.test.sh` (+288/-1). `git log 2101a78..HEAD` shows
exactly two commits (`01c0ce8`, `35f3b0a`).

**`core/scripts/squash-branch.sh` re-derived (AC1–AC9).** My own
`git diff 2101a78...HEAD -- core/scripts/squash-branch.sh` is purely additive and
consists of exactly three hunks: a header `Environment:` comment block; the
`DRY_RUN_MODE=0` / `if [ "${DRY_RUN:-0}" = "1" ]` normalization beside the
existing `ALLOW_EMPTY_DECLARATION` binding; and a 5-line early return
(`echo "READY dry run: guard passed, nothing committed (DRY_RUN=1)"; exit 0`)
placed under the existing "Guard passed" comment, immediately above
`git reset --soft "$MERGE_BASE"`. Zero deletions, zero reordering.
- AC1 — exact-string `= "1"` with a `set -u`-safe default. MET.
- AC2 — the single conditional sits below every validation; there is no second
  branch point (`grep -n DRY_RUN` on the file yields only the comment, the
  normalization, and this block). MET.
- AC3/AC4 — refusals reach `exit` with no dry-run conditional in scope, so
  identity is structural; empirically `ok 2.4 ... refusal exit code matches` and
  `ok 2.4 ... refusal diagnostic is byte-identical` in my own run. The passing
  path prints a distinct marker; 2.3 also asserts the wet wording is absent. MET.
- AC5 — the return precedes the script's only two mutations (`reset --soft`,
  `commit`). MET.
- AC6 — Scenario 7a's fixture is a passing one and asserts exit 0 **plus** the
  marker, which is emitted only from the post-guard return, so the run
  demonstrably reached the passing path (not vacuously refused). MET.
- AC7 — see the failability probe below. MET.
- AC8 — additive only; `DRY_RUN` unset ⇒ `DRY_RUN_MODE=0` ⇒ line 302 is a no-op.
  All pre-existing assertions still pass. MET.
- AC9 — `git diff --name-only 2101a78...HEAD | grep 'scripts/concertino'` returns
  **nothing** (rc=1). The rendered copy is absent from the full branch diff. MET.

**CR1 fix verified (side-effect-free suite).** `test/scripts/squash-branch.test.sh:1051-1078`:
the transcript is now always computed into `CON164_TRANSCRIPT_TMP="$(mktemp)"`,
and only `cp`'d into the change dir when `CON164_RECORD_TRANSCRIPT=1`; the temp
file is `rm -f`'d unconditionally at the end. Measured, not read:
- Ordinary run → `53 passed, 0 failed`, and `git status --short` immediately
  after is **empty**. The tracked `mutation-transcript.txt` is byte-identical.
- Full `npm test` → exit 0, tree still clean afterwards.
- Opt-in run (`CON164_RECORD_TRANSCRIPT=1`) → prints the "written to …" line and
  is the *only* way the tracked file changes (` M mutation-transcript.txt`,
  which I reverted). Correct opt-in semantics.

**Post-archive simulation (I ran it).** Moved
`openspec/changes/squash-branch-dry-run-mode` aside and re-ran:
- Ordinary run → `53 passed, 0 failed`, **no** `No such file or directory` line,
  no error, no INFO. Assertion count is identical (53) to the change-dir-present
  run, so nothing that used to run was silently skipped — the round-1 defect is
  gone in both directions.
- Opt-in run with the dir absent → `53 passed, 0 failed` plus an explicit
  `INFO CON164_RECORD_TRANSCRIPT=1 set but … no longer exists (change likely
  archived)`. Loud, not a swallowed redirect. Directory restored afterwards;
  `git status --short` empty.

**The opt-in gating does NOT make the failability proof vacuous.** This was the
sharpest risk and I probed it specifically. The transcript block is entirely
*downstream* of the assertions: `3.1a` (sha256 before != after, proving the
mutation bit), `3.1` (mutated script commits — HEAD moves), and `3.2` (restored
script does not move HEAD) are all `ok`/`bad` calls that execute unconditionally
and count toward PASS/FAIL regardless of `CON164_RECORD_TRANSCRIPT`. My ordinary
(non-recording) run printed all three green, including
`ok 3.1 … (HEAD moved: before=067fe6d9… after=0b2a0ba6…)` with fresh SHAs. The
red-then-green pair is produced mechanically on every run; the transcript is
evidence *of* the proof, not the proof itself. Requirement satisfied.

**CR2 fix verified.** `restore_script` (lines 32-35) now sweeps
`.bak.*`, `.bak2.*` **and** `.bak3.*`. Scenario 7d snapshots to `$SCRIPT.bak3.$$`
(line 959). After all my runs, `ls core/scripts/ | grep bak` → nothing.

**No new `$ROOT` write, no leaked temp.** The only remaining `$ROOT` write target
in the suite is line 1069's `CON164_TRANSCRIPT_DEST`, reachable solely under the
opt-in. The mktemp file is removed on the normal path; the pristine-script temp
is still removed by the `EXIT` trap. Tree clean after every run I did.

**Gates re-run fresh by me.** `bash test/scripts/squash-branch.test.sh` →
**53 passed, 0 failed** (run 4× total across the scenarios above, stable).
`npm test` → **exit 0**, all suites `N passed, 0 failed`.

### Verdict: CONFIRM

Both round-1 change requests are genuinely fixed, verified by measurement rather
than by reading the executor's summary. The script change is unchanged since
`01c0ce8` and independently re-derived as meeting AC1–AC9. Ships.

### Non-blocking notes

- The archived-dir INFO line says the transcript is "left only at
  /tmp/tmp.XXXX", but the unconditional `rm -f "$CON164_TRANSCRIPT_TMP"` two
  lines later deletes it. The message is slightly inaccurate about where to find
  the file. Cosmetic, on an opt-in-only diagnostic path; not worth a cycle.
- If the suite aborts between the `mktemp` and the trailing `rm -f`, the
  transcript temp leaks (the `EXIT` trap only clears `PRISTINE_SCRIPT`). One
  stray `/tmp` file on an abnormal exit; the suite already creates many
  `mktemp -d` fixtures it never removes, so this is in-pattern rather than new.
- `core/` and `scripts/concertino/squash-branch.sh` remain divergent, so this
  run's own delivery squash is still guarded by the stale rendered copy
  (CON-172, already recorded in design.md's Risks). Unchanged from round 1;
  flagging only so a green delivery is not read as evidence about `core/`.
