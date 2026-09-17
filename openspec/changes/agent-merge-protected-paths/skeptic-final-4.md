## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Judged commit `4b1c3c63c4ab4cee182e97a8ace9866ad2275e52` (`4b1c3c6`), the
round-4 regression fix on top of `10d7c28`. Cold spawn; every claim below was
independently re-derived, not taken from `4b1c3c6`'s commit message, the
ticket's "What `4b1c3c6` claims" summary, or any prior skeptic report.

### Spawn-cwd guard
`assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio
branch=feature/agent-merge-protected-paths/CON-193` — normal ancestor-cwd
spawn, proceeded.

### What I verified (with evidence)

1. **HEAD is exactly the commit under review.** `git rev-parse HEAD` ==
   `4b1c3c63c4ab4cee182e97a8ace9866ad2275e52`. `git log --oneline -8` confirms
   the five-commit chain (`4b1c3c6`/`10d7c28`/`0980b03`/`8a62ec4`/`b4a124f`)
   on base `8a96bd1`.

2. **Round-4 diff is exactly the claimed guard, nothing else.**
   `diff <(git show 10d7c28:core/scripts/check-merge-readiness.sh)
   <(git show 4b1c3c6:...)` shows only the added `if (pp.length === 0) {
   ...; process.exit(0); }` block before the `require(...lib/config.js...)`
   call — no other line changed. Confirms the fix is scoped to exactly the
   self-caught regression and introduces no incidental change.

3. **The consuming-repo regression genuinely reproduces on `10d7c28` and is
   genuinely fixed on `4b1c3c6`.** I built a byte-copy of
   `test/scripts/check-merge-readiness.test.sh` in the worktree pointed at
   `10d7c28`'s script blob (kept the copy inside the worktree so `$ROOT`-
   relative helper resolution still worked; deleted it afterward —
   `git status --short` clean before and after). Ran it fresh:
   `P19.1`/`P19.2` (no-`protectedPaths` no-op case) — **RED** against
   `10d7c28` ("expected [0] got [1]" / "expected [PASS] got []"), exactly as
   the round-4 commit message claims. `P20.1`–`P20.3` (fail-closed,
   configured-but-unvalidatable case) — **green** against `10d7c28` too,
   confirming that arm was already correct there (the bug was strictly
   "no-op case now fails," not "fail-closed case doesn't work"). Against
   current HEAD, fresh full run: `138 passed, 0 failed`.

4. **P20's non-vacuity, reproduced myself, not taken on the executor's
   word.** I mutated the live `core/scripts/check-merge-readiness.sh`
   (removed the `pp.length === 0` guard, restoring `10d7c28`'s unconditional
   `require`), reran the suite fresh: exactly `P19.1`/`P19.2` flip red
   (`136 passed, 2 failed`), everything else — including all of `P20`'s
   three assertions — stayed green. Restored the file
   (`mv ...sh.bak ...sh`), reran: `138 passed, 0 failed` again, `git status
   --short` clean throughout. This matches the claimed 31-assertion-style
   mutation argument in spirit and confirms P19 (not P20) is where the
   round-4 fix's own guard is load-bearing — P20's green-on-both-commits
   status is not a defect, it's evidence the fail-closed arm was never
   broken.

5. **One predicate, no surviving second bash reimplementation (C4).**
   Grepped both `core/scripts/` and `scripts/concertino/` for `A-Za-z0-9`
   and `[[ =~ ]]` uses. The only protectedPaths-glob-relevant bash regex
   left is line 720's `LC_ALL=C`-pinned unclosed-`[` check, which the code
   comment and `docs/config-reference.md`:483-485 both correctly describe as
   testing a property of git's own pathspec parser, not re-deriving "what is
   a plain glob." Every other `[A-Za-z...]` hit in the tree (`looks_like_ticket`,
   `next-ticket-id.sh`'s prefix check, etc.) is an unrelated ticket-ID/prefix
   shape check, not a second copy of the protectedPaths predicate. C4 holds.

6. **Rendered/core drift and CON-207 scope discipline.** `cmp
   core/scripts/check-merge-readiness.sh scripts/concertino/check-merge-
   readiness.sh` → identical. `bash test/scripts/rendered-scripts-drift.test.sh`
   → `19 passed, 0 failed`. `git diff 8a96bd1..4b1c3c6 --
   core/scripts/check-pr-mergeable.sh scripts/concertino/check-pr-
   mergeable.sh` → empty (0 lines) — confirmed independently, not merely
   asserted: `check-pr-mergeable.sh` is untouched across all five commits of
   this change.

7. **C1 archive probe, disposable copy only.** Copied the entire worktree to
   a scratch dir (`/tmp/.../con193check/archive-probe`), ran `openspec
   validate "agent-merge-protected-paths" --type change` (valid) then
   `openspec archive "agent-merge-protected-paths" -y --json` there. Output:
   `added:5 modified:2 removed:0 renamed:2`, exit 0 — matches the claim
   exactly. The live worktree's `git status --short` was clean before and
   after; the probe never touched it. Scratch copy deleted afterward.

8. **`npm test` real, non-piped, full run.** Ran in background (bounded,
   notified on completion — no polling loop), captured the exit code
   separately from stdout (`echo "EXIT=$?"` into the task's own output
   file, not piped through the log). `EXIT=0`. `node --test` line: `# pass
   2383` / `# fail 0`. Counted `passed, 0 failed` lines for the 49 bash
   suites: `grep -c "passed, 0 failed"` → 49, and a separate grep for any
   `N failed` with N>0 found none. `check-merge-readiness.test.sh`'s own
   138/138 is included in that run and independently re-confirmed at steps
   3/4 above.

9. **AC4 — no argument/env var narrows or empties `protectedPaths`.**
   Grepped condition 4's block for `CONCERTINO_*`/`process.env`/positional
   args feeding the glob list: the only env var referenced there
   (`CONCERTINO_BASE_BRANCH`) only supplies a fallback base-branch name for
   the diff comparison when condition 3's base wasn't resolved — it does not
   touch which globs are read or how many. `check-merge-readiness.sh`'s own
   four positional args (`WORKTREE_PATH BRANCH TICKET_ID ARCHIVE_PREFIX`)
   feed nothing into the `protectedPaths` list, which is read only from the
   MAIN checkout's `concertino.config.json`. AC4 holds.

10. **Docs honesty (`docs/config-reference.md`:463-495).** States plainly
    that the path is "unexercised in this repository today," names
    `AGENT_MERGE=false` for the whole batch, names CON-207's empty-rollup
    gap explicitly while stating this feature does not build on it, and
    states "This feature ships with test and mutation-proof evidence only,
    not field use — do not describe it as battle-tested." Also correctly
    frames the asymmetry: "The JS layer itself was never wrong here — any
    project that ran `concertino sync`/`concertino validate`/`concertino
    doctor` before a merge attempt was already protected... the exposure
    was narrowly the hand-edited-config path." All matches ground truth,
    verified by reading the file directly, not by trusting the ticket's
    summary of it.

11. **Two `openspec/changes/agent-merge-role/specs/agent-merge/spec.md`
    scenario headers** (`#### Scenario: All three conditions pass` /
    `#### Scenario: All four conditions hold`) — confirmed unchanged
    verbatim per the standing instruction not to flag their numeric
    staleness.

### A fifth disarm shape? — hunted, not found in the audited-branch-reachable surface

I looked specifically for a fifth way a crafted `protectedPaths` *entry* (the
thing rounds 1-4 all attacked) could still evade the guard:

- **Unicode NFD decomposition** (round 3's diacritic attack, decomposed
  form): `isPlainRelativeGlob`'s regex is `[A-Za-z0-9._-]` for the first
  char and `[A-Za-z0-9._\-/*?[\]]*` for the rest — a combining diacritical
  mark (e.g. U+0301 COMBINING ACUTE ACCENT) is outside both character
  classes exactly like the precomposed accented letter was, so an NFD
  `"re´cord/**"`-shaped entry is rejected by the same regex, for the same
  reason, with no locale sensitivity (JS regex character classes are
  codepoint-based, not collation-based — this was the actual round-3 bug,
  fixed by delegating to this exact regex). Not a new escape.
- **`node` missing/erroring mid-run, malformed `lib/config.js` export
  shape (throwing getter, wrong type)**: any of these throw inside the
  `try` block or fail the `require`, hit the `catch`, `process.exit(2)`,
  and condition 4's `PP_RC -ne 0` branch fails closed with a named reason.
  This is exactly what P20 exercises (the module-unreachable arm), verified
  live at steps 3-4 above.
- **A non-array/wrong-JSON-type `protectedPaths`** (e.g. `{"0":"record/**"}`,
  `null`, a number): `Array.isArray(cfg.agentMerge.protectedPaths)` is
  false, so `pp` becomes `[]` and condition 4 silently no-ops — this is
  **not** exit 2/fail-closed for this specific shape, unlike a non-string
  array *entry* (which the loop still needs to reach, and can't since `pp`
  is coerced to `[]` first). This is a real, narrow gap in the stated
  fail-closed contract (design.md/header comment promise "unreadable/
  unparseable config" fails closed; a syntactically-valid-JSON-but-wrong-
  type `protectedPaths` field is arguably outside literal "unparseable" but
  is squarely inside the spirit of "can't be trusted, so don't silently
  treat it as empty"). However: (a) this requires an already-malformed
  MAIN-checkout `concertino.config.json` — not something the audited
  branch's own diff can produce, since condition 4 reads the config from
  the main checkout, never the branch under review; (b)
  `collectConfigIssues` (`lib/config.js`:905-923, unconditional on
  `agentMerge.enabled`) already hard-rejects a non-array `protectedPaths` at
  `concertino validate`/`doctor` time, so this shape reaching a committed
  main-checkout config at all implies that gate was bypassed independently
  of anything in this change. This is not the fourth-round's "crafted glob
  entry defeats a per-entry predicate" shape — it's a pre-existing-
  misconfiguration reachability question one layer up, out of the branch-
  diff attack surface this ticket's four rounds have all been probing. I am
  **not** calling this the fifth disarm variant the owner's standing
  instruction is watching for (that instruction is specifically about the
  glob-matching predicate class, now proven single-implementation and
  regex-sound); I record it below as a non-blocking hardening note instead.
- **Symlinks / `.git/**`**: `git diff --name-only ... -- ":(glob)<pat>"`
  operates on git's own tracked-path diff, which already excludes `.git/`
  (not a trackable path) and reports the symlink's own path like any other
  blob change — no differential behavior found between a symlink entry and
  a regular file for pathspec-glob matching purposes; not a new escape
  route specific to this feature.

### Verdict: CONFIRM

All four acceptance criteria trace to real, freshly-executed evidence:
AC1 (P19, live-reproduced both broken-then-fixed), AC2/AC3 (P1-P18, all
green, unrelated to this round's fix but re-run fresh as part of the full
138/138), AC4 (script args/env grep, verified). C1-C4 standing constraints
all independently verified, not merely re-asserted. The round-4 regression
this gate exists to catch is fixed, proven by reproducing the break against
the exact prior blob and confirming the fix removes it, and the fix
introduces no new bash reimplementation of the glob predicate.

### Non-blocking notes

1. **Hardening idea, not a blocker**: condition 4's `node -e` treats a
   non-array `agentMerge.protectedPaths` in the MAIN checkout's config as
   `[]` (silent no-op) rather than failing closed, unlike a non-string
   *entry inside* an array (which correctly fails closed via
   `isPlainRelativeGlob`/`PP_OK`). Since `collectConfigIssues` already
   rejects this shape at `concertino validate`/`doctor` time and it is not
   reachable from the audited branch's own diff (main-checkout-only read),
   I am not blocking on it, but a future round could add `typeof
   cfg.agentMerge.protectedPaths !== 'undefined' && !Array.isArray(...)` as
   an explicit `process.exit(2)` arm for defense-in-depth, matching the
   letter (not just the spirit) of the "unreadable/unparseable config fails
   closed" promise in the header comment and design.md.
2. Consider adding a P21-style fixture exercising exactly that non-array
   `protectedPaths` shape against the MAIN checkout, so the current silent-
   no-op behavior is at least pinned by a named, intentional test rather
   than left implicit — whether the intentional behavior stays "no-op" or
   is hardened to "fail closed" per note 1 above.
