## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is derived from the diff, the running script and
fixtures I built myself; the evaluator/skeptic-design reports were read as claims only.

### What I verified (with evidence)

**Ground truth.** `git log --oneline 87f1a53..HEAD` → the three named commits.
`git diff --stat 87f1a53..HEAD` → 15 files, +1558/-0: `core/scripts/squash-branch.sh`
(+40), `scripts/concertino/squash-branch.sh` (+40), `test/scripts/squash-branch.test.sh`
(+600), rest artifacts. No guard logic is touched; the entire code delta sits *below*
the `DRY_RUN=1` early exit. Working tree clean except the expected untracked
`evaluation-3.md` and the modified `workflow-state.md`.

**AC7 / drift.** `cmp core/scripts/squash-branch.sh scripts/concertino/squash-branch.sh`
→ byte-identical. `bash test/scripts/rendered-scripts-drift.test.sh` → **18 passed, 0
failed**. `concertino sync` was not run at any point by me, and the two CON-173 files
are untouched (`scripts/concertino/pricing-table.json` still appears as the exempt
entry in drift check 2.15).

**Suite green, and stable.** `bash test/scripts/squash-branch.test.sh` run **twice**
(the SIGTERM/poll scenarios are timing-sensitive, so a single green is not evidence):
**83 passed, 0 failed** both times; both trap scenarios broke out of the poll at 100ms
against a 10s bound.

**AC6 — failability, verified independently rather than trusted.** I did not take the
in-suite mutation arms at their word. I copied `core/` + `test/` to `/tmp/con170probe`,
excised the *entire* CON-170 hunk (record, helper, trap install, gated echo, `trap -
EXIT`; `grep -c` confirms 0 remaining references), and re-ran: **75 passed, 8 failed** —
3.2 HEAD unchanged, 3.2 porcelain unchanged, 3.2 no new commit, 3.2 names the
restoration, 3.7 EXIT-trap restore, and all three 3.9 arms go red. The primary no-strand
assertions are genuinely failable against the real defect. (See CR1 for the one that is
not.)

**Trap semantics — measured, not assumed.** design.md D2 claims the `EXIT` trap covers
`SIGTERM/SIGINT/SIGHUP`. In bash an `EXIT` trap is *not* universally understood to run
on fatal signals, so I measured it: a `set -uo pipefail` script with `trap ... EXIT`
killed by TERM (rc 143), INT (rc 0) and HUP (rc 129) fired the trap in all three cases.
The claim holds. Armed window is correct by inspection: installed immediately before the
forward `reset --soft`, disarmed by `trap - EXIT` immediately after a successful commit,
so it cannot fire on the success path — and Scenario 10 asserts the absence of any
"Branch restored" line on a clean squash. D3's overlap case is genuinely idempotent
(`reset --soft` to the SHA HEAD already holds succeeds as a no-op). Restore is `--soft`
only — no path in the diff can destroy uncommitted work. **Misfire risk: acceptable.**

**Double diagnostic: acceptable.** On a restore-itself-fails run the helper's
`FAIL could not restore HEAD to ...` may print twice (explicit call, then the trap's own
attempt). Both lines name both SHAs and the reflog, neither claims success, exit stays 1.
Noisy, honest, not a defect.

**D1 (reject `commit-tree`) — right call, and the argument is honest.** I checked the
load-bearing premises myself: concertino has no `.husky/`, no `core.hooksPath`, and only
`.sample` files in `.git/hooks` — so the "coin-flip for this repo alone" concession is
true, not spin. helio's `.husky/pre-commit` really does run ~20 gates
(`check:repo-integrity`, `lint`, `typecheck`, `format:check`, `check:schemas`,
`check:openspec`, `check:no-credential-leak`, `check:tokens`, `npm test`, …). `commit-tree`
is plumbing and runs no `pre-commit`/`commit-msg` hook. So the regression D1 describes is
real and silent, and rejecting the ticket's own stated preference is correct. The design
concedes the counter-argument (atomicity) rather than strawmanning it, and D5's
hook-based fixture enforces D1 (3.1/D5 asserts the hook's marker file exists — a switch
to `commit-tree` turns that red). Argument honest; decision sound.

**AC1 — the substantive behaviour is correct, including the non-degenerate D4 shape.**
I built my own fixture outside the suite: a branch with two commits (add, then `git rm`
the same files) so `HEAD != merge-base` but the prospective staged set against the
merge-base is empty. Against the shipped script: `rc=1 after=a38326a6 stranded=no`, with
`Branch restored to pre-squash HEAD a38326a6`. Against the fully-reverted script:
`rc=1 after=3fbdf605 stranded=YES`. The fix handles the real, harmful empty-staged-set
case exactly as D4 claims. AC4 (guard judgment unchanged) and AC5 (`DRY_RUN=1`) hold:
all pre-existing scenarios remain green and the new code is entirely below the dry-run
return.

**AC3 / D4 — the ruling itself discharges the obligation.** D4 does not re-defer: it
upholds CON-164's rejection of `--allow-empty` and of a new emptiness refusal *in this
change's own voice with its own reasons*, then separates the exit-code divergence (kept,
correct) from the stranding harm (this ticket's, fixed by D2), and names no owner because
nothing is left outstanding. That is a real ruling, not a restatement. The obligation is
discharged **in design and in code**. It is not discharged in test — see CR1.

### Verdict: REFUTE

One change request. It is narrow and the shipped behaviour is correct — but it is a third
instance, in the same run, of the exact pattern that produced the previous two REFUTEs: an
assertion that passes for a reason unrelated to the thing it claims to prove.

### Change Requests

1. **Scenario 9 (`test/scripts/squash-branch.test.sh`, "empty staged set after guard
   passes restores the branch", task 3.4) is vacuous on its restore assertion, and
   design.md D4's claim that it enforces the ruling is therefore false.**

   The fixture builds a branch with **no commits beyond `origin/main`**, so
   `merge-base == HEAD`. The forward `reset --soft "$MERGE_BASE"` is then a no-op and
   HEAD cannot move — `3.4 empty staged set: branch restored (HEAD unchanged)` is true
   whether or not any restore exists. Proof: in my full-revert probe (fix entirely
   removed, 8 assertions red) **3.4 stayed green on all three of its assertions.** The
   fixture cannot distinguish "restored" from "there was nothing to restore".

   This matters because design.md D4 asserts, as the thing that discharges AC3, that
   "*A regression test covers this input explicitly so the ruling is enforced rather than
   merely recorded*". For the restore half of the ruling, it is merely recorded. AC6
   requires the no-strand assertion to be *proven failable by mutation*; this one is not,
   and unlike Scenarios 8/12/13 it carries no mutation arm at all.

   Required: make Scenario 9's fixture the non-degenerate shape, so `HEAD != merge-base`
   while the prospective staged set is still empty. I have already confirmed this shape
   works and is failable — add a commit and then a second commit that removes the same
   files (`git rm own-file.txt <change_dir>/files-modified.md`); the guard still passes
   with `Staged file count: 0`, `git commit` still fails with nothing to capture, and the
   restore is then load-bearing (measured: `stranded=no` shipped vs `stranded=YES`
   reverted). Keep the existing `no empty commit created` / non-zero-exit assertions, and
   either add a mutation arm in the shape of 3.3/3.8 or state in the scenario comment
   which existing arm covers it. Then correct D4's sentence if the coverage claim still
   overstates what the scenario proves.

### Non-blocking notes

- The three mutation arms guard against fixture staleness with a bare Python `assert
  needle in text`. The test script does not run under `set -e`, so if a future edit makes
  a needle stale the heredoc dies, the substitution silently does not happen, and the arm
  can still pass on the unmutated script (in my full-revert probe, 3.3 and 3.8 passed
  exactly this way). Consider checking the interpreter's exit status, or asserting
  post-hoc that the mutated file actually differs from `$SCRIPT.bak.$$`.
- No UI surface in this change (shell scripts only), so the design-standard / dual-theme
  screenshot review does not apply; no servers were started.
