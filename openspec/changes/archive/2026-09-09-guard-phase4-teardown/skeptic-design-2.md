## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round 1's blocking CR1 is genuinely addressed.** Decision 2 now leads with the
script-owned lease and demotes the `/proc` probe with an explicit "best-effort,
does not cover an agent between tool calls" scope statement (design.md:80-96,
proposal.md bullets 1-2, spec.md "complementary process probe" requirement).
The demotion is stated in all three artifacts consistently, not just design.md.

**The two hooks are the only ones, and they really do bracket the auditor.**
- `grep -rn check-merge-readiness core/ test/ docs/` → the only *invocation* is
  `core/roles/auditor.md:54`; every other hit is prose, a comment, or the script's
  own test. No second caller would take a lease spuriously.
- `grep -rn "role=auditor" core/ test/` → exactly one hit,
  `core/roles/auditor.md:233`. No other emitter would release one spuriously.
- Citations in Decision 2 check out: auditor.md:54 passes `"$WORKTREE_PATH"` as an
  absolute arg (no `cd`), :230 likewise for persist-evidence, :204 is the
  harness-tool report write. The "cwd probe would have found nothing" argument
  holds.

**The ESCALATE/BLOCKER/ESCALATION-RAISE paths do emit a verdict.** auditor.md:215
puts the verdict line in the report template for all four values; :232-239 makes
the emit unconditional ("A verdict must always be emitted; it just carries no
`ref`"); :221 routes a pre-verdict environmental failure to a written BLOCKER
rather than a silent exit. ESCALATION-RAISE (:174-178) is explicitly stated to be
`emit-event.sh verdict`-emitted "no new emission path, no step skipped", and a
raise re-spawns a fresh auditor which re-runs the readiness script and re-acquires.
Release-on-verdict is therefore reached on every completing path.

**The CON-163 coverage claim holds — I checked the run, not the narrative.**
`.concertino/runs/CON-163/events.jsonl` (20 lines): verdict roles are
skeptic×4 + evaluator×1, **zero** `role=auditor`; `agent.spawn` only for executor
and evaluator. Finding 2 in Decision 2 is accurate. Separately,
`evidence/auditor-report.md` records `Condition 1-3 (check-merge-readiness.sh) —
PASS` and `Merged via gh pr merge 119`, so the readiness script demonstrably ran
before the kill → a lease would have been held → teardown would have refused.
Coverage claim CONFIRMED. (Note `check-merge-readiness.sh` emits no events itself,
so the event log alone could not have shown this; the recovered report is what
grounds it.)

**Release-at-emit is the right seam, positionally.** The auditor's last
worktree-touching action is the report write (:204), which precedes
persist-evidence (:230) and the emit (:232). Releasing at the emit closes the
window at the correct instant, not before.

**Decision 3 (settle window) is now one unambiguous rule** — 250 ms / 3 s, both
readings spelled out, Signal-B-only, with Signal A explicitly exempt
(design.md:98-104, spec.md, tasks 2.5). CR3 satisfied.

**Decision 4 parsing is now pinned to real code.** `core/scripts/cleanup.sh:40-48`
is exactly as cited: `--phase4` must be `$1`, else `CONCERTINO_PHASE4=1`; `:50`
binds `WORKTREE_PATH` from `${1:?}`, so the mistyped-flag hazard the design names
is real and the "fail on a remaining `--` argument" rule closes it. CR2 satisfied.

**Self-exclusion (CR4)** is pinned to the literal ancestor chain with the
vacuousness hazard recorded (design.md:88-90) and — the part that matters — task
4.3 requires the *positive* assertion that a sibling sharing an ancestor is still
detected. That is what makes the exclusion non-vacuous rather than merely claimed.

**Would the section-4 tests fail if a signal were removed?** Yes, and by two
independent routes: 4.5 requires explicit mutation of each of the two `cleanup.sh`
checks, and 4.1/4.2's paired scenarios (refuse-while-held / proceed-once-released;
holder-present / no-holder) would independently go red if acquire or release were
dropped. Adequate.

**Decision 6's factual claim verified:** `bash test/scripts/rendered-scripts-drift.test.sh`
→ exit 0, `18 passed, 0 failed`, and lines 55-56 of that test already exempt
`pricing-table.json` / `report-cost.sh` with a CON-173 reason. Direct-copy is
sufficient; no `concertino sync` needed.

**Routine-leak analysis (asked for explicitly).** I traced PENDING re-invocation,
FAIL→ESCALATE, ESCALATION-RAISE→respawn, agent-merge-disabled, and human-merge
fallback. None leaks. The leak that remains is an auditor killed before emitting —
which is the state the guard exists for, and Decision 4's override covers it. I do
not consider that a routine strand. Two narrower leak/no-op paths I do consider
defects are CR1 and CR2 below.

### Verdict: REFUTE

Three specific, cheap revisions. None re-opens the chosen mechanism — the lease is
the right call and the round-1 objection is closed. These close two silent
fail-open/strand paths in it and one inaccurate load-bearing sentence.

### Change Requests

1. **Pin how `cleanup.sh` resolves the lease root — the current plan can fail
   OPEN silently.** The two lease *writers* resolve the main checkout with
   `git rev-parse --git-common-dir` (`check-merge-readiness.sh:138`,
   `emit-event.sh:96`, deliberately, per emit-event.sh:37-39 "the MAIN checkout,
   never the worktree"). The *reader* has no such resolver: `cleanup.sh:129` sets
   `REPO_ROOT` from `git rev-parse --show-toplevel` **relative to its own cwd**,
   and `cleanup.sh:440` already uses `${REPO_ROOT}/.concertino/runs`. If the two
   resolvers ever disagree (cleanup invoked with cwd inside a worktree, or from a
   sibling checkout), the lease file is simply not found and the load-bearing
   guard silently permits the destructive operation — the exact class this design
   claims to eliminate. Nothing in design.md Decision 2, tasks 1.1/2.3, or the
   spec pins this: task 1.1's shared helper is scoped to "the path or format",
   which does not include the root each caller passes in.
   Required: state in Decision 2 and tasks 1.1/2.3 that the helper itself resolves
   the run root (the same `--git-common-dir` path the writers use, not
   `cleanup.sh`'s existing `REPO_ROOT`), and state what happens when the run
   directory cannot be resolved at all — fail closed, or proceed with an explicit
   "lease could not be checked" line, but say which. Same paragraph must cover the
   ticket-id input: `cleanup.sh:149` computes `T="${TICKET_ID:-${WORKTREE_PATH##*/}}"`
   and `TICKET_ID` is a documented-optional 4th argument, so the guard must be
   specified against `T`, with the basename-inference case (a `T` that is not a
   ticket id) named rather than left to become another silent no-op. Add a test to
   section 4 that acquires from one cwd and checks from another, since every
   scenario currently listed would pass under a wrong-root implementation.

2. **Specify release-vs-write ordering inside `emit-event.sh`, and document the
   side effect in its header.** `emit-event.sh` is built to fail silently — it
   "ALWAYS exits 0, including on internal error" (:52) and has early
   `exit 0` paths (e.g. `[ -z "$KIND" ] && exit 0` at :74) and its own
   ticket-validation guard before `RUN_DIR` is computed at :298. Task 1.3 says only
   "release the lease when writing a `verdict` event whose `role=auditor`", which
   leaves the case where the write is skipped or fails undefined. If release is
   placed downstream of the write, a silently-skipped event write strands the run
   behind a permanently-held lease that only `--force-teardown` clears — a strand
   caused by telemetry failing, which is precisely what this script promises never
   to do. Required: state that recognition of an auditor `verdict` invocation
   releases the lease regardless of whether the event write itself succeeds (the
   auditor is finished either way), that release never aborts or fails the call,
   and add a task to update `emit-event.sh`'s header comment block (:5-53, which
   currently describes it as pure telemetry) to document the lease release — an
   undocumented semantic side effect in a script documented as side-effect-free is
   how this guard rots out in a future refactor, which is a risk this design
   already names.

3. **Correct design.md:69's "in order, exactly once each".** It is false as
   written: `core/roles/auditor.md:80-85` requires re-invoking
   `check-merge-readiness.sh` up to **3 times** on a `PENDING` (exit 3) return, so
   the acquire hook runs 1-3 times on a normal healthy PR with slow CI. The
   mechanism survives this (tasks 1.2 already requires idempotent acquisition), so
   this is a wording fix, not a redesign — but round 1 refuted this design for
   overclaiming its guarantee, and the sentence carrying the whole "does not depend
   on any prompt" argument should not itself be inaccurate. Restate as "acquired on
   the auditor's first action and on each re-invocation, idempotently; released
   once, on the single terminal verdict emit", and note the CI-PENDING re-invoke as
   the reason idempotence is required rather than merely defensive.

### Non-blocking notes

- Task 3.3 forbids retrying with `--force-teardown` unilaterally, which is right,
  but there is no stated allowance for the ordinary benign recovery: the auditor
  finishes seconds later and releases the lease, at which point a plain re-run of
  `cleanup.sh --phase4` (no flag) would succeed. Consider saying so explicitly, so
  a refusal caused by a few seconds of overlap does not become a human interrupt
  by default.
- The lease content (task 1.1) records script/ticket/timestamp but no pid. An
  operator facing a refusal cannot distinguish "auditor alive right now" from
  "auditor died an hour ago" except by the timestamp's age. Recording the acquiring
  pid would make the refusal message decisively actionable at no cost.
- `test/scripts/check-merge-readiness.test.sh` drives the script repeatedly against
  synthetic repos and will now create lease files there as a side effect. Harmless
  (temp fixtures), but worth a glance under task 5.3 rather than a surprise.
