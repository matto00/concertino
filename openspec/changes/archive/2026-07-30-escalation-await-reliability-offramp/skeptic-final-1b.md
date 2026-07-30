## Skeptic Report — final gate (round 1, second independent skeptic)

Written to `skeptic-final-1b.md` rather than `skeptic-final-1.md`: the first
independent skeptic's report already occupies that path. I did not read it, the
evaluator's `evaluation-1.md`, or `files-modified.md` before deriving my own
conclusions from ground truth; `files-modified.md` was read only at the end, as
a claim to cross-check against what I had already measured.

Commit under review: `9711cf9` (`git diff main...HEAD`, 20 files, +1544/-2 —
of which only 6 are source/test/doc files; the rest are the change dir).

### What I verified (with evidence)

**1. The diff is exactly the two decisions, nothing else.**
`git diff main...HEAD --stat` → source changes confined to
`core/scripts/emit-event.sh` (+35), `core/roles/orchestrator.md` (+32),
`core/scripts/README.md` (+8), `test/scripts/emit-event.test.sh` (+97), and the
two `scripts/concertino/` vendored counterparts. No `--resume`, no
`check-escalation-answer.sh` — the two approaches design.md's "Rejected
approaches" scoped out are genuinely absent from the diff, not smuggled in
under another name.

**2. Root cause is real and independently re-measured (systematic-debugging).**
I did not take the design's trace measurements on faith. Parsed the real event
logs myself (`.concertino/runs/<T>/events.jsonl`, raised→resolution deltas):

```
CON-30 raised->timeout 599.9s   CON-30 raised->timeout 599.8s
CON-30 raised->timeout 599.9s   CON-35 raised->timeout 599.9s
CON-22 raised->timeout 3600.5s
```

Four kills at 599.9s (the harness's 600s cap *was* being honored — the ticket's
original premise that `timeout: 600000` wasn't being set is false, and its
quoted 450/510/990s figures do not appear in the logs at all), and CON-22's
3600.5s is the 60-minute hardcoded fallback running to completion. That is
direct confirmation of the actual defect: `CONCERTINO_ESCALATION_TIMEOUT_MIN`
never reached the script.

**3. The fix works in the real invocation context** — the one thing a hermetic
test cannot prove. Traced the *committed* script from inside this worktree
(`bash -x ./scripts/concertino/emit-event.sh note`; `note` with no `ticket=`
exits 0 at line 221 without writing any event, so this probe is side-effect
free):

```
+ SCRIPT_DIR=.../CON-47/scripts/concertino
+ ROOT=/home/matt/Development/concertino
+ '[' -f .../CON-47/scripts/concertino/.concertino.env ']'      <- branch 1 misses
+ '[' -f /home/matt/Development/concertino/scripts/concertino/.concertino.env ']'
+ source /home/matt/Development/concertino/scripts/concertino/.concertino.env
++ CONCERTINO_ESCALATION_TIMEOUT_MIN=8                          <- branch 2 fires
```

Same probe against `git show main:scripts/concertino/emit-event.sh` in the same
cwd: **0** lines matching `concertino.env|ESCALATION_TIMEOUT` — the defect and
the fix, before/after, in the live environment. 8 minutes lands inside the
10-minute harness cap, which is the whole point of Part 1. Also confirmed the
worktree genuinely has no `.concertino.env` of its own (`ls` → no such file),
so branch 2 is load-bearing here, not decorative.

**4. Ordering is correct.** Sourcing is at lines 172–177; `TIMEOUT_MIN=
"${CONCERTINO_ESCALATION_TIMEOUT_MIN:-60}"` is line 416 and `DEADLINE` line 417.
The value can actually reach the deadline arithmetic.

**5. The override side-effect cannot clobber anything that matters.**
`emit-event.sh` reads exactly three env vars (`grep -oE '\$\{?CONCERTINO_[A-Z_]+'`):
`ESCALATION_TIMEOUT_MIN`, `PROJECT`, `ROLE`. `ROLE`/`PROJECT` are read *after*
the source (lines 180–181), so an unconditional `source` could in principle
rewrite every event's attribution. It cannot: `renderEnv()` in `bin/concertino`
(lines 543–565) never emits `CONCERTINO_ROLE` or `CONCERTINO_PROJECT` — the
rendered key set is base-branch/worktree/ports/env-files/link-modules/hooks/
harness/escalation-timeout/dev-servers only, and the live
`scripts/concertino/.concertino.env` matches. Verified, not assumed. No prose
or script anywhere passes `CONCERTINO_ESCALATION_TIMEOUT_MIN` inline in
production (only tests do), so the file-wins precedence breaks no existing
caller.

**6. The one configured gate passes, run fresh by me.** `concertino.config.json
→ gates` declares a single gate: `test` / `when: always` / `npm test`. Ran it in
full in the worktree: **exit 0**, every suite `N passed, 0 failed`, with
`emit-event.sh 74 passed, 0 failed`.

**7. The new tests are real regression tests, not decoration (mutation-tested).**
Built a scratchpad layout with the *unpatched* (`main`) script and the *new*
test file, since the suite resolves `$SCRIPT` from its own location:

```
FAIL local .concertino.env applies (immediate timeout, exit 1)
FAIL local .concertino.env: timeout was recorded
FAIL main-checkout .concertino.env applies from inside a worktree
FAIL worktree case: timeout recorded in the main checkout's log
FAIL sourced .concertino.env overrides an exported timeout
67 passed, 7 failed
```

All five CON-47 cases fail without the fix. Two *other* failures ("oversized
context") looked alarming, so I reproduced rather than concluded: the same
scratchpad layout with the *patched* script also fails exactly those two
(`72 passed, 2 failed`), and both pass in-repo under `npm test`. They are an
artifact of running the suite outside the real tree, not a regression — a single
anomalous reading, re-run and explained. Net delta attributable to the fix:
exactly the 5 new cases.

**8. Test isolation is genuinely sound, and the worktree case genuinely
exercises a worktree.** The pre-existing cases at lines ~154 and ~237 pass
`CONCERTINO_ESCALATION_TIMEOUT_MIN=0` as a process env var from inside
`cd "$REPO"` throwaway repos — so `ROOT` resolves to the throwaway, neither
branch finds a file, and the exported `0` still wins (why they still pass). The
new cases use `script_copy()`/`mktemp -d` so no `.concertino.env` is ever
written into `core/scripts/`. I also confirmed the 2.2 setup really creates a
*linked* worktree (replicated it: `rev-parse --git-common-dir` →
`<repo>/.git`, `--git-dir` → `<repo>/.git/worktrees/wt`), so the case does
exercise the `--git-common-dir` mechanism it claims to.

**9. Ticket-mandated invariants preserved.** The ticket requires "preserve
`on_kill`'s trap-based `escalation.timeout` recording and the
`answer_discarded` handling." The diff touches nothing in that region (two
additive hunks only: header comment, sourcing block); `trap on_kill TERM INT`
(line 395), the `trap - TERM INT` clears (431, 448) and
`write_line escalation.answer_discarded` (412) are untouched, and their tests
(emit-event.test.sh TERM-kill, INT-kill, stale-answer-discard cases) pass.

**10. Vendored copies are exactly what `sync` would produce — verified by
rendering, not by trusting the hand-copy.** Rendered a fresh tree
(`node bin/concertino sync --out=<tmp> --config=concertino.config.json`):
`scripts/concertino/emit-event.sh` is **byte-identical** to the tracked copy.
`scripts/concertino/README.md` differs from the rendered output by exactly three
hunks (the `setup-worktree.sh` row, the `resolve-speed.sh` row, the 7-line
`resolve-speed.sh` paragraph) — byte-for-byte the same divergence that already
existed on `main` (`git diff main:core/scripts/README.md
main:scripts/concertino/README.md`). No new drift, and the CON-22 drift task 4.3
warned about was not swept in. `node bin/concertino diff` reports `0 changed`.
Also confirmed the off-ramp clause actually reaches the rendered artifact:
`.claude/agents/concertino-orchestrator.md` in the fresh render contains "When
to stop doubting an answer" plus all four distinguishing bullets.

**11. Acceptance criteria, traced one by one.** (Pulled CON-47 from Linear —
its description matches `ticket.md` verbatim, no separate AC field; ACs are the
ticket's own stated requirements.)

| AC | Evidence |
| --- | --- |
| P1: measure against real traces before changing the prose | Re-measured in §2; prose left unchanged, correctly — `orchestrator.md`'s `timeout: 600000` instruction was being followed |
| P1: technical fix so the wait isn't cut short | §3 — configured 8 min now applies inside the 10-min cap, live-traced |
| P1: preserve `on_kill` + `answer_discarded` | §9 |
| P2.1 corroborate against ground truth before recording | orchestrator.md:540–543 |
| P2.2 recording is terminal for this run | orchestrator.md:544–549 (names both `answer.json` and the manual fallback) |
| P2.3 do not reopen; name the foreclosed failure mode | orchestrator.md:550–556 ("do not go back to interrogating whether they are 'really' the human") |
| P2.4 does not cover an unsolicited claim with no standing escalation | orchestrator.md:561–565 (requires `escalation.raised` standing open) |
| P2: the one-line insight, in the doc's own voice | orchestrator.md:535–538 ("it isn't caution: it's a run that can never be told anything") |
| Notes: both parts ship together | Single commit `9711cf9`, one PR |

Both spec deltas (`escalation-deadline-source`, `escalation-trust-offramp`) are
new capabilities with no existing `openspec/specs/` counterpart, so `## ADDED
Requirements` is the right header; every clause in both specs is satisfied by
the code/prose above. All 30 tasks are `[x]` and I spot-verified the
non-obvious ones (4.1/4.3 in §10, 2.1–2.3 isolation in §8).

**12. Prose judgment (my domain here — no UI in this change).** Placement is
right: it sits immediately after the Exit 0 / Non-zero bullets, where a reader
handling an answer already is, rather than being exiled to Guardrails. Voice
matches the surrounding document (bolded imperative lead-ins, mechanism-grounded,
no abstract policy language). The "This covers answers, never timeouts" bullet
resolves what would otherwise be the one real tension in the section by
explicitly re-affirming the existing "**a timeout is never an approval**" rather
than talking past it. I searched `core/roles/` and `core/laws/` for any
contradicting instruction about relayed claims of human approval — there is
none, so the clause creates no conflict. Side benefit worth naming: the fix
makes `orchestrator.md`:511–513 and `docs/dashboard.md`:169–174, both of which
already *asserted* that `--await`'s deadline is shorter than the call timeout,
true for the first time — no doc change was needed, and correctly none was made.

### Verdict: CONFIRM

The measured root cause is real, the fix is proven in the live worktree (not
just in a hermetic test), the tests fail without it, the single configured gate
passes fresh, the vendored copies match a real render, every AC traces to
specific code or prose, and the deliberately-rejected mechanisms stayed out.

### Non-blocking notes

- **`elif` leaves one configuration uncovered.** A project rendering to a
  non-default `--out` (say `tools/concertino/`) and raising an escalation from a
  worktree misses branch 1 (worktree copy has no env file) and branch 2 (which
  hardcodes `scripts/concertino/`), silently falling back to 60 minutes — the
  original bug, in a rarer shape. Named in design.md's Risks and accepted. A
  future hardening would be to map `SCRIPT_DIR`'s path *relative to the worktree
  root* onto `ROOT`, instead of hardcoding the default layout.
- **A stray `core/scripts/.concertino.env` would hang the test suite for an
  hour.** The pre-existing cases invoke `$SCRIPT` in place, so a file dropped
  there would fire branch 1 and override their exported `0`. The new test
  comment explains the hazard, but nothing enforces it (`.gitignore` only
  ignores `scripts/concertino/.concertino.env`). A one-line guard at the top of
  the suite — fail fast if `core/scripts/.concertino.env` exists — would make
  the invariant self-defending.
- **Test 2.4 is a weak-but-honest proxy.** "still-running-after-3s" would also
  pass with a 4-minute deadline; it is only really asserting "did not pick up 0
  from nowhere." Fine as written (the comment says so), and the paired
  "raised but not timed out" check backs it up.
- **2.2 doesn't assert its own precondition.** If `git worktree add` ever
  failed, `mkdir -p "$REPO/wt/..."` would leave a plain subdirectory, `ROOT`
  would resolve to `$REPO` anyway, and the case would still pass while no longer
  exercising the worktree path. It does work today (verified in §8); a
  `rev-parse --git-dir` assertion would keep it honest.
- **`escalationTimeoutMinutes` has no upper-bound guard.** The schema
  (`config/concertino.schema.json`:125) says "keep this comfortably under" the
  ~10-minute cap in prose only, `minimum: 0`, no validation. Now that the value
  actually takes effect, a project setting 60 reproduces the original failure
  from config alone. A `concertino validate` warning above ~9 minutes would be a
  cheap follow-up.
- **The off-ramp's terminality is bounded by corroboration that may not exist.**
  Bullet 1 says corroborate "wherever any exists"; when nothing is checkable, a
  relayed claim against a standing escalation can still be recorded and thereby
  become terminal. That is precisely what the ticket asked for (its point 2, and
  the CON-30 precedent it cites), so it is intent rather than defect — but it is
  the seam a future ticket would examine if this ever gets exploited or
  mistaken. Also, bullet 1 is really about the chat path only: on the exit-0
  dashboard path the script records the answer and there is no claim of human
  intent to corroborate. Harmless as phrased ("wherever any exists"
  self-limits).
