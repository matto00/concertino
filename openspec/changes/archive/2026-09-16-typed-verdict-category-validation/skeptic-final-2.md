## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-review. HEAD reviewed: `dc00be6fa77b33f517ed818868b8b039295c0335`. Round 1
CONFIRMED at `b7d079c...`; this round exists solely because HEAD moved (an
owner-authorized cycle-4 fix-inline for a pre-existing, unrelated CI flake).
Verified independently from ground truth in a full scratch `git clone
file:///home/matt/Development/concertino` (never a partial copy — confirmed
`test/scripts/lib/wait-bounded.sh` needs real `BASH_SOURCE`-relative repo
layout).

### What I verified (with evidence)

1. **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=.../helio
   branch=task/typed-verdict-category-validation/CON-189` — proceeded.

2. **Diff base resolved live**, not hand-computed: `resolve-review-base.sh`
   → `d246b703059e8b8e5ecea6de31c8e46491edacac`, exit checked. `git diff
   d246b70...HEAD --stat` shows exactly the expected 28-file, 2189-insertion
   diff spanning the CON-189/187/194 substantive change plus the cycle-4
   test-only fix. `git status` in the worktree shows only
   `workflow-state.md` modified (orchestrator bookkeeping) and
   `evaluation-4.md` untracked — nothing else drifted.

3. **Cycle-4 fix is exactly the claimed one-line surgical change**: `git diff
   dc00be6~1 dc00be6 -- test/scripts/emit-event.test.sh` shows only the
   16-line bounded poll inserted between the existing `kill -KILL`/`wait` and
   the self-test's `assert_children_dead` call. No other file in that commit.

4. **Assertion is still failable — re-derived independently, own mutation.**
   In the scratch clone, checked baseline green (`bash
   test/scripts/emit-event.test.sh` → all 4 self-test lines `ok`). Then
   removed the `kill -KILL "$LEAKY_CHILD"` / `wait` lines entirely (so the
   leaky child is never actually killed) and re-ran: line 111's assertion
   went `FAIL self-test: after cleanup, assert_children_dead reports it
   gone`. Reverted; back to green. This is a different, independently-chosen
   mutation from both the executor's, the evaluator's (`"$$"` substitution),
   and round 1's — same conclusion by a third method: the assertion is a
   real, failable check, not vacuous.

5. **Stability**, 3 clean runs of the full `emit-event.test.sh` suite in the
   scratch clone (unpinned, no load): 0 failures each time.

6. **Bounded condition wait vs. magic constant.** Read `children_alive()` /
   `assert_children_dead()` / `wait_killed_bounded()` in
   `test/scripts/lib/wait-bounded.sh` directly. The cycle-4 fix polls
   `children_alive "$LEAKY_CHILD"` for emptiness at 0.1s resolution, 50
   iterations (5s cap), breaking early — a genuine condition-driven bounded
   wait, matching the file's own pre-existing "wait for the child to appear"
   idiom a few lines above it (not a fixed sleep, not a constant sized below
   its own poll period per CON-200's precedent).

   On the evaluator's argument that `wait_killed_bounded` would be the wrong
   helper here: I find this correct but understated as a "correctness"
   argument — `wait_killed_bounded` performing its own idempotent re-`kill
   -KILL` on timeout would in fact be harmless if reused here (the process
   is already dead in the success path, and SIGKILL-ing an already-dead PID
   is a silent no-op). So the stronger reason to prefer the inline
   `children_alive` loop is DRY-consistency-with-the-file's-own-idiom and
   honesty about what's actually being awaited ("has the kernel reaped it,"
   not "kill it and wait"), not that reuse would have been *incorrect*. This
   is a documentation/precision nit only, not a defect — recorded as a
   non-blocking note below.

7. **Sibling assertions — confirmed by direct grep**, not trusted from any
   report: `grep -n assert_children_dead test/scripts/emit-event.test.sh`
   returns exactly 3 hits — the self-test (line 111, fixed) and two real
   `--await` sites (lines 294, 315), each immediately preceded by its own
   `wait_killed_bounded "$AWAIT_PID" 10` call (lines 287, 308). No sibling
   shares the defect; the one-assertion diff is correctly scoped. (Also
   confirmed `escalation-loop.test.sh` has no `assert_children_dead` calls
   at all, only `wait_killed_bounded`.)

8. **Full `npm test`, run fresh in the actual worktree** (not the scratch
   clone): exit 0, full ~50-suite serial chain, no `-n`, ran to completion —
   `/tmp/npmtest_skeptic_r2.log`, tail confirms `exit=0`, zero `^  FAIL` /
   `^not ok` lines anywhere in the log.

9. **Substantive CON-189/187/194 change re-confirmed at this SHA** (not
   assumed unchanged from round 1, though it is):
   - `git diff b7d079c dc00be6 -- core/scripts/emit-event.sh
     scripts/concertino/emit-event.sh` — empty. Byte-identical since cycle 1.
   - CON-171 lease placement: read `core/scripts/emit-event.sh` lines
     399-471 directly. `lease_release` for `role=auditor` verdicts fires at
     line 411, strictly before the verdict-field-validation block (414-471)
     that can `exit 1` — a refused auditor verdict still releases its
     Phase-4 lease, exactly as claimed.
   - CON-187: stated-only validation confirmed at lines 447-456 — the
     40-hex-char regex only fires `if [ -n "$HEAD_SHA" ]`; an omitted SHA is
     untouched.
   - CON-194: `gate` required only for `role=skeptic` verdicts, confirmed at
     lines 458-470; evaluator/auditor verdicts unaffected.
   - `core/scripts/emit-event.sh` vs `scripts/concertino/emit-event.sh`:
     `diff` returns clean, both `-rwxr-xr-x`, identical byte size (56463) —
     render parity confirmed, rendered copy executable.
   - `test/scripts/check-merge-readiness.test.sh` and
     `test/scripts/rendered-scripts-drift.test.sh` both pass inside the
     already-confirmed full `npm test` run above (no separate targeted rerun
     needed given the full-chain green).

10. **CON-187 premise correction, verified against the actual consumer.**
    Read `check-merge-readiness.sh`'s `stale_check()` (lines 450-471):
    resolution is via `git cat-file -e "${reviewed}^{commit}"`, which git
    resolves for any unambiguous abbreviation (including a 39-char string) —
    so the ticket's original claim that a short SHA silently mis-attributes
    a verdict is false for this consumer, as already disclosed. The
    independent defect (zero format validation; ~3 malformed SHAs found in
    the helio corpus) stands on its own regardless of the premise
    correction, so rejecting a malformed stated `head_sha` remains the right
    response — not undermined by the corrected premise.

11. **CON-194 orchestrator-prohibition widening, read directly.** `git diff
    d246b70..dc00be6 -- core/roles/orchestrator.md` shows the rule widened
    from "never emit `verdict role=skeptic`" to "never emit a `verdict`
    event yourself, for any role, gate, or outcome," citing the HEL-1109
    double-log-entry incident as the reason the narrower rule was
    insufficient, with `role=` being caller-asserted (unenforceable to check
    by the emitter) as the reason a role-based rejection at the emitter
    layer was correctly judged unimplementable. This is a faithful widening,
    not an under-delivery dressed as an impossibility argument — the
    implemented `gate`-required-for-skeptic-verdicts check gives a real,
    mechanically-enforced signal (duplicate-verdict detectability) that a
    role check could not have given anyway, since role is unverifiable at
    this layer.

12. **Disclosed data-quality limitation (item 7 of the brief).** This
    reviewed change validates category **membership** (one of the 4 legal
    values), not semantic **appropriateness**. Round 1's self-disclosed
    `category=intent-mismatch` on a CONFIRM where `mechanical` would have
    been correct is exactly the shape of gap this implies. I judge this
    acceptable as shipped: the spec's own explicit prohibition on rewriting
    history is the correct call (an audit trail that could be silently
    "corrected" after the fact is a worse property than an occasional
    mis-picked category), and a purely mechanical enum-membership check is
    what CON-189's acceptance criteria actually asked for. This does not
    need role-doc sharpening to clear this gate — it is a known,
    accepted-forever tradeoff, not a defect in this diff.

### Gate defect check (per role brief)

I did not find any report in this chain (evaluation-1..4, skeptic-design-1,
skeptic-final-1) that asserts an mtime-ordering claim as self-evidently
reliable without independent corroboration. Evaluation-4's before/after rate
claims are corroborated by the evaluator's own freshly-run, PID-tracked,
`taskset`-pinned trials (not mtime inference), and I additionally re-derived
the core failable-assertion claim with my own independent mutation. No gate
defect to record on this axis for this round.

### Verdict: CONFIRM

The cycle-4 fix is scoped, correctly targets the actual root cause (a
grandchild PID that `wait` cannot block on), is genuinely bounded and
condition-driven, and does not touch the emitter or any of the substantive
CON-189/187/194 behavior already reviewed and shipped. I independently
reproduced both the fixability of the flake (mutation → RED) and the
substantive change's correctness at this exact SHA, using my own probes
rather than trusting any prior agent's narrative.

### Non-blocking notes

- The comment justifying "not `wait_killed_bounded`" (wait-bounded.sh usage
  site, emit-event.test.sh ~line 100-108 vicinity) argues the helper "would
  be wrong" here; more precisely it would be *redundant but harmless* (its
  own re-`kill -KILL` on an already-dead PID is a no-op), and the real
  reason to prefer the inline poll is idiom-consistency and honesty about
  what's being awaited. Not worth a revision — purely a precision-of-comment
  nit, no behavioral effect.
