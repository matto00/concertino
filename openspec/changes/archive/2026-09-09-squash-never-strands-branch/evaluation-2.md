## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `0aefd49` (delta over cycle 1's `cd245f8`). Gates re-run
independently: full `npm test` (rc=0, no suite reports a non-zero failure
count), `test/scripts/squash-branch.test.sh` (81/81), and
`test/scripts/rendered-scripts-drift.test.sh` (18/18). `concertino sync` was
NOT run; `scripts/concertino/pricing-table.json` and
`scripts/concertino/report-cost.sh` do not appear in the diff and were not
touched.

**Cycle 1's two change requests are genuinely fixed. One new defect was
introduced by the cycle-2 delta, and one artifact still asserts the premise
this cycle disproved.**

### Phase 1: Spec Review — FAIL

- AC1 / spec scenario "The restore itself fails" — now **PASS**, verified
  independently (see Phase 2, claim 1).
- AC6 (regression coverage, failability proven) — now **PASS** for the
  restore-failure path (Scenario 13, verified independently). But see CR1: the
  Scenario 12 coverage regressed in this delta.
- AC4 — still PASS: first 305 lines of `core/scripts/squash-branch.sh` remain
  byte-identical to `main`; the cycle-2 delta to the script is exactly three
  lines, all inside the commit-failure branch below the mutation point.
- AC7 — still PASS: `core/scripts/squash-branch.sh` and
  `scripts/concertino/squash-branch.sh` are byte-identical; drift gate green.
- design.md and tasks.md correctly retract the disproved "no practical fixture"
  premise, and design.md D2 now also documents the new
  `could not record pre-squash HEAD` branch against AC4 (cycle 1 Suggestion 2).
- **`files-modified.md` was not updated** and still asserts the retracted
  premise verbatim — see CR2. "Planning artifacts reflect the final implemented
  behavior" is not satisfied.

### Phase 2: Code Review — FAIL

**Claim 1 — the false "Branch restored" claim is gone: CONFIRMED.** Re-ran my
own ref-lock fixture (built from scratch, not the executor's) against the
unmutated cycle-2 script. Output:

```
FAIL git commit failed after guard passed
FAIL could not restore HEAD to 3ab3939... (current HEAD: 0980708...).
The branch may be left at an intermediate state. Recover manually via the reflog (git reflog).
FAIL could not restore HEAD to 3ab3939... (current HEAD: 0980708...).
The branch may be left at an intermediate state. Recover manually via the reflog (git reflog).
rc=1  before=3ab3939...  after=0980708...  mb=0980708...
```

No `Branch restored to pre-squash HEAD` line anywhere; the honest two-SHA
diagnostic and the reflog pointer both still print; exit stays 1. The duplicate
(trap-driven) diagnostic remains, as design.md D2 anticipates and now documents
post-fix. Fix accepted.

**Claim 2 — Scenario 13 and its arm are real red/green: CONFIRMED.** I reverted
the gate to the unconditional form in a copy of the script (with its `lib/`
siblings, so the copy actually runs) and re-ran my own fixture: the false
`Branch restored to pre-squash HEAD` claim reappears while HEAD sits at the
merge-base. So the green assertion is failable, not green-by-construction. I
also checked the anti-vacuity property specifically: Scenario 13 does not rely
on the absence of a string alone — it additionally asserts
`HEAD == merge-base`, which can only hold if the forward reset really happened
and the restore really failed. That is the right shape; a guard-refusal or
early-exit regression could not silently satisfy it. tasks.md 3.9 and design.md
D2 both retract the false premise explicitly. Fix accepted.

**Claim 3 — the per-run sentinel: the collision is gone, but the poll it
replaced is now dead. REGRESSION, see CR1.**

The sentinel is embedded as a shell comment on the hook's sleep line:

```sh
sleep ${sleep_secs} # sentinel:${sentinel}
```

A `#` comment is consumed by the hook's shell and never reaches any process's
argv. The `sleep` child's command line is exactly `sleep 20`; the hook shell's
is `/bin/sh .git/hooks/pre-commit`; the test script's own is
`bash test/scripts/squash-branch.test.sh`. **Nothing on the machine has the
sentinel in its command line, so `pgrep -f "$SENTINEL12"` can never match.**

Measured directly, replicating the suite's exact construction (sentinel
generated inside a script so it does not leak into the launcher's own argv, as
it would if passed as an argument):

```
waited_iters=30 (30 == never matched)
pgrep: no match at all
sleep argv: sleep 20
```

Consequences, all of them regressions against the cycle-1 version:

1. The `while [ "$WAITED12" -lt 100 ]` poll always runs to its full 100 × 0.1s
   timeout. Both Scenario 12 arms therefore wait a **fixed 10 seconds**, which
   is precisely the "fixed sleep" the surviving comment says the poll exists to
   avoid ("Poll for the hook to actually be running … rather than a fixed
   sleep, to avoid a flake if hook startup is slow on a loaded machine").
   Corroborated by runtime: the suite now takes 26.6s real against 2.2s user +
   4.0s sys — roughly 20s of pure wall-clock wait in these two arms.
2. The synchronisation guarantee is gone. 3.7 now passes only because 10s
   happens to be less than the hook's 20s sleep. On a machine loaded enough for
   hook startup to exceed 10s the `kill -TERM` lands *before* the forward
   reset, HEAD is trivially unchanged, and **3.7 passes vacuously** — the exact
   green-by-construction failure mode task 3.8 was written to prevent, reached
   from the other side. (3.8 would go red in that case, so it would be noisy
   rather than perfectly silent, but 3.7's own assertion would be worthless.)
3. `pkill -f "$SENTINEL12"` matches nothing, so the reap the comment describes
   ("Reap it (matched on the unique sentinel…) so a late completion cannot
   commit after the assertion") does not happen. Harmless in practice — the
   hook exits 1 — but the comment asserts a behaviour that does not occur.

The collision hazard I raised in cycle 1 is genuinely closed, so the intent was
right; the mechanism does not work. Note this is a comment asserting an
unexercised guard — the "evidence-shaped non-evidence" pattern this repo's own
notes call out, and it was introduced *by* a review response.

Everything else in the delta is clean: the three-line script change is minimal
and correct, the Scenario 8 mutation needle was correctly updated to the new
gated form (verified — a stale needle would have tripped its own `assert`), and
no guard, refusal, diagnostic or exit code above the mutation point changed.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/**`, `schemas/**` or `openspec/specs/**` files in the
diff.

### Overall: FAIL

Both change requests are small and confined to the test file and one artifact;
the shipped script is, as of this cycle, correct.

### Change Requests

1. **`test/scripts/squash-branch.test.sh` — make the Scenario 12 sentinel
   actually observable, or the poll is dead code.** A shell comment never
   reaches argv. Use the mechanism the Scenario 8 fixture already uses
   successfully — a marker file — which is both per-run scoped and genuinely
   observable:

   ```sh
   # in make_slow_hook_fixture, $4 = marker path (outside the working tree):
   cat > "$branch_dir/.git/hooks/pre-commit" <<HOOK
   #!/bin/sh
   touch "${marker}"
   sleep ${sleep_secs}
   exit 1
   HOOK
   ```

   then poll on `[ -f "$MARKER12" ]` instead of `pgrep`. That restores the
   "hook is actually running" guarantee, removes the two 10-second dead waits,
   and cannot collide with a concurrent lane.

   For the reap, either drop the `pkill` entirely (the hook exits non-zero, so a
   late completion cannot commit — say so in the comment) or make it match
   something real, e.g. `pkill -P` from the recorded `git commit` child, or put
   the token in the sleep's *arguments* rather than a comment (`sleep 20` →
   a wrapper the sentinel is passed to). Do not leave a `pkill` that matches
   nothing behind a comment saying it reaps.

   Whichever you choose, prove it: assert the poll actually broke out early
   (e.g. `WAITED12 -lt 100`) so a future regression to an unmatchable predicate
   fails the suite instead of silently costing 10 seconds.

2. **`openspec/changes/squash-never-strands-branch/files-modified.md` — retract
   the disproved premise here too.** Line 3 still reads "the restore-failure
   diagnostic verified by direct inspection (Task 3.9, no practical fixture
   exists for inducing a `git reset --soft` failure)" and still describes
   Scenario 12's reap "via a non-zero-exiting hook plus an explicit `pkill`".
   Both statements are now false. tasks.md and design.md were correctly updated;
   this file was missed. Update it to describe Scenario 13 and the CR1 gate.
   (The declared file list itself is unchanged and correct, so the squash guard
   is unaffected — this is an accuracy fix, not a guard fix.)

### Non-blocking Suggestions

- design.md D5's scenario list still enumerates five scenarios and does not
  mention Scenario 13 or the trap-firing scenario; the D2 post-review paragraph
  covers Scenario 13, so this is only a tidiness point, but a reader working
  from D5 alone would undercount the coverage.
