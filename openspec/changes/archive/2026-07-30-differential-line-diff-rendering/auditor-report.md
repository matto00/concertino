## Auditor Report

Ticket: CON-27 — Differential (line-diff) rendering for the dashboard's poll loop
Branch: `feature/differential-line-diff-rendering/CON-27`
PR: https://github.com/matto00/concertino/pull/38
HEAD: `600a49f5f3a09cb7b8b652bd87a27d1644b360ad`

Second auditor spawn. The first spawn confirmed all four conditions but its
`gh pr merge` was denied by the Claude Code permission classifier before it
ran, and it recorded `BLOCKER` for that environmental reason. That permission
rule has since been granted. This spawn re-derived every condition from ground
truth (script output, `gh` API, the event log, the diff, live execution of the
merged code) rather than trusting the prior report.

**All four conditions held at check time. The merge then failed to a race: a
new commit landed on `main` between the mergeability read and the merge
attempt, and it conflicts with this branch.** Details under "Merge attempt"
below.

### Condition 1–3 (check-merge-readiness.sh)

At check time:

```
$ scripts/concertino/check-merge-readiness.sh <worktree> feature/differential-line-diff-rendering/CON-27 CON-27
PASS
EXIT=0
```

Independently corroborated:

- **CI green.** `gh pr view 38 --json statusCheckRollup` → `[]`. No checks are
  reported because the repo's only workflow, `.github/workflows/publish.yml`,
  is release/dispatch-triggered, not a PR check. Empty is therefore correct,
  not a pending or misconfigured state. Because "no checks" carries no signal
  on its own, I re-ran the project's actual configured gate
  (`concertino.config.json → gates`: `npm test`, `when: always`) fresh in the
  worktree:
  ```
  ℹ tests 770
  ℹ pass 770
  ℹ fail 0
  ...
  22 passed, 0 failed      (check-merge-readiness.test.sh, last suite in the chain)
  EXIT=0
  ```
  Every shell suite in the chain reported `N passed, 0 failed`, including
  `watch-smoke.test.sh` (56 passed, 0 failed). Note this gate result is now
  stale with respect to the new base — see "Merge attempt".
- **PR mergeable (at check time).** `gh pr view 38` → `"state":"OPEN"`,
  `"mergeable":"MERGEABLE"`, `"mergeStateStatus":"CLEAN"`,
  `"baseRefName":"main"`. After `git fetch origin`, local HEAD,
  `origin/feature/differential-line-diff-rendering/CON-27`, and the PR's
  `headRefOid` were all `600a49f5f3a09cb7b8b652bd87a27d1644b360ad` — nothing
  unpushed, so the diff audited below is exactly the diff that was to be
  merged.
- **This run's own gates.** Read directly from
  `.concertino/runs/CON-27/events.jsonl`: latest `role=evaluator` verdict is
  `PASS` (`evaluation-3.md`, t=1785437625919); latest `role=skeptic` verdict is
  `CONFIRM` (`skeptic-final-2.md`, t=1785439788303), preceded by an
  independent `CONFIRM` (`skeptic-final-2b.md`).

### Condition 4 (acceptance criteria, traced cold)

CON-27 states its criteria as prose ("Desired behavior" + "Scope note") rather
than a numbered list. Traced against `git diff origin/main...HEAD` and, where
behavior is the claim, against the merged code executed live.

1. **"Track the previous frame's rendered lines."**
   Met. `lastFrameLines` (an integer count) is replaced by
   `let prevFrameLines = []` in `watch()` — the previous frame's own array of
   already-padded lines. `buildFrame`'s signature changes from
   `(text, cols, prevLineCount)` to `(text, cols, rows, prevLines)` and it
   returns `{ bytes, lines }`; `draw()` stores `prevFrameLines = frame.lines`.
   One array, not a count plus a parallel array, so the shrink loop's length
   and the diff's content cannot drift apart.

2. **"Diff the new frame against the previous one line by line, and only write
   the rows that actually changed, positioning the cursor per-row via
   `\x1b[<row>;1H` rather than rewriting the whole frame."**
   Met, literally. `buildFrame`'s Mode 1 loop is
   `if (lines[i] !== prev[i]) bytes += rowAt(i + 1) + lines[i];` with
   `const rowAt = (row) => '\x1b[' + row + ';1H'` shared by all three emitters
   (diff loop, shrink-blank loop, cursor park) so they stay byte-identical.
   Verified live against the merged module:
   ```
   first frame (prev=[]):  "\x1b[1;1Halpha…\x1b[2;1Hbravo…\x1b[3;1Hcharlie…\x1b[3;1Hcharlie…"
   one row changed:        "\x1b[2;1HBRAVO!…\x1b[3;1Hcharlie…"
   ```
   Only the changed row is emitted; the trailing repeat of the last row is the
   deliberate Decision-8 cursor park. `test/scripts/watch-smoke.test.sh`
   asserts the same on a real session: zero full-rewrite `\x1b[H`, non-zero
   `\x1b[<row>;1H` placements.

3. **"Make the 1 Hz poll's terminal-write cost close to free in the common
   case where most of the dashboard is unchanged."**
   Met, in its strongest form. A fully unchanged tick yields `bytes === ''`
   (verified live), and `draw()`'s
   `if (frame.bytes) process.stdout.write(frame.bytes)` guard means stdout is
   not touched at all on such a tick — not written with zero bytes.

4. **Ticket's named edge cases — "partial-line changes, colour-escape
   boundaries mid-line, interaction with the existing shrink-cleanup logic".**
   Met.
   - Partial-line / mid-escape: diff granularity is the whole padded line, so a
     changed row is always rewritten in full. The mid-escape hazard is avoided
     by construction rather than special-cased.
   - Colour escapes: padding still goes through `format.padTo` (visible column
     width, not `.length`).
   - Shrink cleanup: `blankTrailingRows()` preserves CON-17's behavior
     verbatim, driven by `prev.length`; still explicit blanking, still no
     `\x1b[J`. Verified live: a 3-line → 1-line frame emits
     `\x1b[2;1H<blank>\x1b[3;1H<blank>` before the row-1 rewrite.

5. **Scope note — "entirely confined to `lib/ui/watch.js`; `lib/ui/router.js`
   and every `lib/ui/screens/*` module must stay pure, string-returning, and
   untouched."**
   Met. `git diff --name-only origin/main...HEAD -- lib/ core/ adapters/
   scripts/ bin/` returns exactly one path: `lib/ui/watch.js`. The remaining
   changed files are `test/watch.test.js`,
   `test/scripts/watch-smoke.test.sh`,
   `openspec/specs/dashboard-render-loop/spec.md`, and this change's own
   openspec artifacts.

6. **CON-17's five carried-over criteria** (no blank frame; scrollback
   preserved; stale-row cleanup on shrink; terminal state restored on every
   exit path; resize reflows correctly).
   Met, and in two places strengthened. `\x1b[2J` appears in
   `lib/ui/watch.js` only inside comments explaining why it is not used — it
   is never emitted; the smoke gate still asserts zero occurrences and that
   the alternate buffer is entered/exited exactly once. Two cache
   invalidations were added because the diff makes them load-bearing: the
   `resize` listener maps every entry to a `null` sentinel (content
   invalidated, **length preserved**, so a rows-shrinking resize still blanks
   its stale tail), and the `doAttach` restore callback resets to `[]` (the
   alternate buffer is genuinely cleared, so there is no stale tail). Verified
   live: a `[null × 4]` cache against a 2-line frame repaints both rows **and**
   blanks rows 3 and 4 — the regression design.md Decision 3 documents does not
   recur. Both wiring lines now carry `watch()`-level regression tests added in
   cycle 3 after mutation testing showed each was deletable with a green suite.

Noted, not a finding: over-tall frames (`rows > 0 && lines.length > rows`)
deliberately retain the original `CURSOR_HOME` + newline-flow full rewrite,
because absolute row addressing clamps and cannot reproduce the terminal's
scroll — preserving `lib/ui/screens/fleet.js`'s intentional NEEDS-YOU overflow
behavior. Verified live: with `rows=5` and a 10-line frame, `bytes` starts with
`CURSOR_HOME` and the returned `.lines` is the visible 5-row tail, so a later
in-bounds frame resumes trustworthy per-row diffing. This is a documented
design decision carried through the design gate and both final skeptics, and is
recorded as a spec scenario. No CON-27 criterion forbids it.

No acceptance criterion is untraceable. **All four conditions held.**

### Merge attempt

```
$ gh pr merge feature/differential-line-diff-rendering/CON-27 --squash
X Pull request matto00/concertino#38 is not mergeable: the merge commit cannot be cleanly created.
EXIT=1
```

Re-running the readiness check immediately afterward:

```
$ scripts/concertino/check-merge-readiness.sh ...
FAIL not mergeable: DIRTY
EXIT=1
```

Diagnosis, from ground truth after `git fetch origin`:

- `origin/main` is now `4c2bea4` — **CON-39 "Fleet view: lazygit-style
  [1]/[2]/[3] section jump, richer QUEUED section" (PR #39)** landed between
  this audit's mergeability read (`main` @ `a9e0bf6`) and the merge attempt,
  minutes apart.
- `git merge-tree $(git merge-base HEAD origin/main) HEAD origin/main` reports
  **two `changed in both` files with real conflicts**:
  - `lib/ui/watch.js`
  - `test/watch.test.js`

  CON-39 touched the same file this change owns. This is the same class of
  drift that cycle 5 of this change already absorbed once (three `watch.js`
  commits — CON-26, CON-6, CON-19 — landed after the branch was cut); CON-39 is
  a fourth.

The PR remains **open**; a failed `gh pr merge` never leaves a half-merged
state. No code was modified, and cleanup was not run.

### Verdict: BLOCKER

### Reason

All four merge conditions were independently confirmed, and the merge was
attempted. It failed to a base-moved race: `4c2bea4` (CON-39, PR #39) landed on
`main` after the mergeability read, and it conflicts with this branch in
`lib/ui/watch.js` and `test/watch.test.js`. Per the auditor's own rules, a
`gh pr merge` failure after all four conditions passed is a `BLOCKER`, not an
`ESCALATE` — the conditions did not fail; the world moved underneath them.

This is not auditor-retryable: resolving it requires a code change (reconciling
with the new `main`), which the auditor may not make.

Action required — reconcile and re-gate, exactly as cycle 5 did:

1. In the worktree, `git merge origin/main` and resolve the two conflicts. The
   `lib/ui/watch.js` conflict must keep **both** sides — CON-27's diff writer
   and CON-39's fleet/queue changes — never either wholesale. Watch
   specifically for CON-39 hunks that auto-merge into a `ReferenceError` with
   no conflict marker (cycle-5 task 5.3 hit exactly that with
   `computeScreenRows()`); verify by *running* the merged code, not by a clean
   `git status`.
2. Re-run the full gate (`npm test`) on the merged result. The 770/770 above is
   now stale with respect to the new base.
3. Push, then re-spawn the evaluator/skeptic gates as the workflow requires,
   and re-spawn the auditor.

Unrelated housekeeping observed (not a merge condition, not part of the PR):
the worktree has one uncommitted modification,
`openspec/changes/archive/2026-07-30-differential-line-diff-rendering/workflow-state.md`
— orchestrator bookkeeping that is not on the branch and does not affect the
merge.
