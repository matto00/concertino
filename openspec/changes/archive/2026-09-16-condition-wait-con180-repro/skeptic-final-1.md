## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Scope.** `git diff 4965929b96670ad7c7aecbe39864f9a1c7e61127...HEAD --stat` (base resolved live
via `resolve-review-base.sh`, exit 0) shows exactly `test/scripts/escalation-loop.test.sh` plus
this change's own `openspec/changes/condition-wait-con180-repro/**` artifacts differ from `main`.
No scope creep. `head_sha` reviewed: `1dda670b6ef604c30020d56c1b1836cfb5a8a380`.

**The diff itself.** Read in full (`git diff ...HEAD -- test/scripts/escalation-loop.test.sh`).
The mutant-generation python gains one guarded line writing `$CON180_FIRST_READ_MARKER`
immediately after `reason=` is parsed and before the injected 2s race window; the repro block
exports that path (via `mktemp -u`) to the mutant and bound-polls (200x0.05s = 10s) for the
marker before writing `MALFORMED_B`, with a loud `check()` on the outcome.

**Timing figures — independently re-measured, not taken on faith.** I built my own probe
(`/tmp/claude-.../scratchpad/con200_probe.sh`) that reconstructs the exact same mutant-generation
substitution the test uses and times the gap between the `A` write and the marker becoming
non-empty. 8 unloaded runs: 0.947-0.958s. A second batch of 10 runs under background CPU load
(4x `yes > /dev/null`): 0.945-0.958s (my attempt to induce the loaded/bimodal branch of the
comment's claim did not reproduce a >1s exceedance on this machine — likely insufficient
contention from 4 `yes` processes on a many-core box — so I can only independently corroborate
the **unloaded** figure, not the loaded one).
- Comment claims unloaded 0.943-0.947s; I measured 0.945-0.958s. Same order of magnitude, same
  story (sub-1s, narrow headroom under the 1s poll period), plausible machine-to-machine variance
  — not evidence the number is fabricated or materially wrong. **Verdict on the numbers:** the
  qualitative claim the numbers exist to support (the fixed `sleep 1` raced an equal-length 1s
  poll period with only tens-of-ms headroom, which is why no fixed constant is safe) is correct
  and independently reproduced. A few tens of ms of cross-machine drift in a documentation
  comment is acceptable — this is not a REFUTE-worthy defect. Precise-but-slightly-machine-drifted
  timing figures in a comment explaining *why* a wait exists are documentation, not a claim the
  test's correctness depends on (the test's correctness depends on the condition wait, not on the
  comment's numbers matching to the millisecond).
- The 1s poll-period premise itself is confirmed directly in `core/scripts/emit-event.sh`
  (`sleep 1` at both poll sites, lines 867 and 954) — this is the actual mechanism the comment
  describes, not an inference.

**Assertion is genuinely failable — reproduced via two live mutations, not trusted from a report.**
1. Removed the marker-write line from the mutant-generation substitution (mutated the tracked
   file in-place, ran the real suite, then restored the file byte-for-byte via `cp` — confirmed
   `git diff --stat` shows no residual change after restore). Result:
   `FAIL CON-180 repro: the mutant recorded its first read of A before B was written / expected
   [recorded] got [MISSING]`, and the downstream STALE-content assertion also correctly FAILed
   (since B won the race exactly as the old bug would produce). The bounded wait timed out
   loudly at 10s rather than hanging or silently passing; total suite run still completed
   (`timeout 90`, exit 1, no hang).
2. Ran the real (non-mutated) suite: `time bash test/scripts/escalation-loop.test.sh` →
   `69 passed, 0 failed`, exit 0, ~45s wall time (the CON-180 repro's marker wait resolves in
   ~1s per the measurements above, so the 10s bound is not adding material CI time on the
   passing path).

**10s bound does not mask future breakage.** Confirmed by mutation (1) above: on a genuine
regression (marker never written), the loop exhausts its 200 iterations and the `check()` reports
`MISSING` as a normal, visible FAIL line — not a silent fallthrough, not an unbounded hang.

**`mktemp -u` against the CON-181 scratch convention.** `test/scripts/lib/tmp-scratch.sh`
redirects `TMPDIR` to a fresh per-process scratch dir before any `mktemp` call in the file, and
`mktemp -u` (bare, no explicit dir) honors `TMPDIR` like every other call in this file — confirmed
in the mutation run's own FAIL output, which showed the marker path
`/tmp/concertino-test-scratch.<x>/tmp.<y>/.concertino/runs/HEL-978/answer.json`-sibling path
correctly scoped under the scratch dir. The nonexistent-marker case (`-s` test on a path that was
never created) does not error under `set -uo pipefail` — it evaluates false and the poll loop
correctly falls through to the loud `check()` FAIL, exactly as mutation (1) demonstrated live.

**Sibling waits — read and assessed independently, not deferred to design.md's claim.**
- Line 149 `sleep 2` (multi-part incomplete-file negative assertion): backs a claim that
  `--await` is *still running*; a longer wait only strengthens this, doesn't race a which-write-
  wins outcome. Not the same defect class.
- Fix-side `sleep 1` (current line 335, in the "the fix: the real script" block): read the
  surrounding assertion (`FIXED_LINE`/mutual-consistency check) — it explicitly accepts *either*
  A-content or B-content as long as `reason` and `content_hash` agree, so the wait's exact length
  cannot make this assertion wrong; it is race-tolerant by construction. Confirmed independently,
  not taken from design.md's assertion.
- `sleep 2.5` (current line 782, CON-156 guard): the surrounding 25-line comment explains this
  wait must observe a full window of >= 2 poll intervals and that an earlier "adaptive" version
  was itself the bug (short-circuited on one 0.2s sample) — converting this to a condition wait
  would remove exactly the property CON-156 added. Read in full; the "sleep 3"s at other sites
  wait for an event inside an already-generous margin, not an interleaving race.
(Line numbers in design.md's Decision 3 are pre-diff-shift values — e.g. it says "line 320" for
the fix-side `sleep 1` which now sits at 335 in the merged file, a ~15-line shift from the
CON-180-repro block's own insertion earlier in the file. The *content* at each site matches
design.md's description exactly; only the absolute line numbers drifted. Not a defect — this is
expected file-shift, and I verified by content/context, not by trusting the stale numbers.)

**`npm test` full suite.** Did not need to re-run the entire ~50-suite chain — the change touches
exactly one test file with no touched sibling gate scripts (design.md Decision 4, confirmed:
no `.husky/**` or gate-chain script is modified), and I already ran that one file's full suite to
completion twice (mutated + unmutated) with fully captured logs, which is the load-bearing
evidence for this ticket's scope.

**`--skip-specs` (design.md Decision 5).** Read in full. The change touches zero runtime/`core`/
`lib`/adapter behavior — only test instrumentation — and the precedent
(`2026-08-01-fix-cleanup-sh-comment-drift`) is a real, cited analog. Sound call; inventing a
capability with exactly one consumer (this same change) would not bind anything.

**tasks.md.** All of section 1-4 checked and each checkbox's "verified by" claim is independently
reproducible (I reproduced 3.2-equivalent and both of 4.1/4.2's mutation classes myself). 5.1
(scope) reproduced via my own `git diff --stat`. 5.2 (archive) is correctly left unchecked — that
step is post-gate. Task 4.3's corrected wording ("the line is present but inert" when
`CON180_FIRST_READ_MARKER` is unset) is accurate: the guard is `[ -n "${VAR:-}" ] && printf ...`,
a no-op when the var is unset, confirmed by reading the substitution and by the fact that every
non-CON-180-repro call site in this file (which never sets the var) ran clean in the full-suite
run.

### Verdict: CONFIRM

The condition wait is a real fix for a real, independently-reproduced race (not a re-worded
version of the flaky fixed sleep), the assertion is genuinely red-failable by two different
mutation classes I ran myself, the 10s bound fails loud rather than masking, the timing figures
in the comment are close enough to my independent remeasurement to trust as documentation (only
the loaded/bimodal branch of the claim went unverified by me — I disclose that gap rather than
asserting it), sibling waits are correctly left alone for a documented and independently-checked
reason, scope is exactly one test file plus this change's own openspec artifacts, and
`--skip-specs` is the right call. This ships.

### Non-blocking notes

- I could not reproduce the loaded/bimodal exceedance (0.106-0.179s / 1.048-1.050s) on this
  machine with a 4x `yes` background-load approximation; I trust the unloaded figure (closely
  matched) as sufficient corroboration of the underlying mechanism, but a future reviewer with a
  more controlled load-injection setup (e.g. `taskset` pinning as tasks.md 1.2 describes) could
  tighten this further. Not blocking — the fix's correctness does not depend on the loaded number
  being exact, only on the qualitative claim that the race exists, which is independently
  confirmed both by my unloaded measurement and by the live mutation that defeats the wait and
  reproduces the pre-fix failure.
- design.md Decision 3's line numbers (149/320/767) are stale relative to the final diff shape
  (actual current lines 149/335/782); harmless since I verified by content, but worth a note for
  future readers of this design doc.
