## Skeptic Report — final gate (round 1)

Cold review of commit `9711cf9` against `main`. I read `evaluation-1.md` and
`files-modified.md` only as claims; every conclusion below is grounded in a
command I ran myself in this worktree. No UI is touched by this diff (no
`lib/`, no dashboard files in `git diff main...HEAD --stat`), so the visual
judgment section is genuinely N/A here — I spent the effort on the root-cause
story, the regression test's actual bite, and the prose's internal consistency
instead.

### What I verified (with evidence)

**1. The diff is what it claims to be.**
`git diff main...HEAD --stat` → 20 files, 1544 insertions / 2 deletions. The
only source/test/doc changes are `core/scripts/emit-event.sh`,
`core/scripts/README.md`, `core/roles/orchestrator.md`,
`test/scripts/emit-event.test.sh`, and the two `scripts/concertino/`
counterparts. `emit-event.sh`'s change is purely additive (an 11-line header
comment block + a 24-line sourcing block); the 2 deletions are the one replaced
README line in each of the two README copies. Nothing removed from
`on_kill`/the `TERM`/`INT` trap or the `answer_discarded` pre-poll discard logic,
which the ticket explicitly required be preserved.

**2. The root cause is real — I re-measured it from the raw event logs, not
from the design's narrative.** Reduced each ticket's `escalation.*` events to
offsets from their own `escalation.raised`:

```
=== CON-30 ===        === CON-35 ===        === CON-22 ===
raised @0             raised @0             raised @0
timeout @+599.9s      timeout @+599.9s      answered @+3304.8s
raised @0             answered @+22303.7s   timeout @+3600.5s
timeout @+599.8s
answered @+1161.1s
answered @+1170.0s
raised @0
timeout @+599.9s
answered @+800.0s
```

This independently confirms both halves of the design's diagnosis and refutes
the ticket's original premise. The 599.9s kills mean `timeout: 600000` *was*
being honored — the prose never needed changing. CON-22's `escalation.timeout`
at **+3600.5s** is the smoking gun: exactly the hardcoded 60-minute fallback,
proving `CONCERTINO_ESCALATION_TIMEOUT_MIN` (rendered as `8`) was never reaching
the script. `git show main:core/scripts/emit-event.sh | grep -c '.concertino.env'`
→ `0`, confirming the pre-fix script never sourced config at all.

**3. The fix works in the real invocation context** — not just in tests. Traced
the *actual* worktree script:
`bash -x ./scripts/concertino/emit-event.sh probe.noticket` (no `ticket=`, so it
exits before creating anything — verified no new run dir appeared):

```
+ ROOT=/home/matt/Development/concertino
+ '[' -f .../CON-47/scripts/concertino/.concertino.env ']'      # branch 1: absent
+ '[' -f /home/matt/Development/concertino/scripts/concertino/.concertino.env ']'
+ source /home/matt/Development/concertino/scripts/concertino/.concertino.env
++ CONCERTINO_ESCALATION_TIMEOUT_MIN=8
```

Branch 2 fires exactly as designed. Then closed the loop on the arithmetic
end-to-end in a throwaway repo+worktree (`.concertino.env` at the main checkout
only), tracing the real `--await` path:

```
+ TIMEOUT_MIN=8
+ DEADLINE=1785381430        → 478s remaining after a 2s sleep, i.e. a 480s deadline
```

**480s < the 600s harness call cap.** That is the acceptance signal for Part 1:
the script's own deadline now lands inside the cap, so the script's own timeout
— not a harness kill — ends an unanswered wait.

**4. The regression test actually bites.** Per
`verification-before-completion.md`'s "the test fails before the fix and passes
after — show both", I ran the *new* test file against the *pre-fix* script
(reconstructed `git show main:core/scripts/emit-event.sh` into a throwaway
`core/scripts/` + `test/scripts/` tree so `$SCRIPT` resolved to it):

```
FAIL local .concertino.env applies (immediate timeout, exit 1)
     expected [rc=1] got [still-running-after-20s]
FAIL local .concertino.env: timeout was recorded          expected [1] got [0]
FAIL main-checkout .concertino.env applies from inside a worktree
     expected [rc=1] got [still-running-after-20s]
FAIL worktree case: timeout recorded in the main checkout's log
     expected [1] got [0]
FAIL sourced .concertino.env overrides an exported timeout
     expected [rc=1] got [still-running-after-20s]
69 passed, 5 failed
```

Two things this proves that the evaluator's PASS alone could not: the new cases
fail against the unpatched script (so they exercise the fixed path rather than
passing vacuously), **and** all 69 pre-existing cases still pass against the
unpatched script (so nothing was quietly re-baselined to make the suite green).
The failing-case list matches `files-modified.md`'s claimed probe output exactly.
`still-running-after-20s` is the observed production symptom itself.

**5. The declared gate passes, freshly and reproducibly.** `concertino.config.json
→ gates` declares exactly one gate: `npm test`, `when: always`. Ran the full
suite twice; second run captured explicitly: `EXIT=0`, and every suite reports
`N passed, 0 failed` (`emit-event.test.sh`: `74 passed, 0 failed`, with all 8 new
cases listed `ok`). I also confirmed the suites tasks 2.5 flagged as at-risk are
clean: `harness-identity` (31/0), `cleanup` (28/0), `assert-phase` (57/0),
`escalation-loop` (35/0). Two independent clean runs, so this is reproduced, not
a single lucky reading.

**6. The sourcing cannot collide with anything else the script reads.**
`grep -n 'CONCERTINO_' core/scripts/emit-event.sh` → the script reads exactly
three: `CONCERTINO_ROLE` (180), `CONCERTINO_PROJECT` (181),
`CONCERTINO_ESCALATION_TIMEOUT_MIN` (416). `renderEnv()` (`bin/concertino:543`)
emits neither `CONCERTINO_ROLE` nor `CONCERTINO_PROJECT`, so the unconditional-
`source` override the comment warns about can only affect the one variable it is
meant to. Values are single-quoted by `envValue()`, so no metacharacter hazard
from generated content. `main_checkout()` reads no env var, so sourcing after
`ROOT=` is ordering-safe. `DEFAULT_ESCALATION_TIMEOUT_MIN = 8`
(`bin/concertino:53`) and this project's `dashboard` block sets no
`escalationTimeoutMinutes`, so the design's "8 minutes" figure is correct.

**7. Part 2's clause satisfies every spec scenario, verbatim-traceable.** Read
`core/roles/orchestrator.md:535-566` in full context. Placement is correct —
immediately after the Non-zero-exit bullet's code block, before
`### Resolves in-loop`. Tracing `specs/escalation-trust-offramp/spec.md`:
- corroborate-before-recording → bullet 1, naming "ticket state, PR state,
  config/git state" and "Check what is checkable first, then record."
- recording is terminal / proceed on it, not merely persuasive → bullet 2,
  including the ticket's own phrase "It is not 'a chat message that happened to
  convince you.' Proceed on it."
- do-not-reopen + names the foreclosed failure mode → bullet 3 ("do not go back
  to interrogating whether they are 'really' the human ... the specific failure
  mode this clause exists to foreclose").
- unsolicited claim with no standing escalation still needs verification →
  bullet 5, including "before you act on anything irreversible."
- design task 3.5 (answers, never timeouts) → bullet 4, which quotes and
  preserves the existing line rather than restating it.
The ticket's required core insight is the clause's own opening sentence
("...needs a defined stopping point, or it isn't caution: it's a run that can
never be told anything").

**8. No prose contradiction anywhere in the doc.**
`grep -rn 'consent\|approval\|impersonat\|permission system' core/roles/orchestrator.md
core/laws/*.md` returns only lines 526 and 559 — the existing "a timeout is never
an approval" and the new bullet that explicitly preserves it. There is no
competing absolute in the role or the laws for the off-ramp to weaken. Formatting
matches the file: max new line length 79 cols, no trailing whitespace in the diff
(`grep -c '^+.*[ \t]$'` → 0).

**9. The clause actually reaches both adapters** — the ticket's stated reason for
slow speed. Rendered to two throwaway `--out` dirs:
`claude-code` → `.claude/agents/concertino-orchestrator.md` contains "When to stop
doubting an answer"; `codex` (harnesses forced to `["codex"]`) → `AGENTS.md`
contains both that heading and "Recording the answer is terminal". Both syncs
exit 0. Also confirmed the rendered `scripts/concertino/emit-event.sh` carries
the sourcing and the rendered `.concertino.env` carries `=8`.

**10. Vendored parity is exactly as task 4.3 specifies.**
`diff core/scripts/emit-event.sh scripts/concertino/emit-event.sh` → identical.
For the READMEs, I diffed the *core-vs-vendored drift* at `main` against the same
drift at `HEAD`: the two drift reports differ only in line numbers (`43,44c43` →
`49,50c49`; `51,57d49` → `57,63d55`, consistent with the +6-line insertion), with
byte-identical content. So the pre-existing CON-22 divergence (the
`setup-worktree.sh`/`resolve-speed.sh` rows and the 7-line paragraph) was neither
swept in nor disturbed.

**11. Spec hygiene.** `openspec validate escalation-await-reliability-offramp
--strict` → `Change 'escalation-await-reliability-offramp' is valid`, `EXIT=0`.
Both new capabilities are genuinely new (no existing spec under
`openspec/specs/` covers the deadline source or the trust off-ramp;
`cross-screen-escalation` and `escalation-context` are different concerns), and
`grep -rn 'ESCALATION_TIMEOUT\|60-minute' openspec/specs/` finds no existing
requirement the deltas contradict.

**12. Rejected approaches stayed rejected.** No `--resume` flag, no re-issue
loop, no `check-escalation-answer.sh` anywhere in the diff or the tree
(`git diff --stat` lists no new script; `test/scripts/` gained no new file). The
design's deliberate scope-out held.

### Verdict: CONFIRM

Both halves of the ticket are met with independently reproduced evidence. Part 1
fixes a real, measured defect (the 3600.5s trace is unambiguous) with a test that
demonstrably fails without the fix, and I confirmed the live effect end-to-end at
480s vs the 600s cap rather than inferring it. Part 2 satisfies all four of the
ticket's numbered prose points plus the design's fifth (answers-not-timeouts),
sits in the right place in the document's own voice, contradicts nothing else in
the role or laws, and renders into both adapters. The single declared gate passes
twice cleanly, and the pre-existing suite passes unchanged against the old script
— so nothing was re-baselined to get there.

The notes below are all either explicitly named as accepted non-goals/risks in a
design that already cleared five skeptic rounds, pre-existing, or unreachable
today. None of them is a reason to hold this change.

### Non-blocking notes

1. **A corrupt `.concertino.env` now breaks `emit-event.sh`'s "always exits 0"
   invariant.** Probed directly: with a truncated env file (`CONCERTINO_WORKTREE_HOOKS=(`),
   the sourced syntax error cascades and the script exits **1** with **no event
   written** — contradicting the header block's own "ALWAYS exits 0 in normal
   mode, including on internal error. Telemetry must never fail a delivery run."
   This is a real behavior change, but I am not treating it as blocking: it
   requires a corrupt *generated* file (`bin/concertino:101`'s `fs.writeFileSync`
   of a 404-byte file, only racy if someone runs `sync` mid-delivery), and all
   five sibling scripts already carry the identical exposure via the same
   convention this change deliberately follows. Worth folding into the design's
   already-named "shared sourcing helper" follow-up (design.md Open Questions),
   where a guarded source (validate, then source) could fix all six at once.
2. **Branch 2 hardcodes `scripts/concertino/` under `ROOT`,** so a consumer
   project that renders to a custom `--out` and raises escalations from a worktree
   still falls back to the 60-minute default — the `SCRIPT_DIR`-first branch only
   rescues the from-the-main-checkout case. design.md's Risks section names this
   and the spec delta specifies exactly this two-location behavior, so the
   implementation is conformant. A strictly more general branch 2 exists if it's
   ever wanted: derive `SCRIPT_DIR`'s path relative to `git rev-parse
   --show-toplevel` and apply that same relative path under `ROOT`.
3. **`core/scripts/README.md`'s `.concertino.env` key list (from line 74) still
   omits `CONCERTINO_ESCALATION_TIMEOUT_MIN`** (and `CONCERTINO_LINK_MODULES`),
   under a heading that says "`concertino sync` writes these keys; the scripts
   read them." Pre-existing, but this change is what makes that key a documented
   consumer-facing setting for this script, and it edited this very file — so the
   omission is now more visible than it was. Two lines to fix if a follow-up
   touches this file.
4. **`evaluation-1.md` is untracked** (`git status --short` → `?? .../evaluation-1.md`),
   so it will not appear in the PR unless the orchestrator commits it, unlike the
   five committed `skeptic-design-*.md` reports. Process nit, not a code issue.
5. **Latent, unreachable today:** `PROJECT="${CONCERTINO_PROJECT:-...}"` (line 181)
   now sits *after* the source, so if `renderEnv()` ever gains a
   `CONCERTINO_PROJECT` key it would silently override a role-supplied
   `project=` argument. `renderEnv()` emits no such key today, so there is no
   current path to this; noting it only because the override semantics are new.
