## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Read fresh, cold: ticket.md, proposal.md, design.md, tasks.md,
specs/spawn-cwd-guard/spec.md. Prior rounds' reports were read only to extract
their *counterexamples* for re-tracing; no conclusion below is inherited from them.

### What I verified (with evidence)

**1. Decision 1's collision logic against both prior rounds' counterexamples — HOLDS.**

- *(a) Correct spawn.* Measured live against **this very skeptic invocation**:
  `pwd` in my first Bash call = `/home/matt/Development/helio`; my
  `WORKTREE_PATH` = `/home/matt/Development/concertino/.concertino/worktrees/bug/spawn-cwd-guard/CON-174`.
  `BASE` (3 up) = `/home/matt/Development/concertino/.concertino/worktrees`.
  Ambient is not under `BASE` → collision check tolerates → branch check on
  `WORKTREE_PATH` itself → **READY**. Round 2's helio-internal ancestor case
  (`/home/matt/Development/helio` vs `.claude/worktrees/task/.../HEL-…`,
  `BASE` = `/home/matt/Development/helio/.claude/worktrees`) traces identically:
  ancestor of `BASE`, not descendant → **READY**. Round 2's refutation is answered.
- *(b) Live incident.* Two lanes under one base. Confirmed on disk that helio
  really does nest this way (`git worktree list`:
  `/home/matt/Development/helio/.claude/worktrees/task/verify-preview-datagrid-layout/HEL-1056`),
  and `concertino.config.json:21` sets `worktree.base = .claude/worktrees`.
  Ambient = lane 1's worktree → under `BASE`, not under lane 2's `WT` →
  **FAIL cwd-mismatch**. Round 1's refutation is answered.

  The two constraints are now jointly satisfied. **Decision 1 is sound and I am
  not refuting it.**

**2. `BASE` = three-levels-up — correct for this run, but a heuristic where an
exact derivation is available.** Verified against ground truth:
`core/scripts/setup-worktree.sh:250` constructs
`WORKTREE_PATH="${REPO_ROOT}/${WORKTREE_BASE}/${BRANCH}"` literally. Against this
run both derivations agree (`/home/matt/Development/concertino/.concertino/worktrees`).
But the equality holds only while `BRANCH` has exactly 3 segments. Off-convention
worktrees demonstrably exist on disk today — `git worktree list` shows
`/home/matt/Development/helio/.claude/worktrees/task/matt-audit-repo`, a
**2-segment** branch. Confirmed `scripts/concertino/.concertino.env` is
gitignored (`.gitignore:10`) and absent from the worktree, so reading
`CONCERTINO_WORKTREE_BASE` is genuinely unavailable here — the design was right
not to use it. However `BRANCH` is already an `assert-cwd.sh` argument, so
`BASE="${WORKTREE_PATH%/$BRANCH}"` is exact, needs no new input, and is invariant
to segment count. See CR2.

**3. Decision 2's call-site enumeration is WRONG — reproduced.** This is the
blocking finding. Two independent greps over `core/roles/*.md`:

```
grep -n 'scripts/concertino/[a-z-]*\.sh' core/roles/<role>.md
grep -cE '^\s*`?scripts/concertino/[a-z-]*\.sh|then `scripts/concertino/' ...
```

Both agree: **executor 1, evaluator 6, skeptic 6, auditor 3 = 16**, not the
`executor 1, evaluator 6, skeptic 4, auditor 3 = 14` asserted in design.md:49/51/76,
tasks.md:3.4, and **ticket.md's acceptance criterion**. The two missing sites are
`core/roles/skeptic.md:93` and `:94`:

```
  `scripts/concertino/start-servers.sh "$WORKTREE_PATH" "$DEV_PORT" "$BACKEND_PORT" "$TICKET_ID"`,
  then `scripts/concertino/assert-phase.sh servers "$WORKTREE_PATH" "$DEV_PORT" "$BACKEND_PORT" "$TICKET_ID"`.
```

These are bare, ambient-cwd-relative invocations of exactly the same shape as
`evaluator.md:154–155`, which the enumeration *did* count. (Excluded from my count,
correctly, are prose mentions: `executor.md:104`, `evaluator.md:358/363`,
`skeptic.md:279/284`, `auditor.md:317`.) The "4" appears to have been carried
forward from `skeptic-design-1.md:38` and re-asserted three more times without
re-measurement.

Why this is blocking rather than a nit: tasks.md 3.4 says "Fix all 14 … (… skeptic 4 …)",
and ticket.md's AC ratifies "14 call sites total". An executor working that
enumeration faithfully fixes 14, reports the AC met, and every downstream gate that
checks work-against-the-ticket passes — while leaving unfixed the **two
highest-consequence sites in the entire set**: `start-servers.sh` and
`assert-phase.sh`, i.e. dev-server startup against a possibly-wrong tree. That is
literally the CON-165 defect class this ticket's own proposal cites as its sibling.
Decision 2 promises to close the hazard "by fixing the call sites, not by arguing
they're safe" — an enumeration that omits 2 of 16 does not deliver that promise.

**4. New failure modes introduced by this revision.** Assessed; none fatal.
`BASE` too *high* (shallower branch) only widens the FAIL set — fails closed, safe.
`BASE` too *low* (4+ segment branch) yields a false negative, which CR2 removes.
`AMB == BASE` exactly (a cd to the worktrees dir itself) FAILs under an
"under-or-equal" reading though it is not inside any other worktree — a benign
false BLOCKER, but the spec should say which reading is intended (CR3).

**5. Decision 5 case 1 — still not the value a real spawn produces.** Case 1
specifies `AMBIENT_PWD` as "an *ancestor* of `WORKTREE_PATH`". My own live spawn
(item 1a) produced an ambient cwd in a **different repository entirely**
(`/home/matt/Development/helio` vs a `concertino` worktree) — not an ancestor of
`WORKTREE_PATH` by any path relation. The logic handles both identically (neither
is under `BASE`), so this is not a mechanism defect — but the test plan again
generalises from one measurement, and the ancestor-only fixture would still pass a
mutant that special-cased the ancestor relation. See CR4.

### Verdict: REFUTE

Decision 1 — the part both prior rounds rejected — is now correct, and I confirmed
it against both counterexamples myself. I am refuting on Decision 2, where a
reproduced enumeration error would let a faithful implementation satisfy the AC
while leaving the guard's own advertised guarantee false. The remaining items are
small and precise. All four are mechanical edits to the planning artifacts; none
require re-deciding the mechanism.

### Change Requests

1. **Correct the call-site enumeration from 14 to 16 (skeptic 4 → 6) in all four
   places it is asserted**, and add the two omitted sites explicitly so they cannot
   be missed again:
   - `openspec/changes/spawn-cwd-guard/ticket.md:24` — AC currently reads
     "14 call sites total"; must read 16.
   - `design.md:49`, `design.md:51`, `design.md:76` — "executor 1, evaluator 6,
     skeptic 4, auditor 3 — 14 total" → "executor 1, evaluator 6, skeptic 6,
     auditor 3 — 16 total".
   - `tasks.md` task 3.4 — same correction, and name
     `core/roles/skeptic.md:93` (`start-servers.sh`) and `:94` (`assert-phase.sh`)
     in the task text as required sites.
   - Add to tasks.md 3.4 an acceptance step that **re-derives the count from the
     tree at implementation time** (`grep -n 'scripts/concertino/[a-z-]*\.sh'`
     across the four role docs, minus prose mentions) rather than trusting any
     number written in these artifacts — the "4" survived three restatements
     precisely because nobody re-measured.

2. **Replace the three-levels-up `BASE` derivation with an exact one** in
   design.md Decision 1 step 3: `BASE="${WORKTREE_PATH%/$BRANCH}"` (with the
   existing "unresolvable → skip collision check, never a false BLOCKER" fallback
   retained for the case where `WORKTREE_PATH` does not end in `/$BRANCH`).
   Grounded in `core/scripts/setup-worktree.sh:250`, which constructs
   `WORKTREE_PATH` as exactly `${REPO_ROOT}/${WORKTREE_BASE}/${BRANCH}`. `BRANCH`
   is already an argument, so this costs no new input and removes the entire
   "convention, not a guarantee" risk currently recorded in Risks — including the
   4+-segment false negative and the real 2-segment worktree
   (`.claude/worktrees/task/matt-audit-repo`) that exists on disk today. Update the
   corresponding Risks bullet accordingly rather than leaving it describing the
   superseded heuristic.

3. **Disambiguate the boundary case in design.md Decision 1 step 4 and in
   `specs/spawn-cwd-guard/spec.md`**: state explicitly whether `AMB` *equal to*
   `BASE` (or equal to `WT`) counts as "under". Intended behaviour: `AMB == WT` →
   pass; `AMB == BASE` → pass (it is not inside any other ticket's worktree).
   Add a spec scenario for `AMB == WORKTREE_PATH` passing, since that is a real
   post-`cd` state and no current scenario covers it.

4. **Widen Decision 5 case 1 into two cases**, both drawn from measured spawns:
   (1a) ambient is an ancestor of `WORKTREE_PATH` in the same repo (round 2's
   measurement); (1b) ambient is an unrelated directory in a **different
   repository**, not an ancestor of `WORKTREE_PATH` at all (measured live in this
   round — ambient `/home/matt/Development/helio`, `WORKTREE_PATH` under
   `/home/matt/Development/concertino/.concertino/worktrees/...`). Both must yield
   `READY`. Name the mutant 1b kills: an implementation that tolerates only the
   ancestor relation (e.g. a prefix test against `WORKTREE_PATH` rather than the
   `BASE` containment test) passes 1a and fails 1b.

### Non-blocking notes

- design.md's orchestrator out-of-scope count ("18 bare invocations") is likewise
  unverified; my grep of `core/roles/orchestrator.md` returns 26 matching lines.
  Out of scope per Non-Goals so it does not block, but the figure should either be
  re-measured or stated without a number.
- The CON-139 scope decision (Non-Goals + Decision 3) is sound and correctly
  argued against what Decision 1 now actually does. No further change needed.
- tasks.md 3.5 (render-test for a typo'd `{{block:...}}` name) remains a good
  addition; the "or confirm an existing test already covers this" escape hatch is
  fine.
