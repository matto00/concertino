## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the files/commands named,
not from evaluation-1.md or the design docs. No UI in this change (script/infra
only), so section 4 (visual judgment) is N/A — no servers started.

### What I verified (with evidence)

**1. `core/scripts/squash-branch.sh` (read in full, 214 lines, mode 100755)**
- (a) Merge-base, not live tip: L85 `git merge-base --all HEAD "$BASE_REF"`,
  L109 `git_wt reset --soft "$MERGE_BASE"`. `$BASE_REF` is used only for
  computing the merge-base and for the advancement log (L100-106), never as a
  reset target. Multiple merge-bases (criss-cross) hard-stop at L91-96 rather
  than guessing.
- (b) No hardcoded openspec path: `CHANGE_DIR` is positional arg 5 (L69),
  normalized at L123, and `grep -rn` over the file finds no literal
  `openspec/changes` anywhere in it. Matches the caller-passes-the-path
  convention the round-2 design skeptic demanded.
- (c) Allowlist union + hard stop: L139-155 `is_allowed()` = `<CHANGE_DIR>/**`
  prefix match UNION exact paths parsed from `files-modified.md`; unexpected
  paths collected L157-166 and hard-stopped at L198-204 with the offending
  paths named and `exit 1` before any commit.
- (d) Always prints count+list: L169-175 is unconditional and sits ABOVE both
  stop branches and the commit at L208 — not inside a failure path.
- (e) Base advancement logged, never gating: L101-106 prints an INFO line with
  the commit count; no branch of that block exits or rebases.
- (f) Missing/unparseable declaration: L178-192. `DECLARED_COUNT==0` while
  unexpected staged files remain is a loud stop that dumps the raw
  `files-modified.md` (or says it's missing) plus the outstanding paths, and
  only `--allow-empty-declaration` (L71-73) opts past it.
- D2a parsing is bullet-anchored (`^[[:space:]]*[-*][[:space:]]*` + backticked
  path, L131-132), so stray backticks in prose are not read as paths.

**2. `test/scripts/squash-branch.test.sh` (read in full, run twice)**
- Ran standalone: `19 passed, 0 failed`, exit 0; `git status --porcelain
  core/scripts/squash-branch.sh` clean afterwards (trap restored the file).
- Every assertion invokes `$ROOT/core/scripts/squash-branch.sh` as a
  subprocess. There is no inline reimplementation of the guard being asserted
  against. Fixtures are all `mktemp -d` throwaway repos — never concertino or
  helio.
- Red-before-green is real, not asserted:
  - Scenario 2b mutates the REAL file in place with a targeted python3 edit
    that comments out exactly the guard's `exit 1` (asserting on the adjacent
    line first, L242-256), and the run then exits 0 — proving that specific
    block is load-bearing.
  - Scenario 1b overwrites the REAL file with a naive `reset --soft
    origin/main` and shows `sibling-file.txt` committed as a revert.
- **I did not take Scenario 1b at face value** (a whole-file swap is closer to
  a hand-rolled copy than a minimal revert, which is the trap this ticket
  warns about). I cloned the branch to a throwaway dir and reverted ONLY line
  109 (`"$MERGE_BASE"` -> `"$BASE_REF"`), changing nothing else, then re-ran
  the suite: `15 passed, 4 failed` (3.3 x3 and 3.4-restored all go red). The
  D1 fix is therefore genuinely coupled to the real file under test. Probe dir
  deleted; this worktree was never mutated.

**3. `core/roles/orchestrator.md` wiring**
- `git diff main...HEAD -- core/roles/orchestrator.md`: Phase 3 step 1 no
  longer says "squash" abstractly; it calls
  `scripts/concertino/squash-branch.sh "$WORKTREE_PATH" <base-remote>
  <base-branch> "<subject+trailer>" "<change-dir>"` (L780), explicitly forbids
  an improvised `git reset --soft <base-ref>`, and states that a non-zero exit
  is a `BLOCKER` to escalate — with an explicit instruction NOT to retry with
  `--allow-empty-declaration` unilaterally. Path style matches the 10 other
  `scripts/concertino/*` invocations already in that file.

**4. Acceptance criteria traced (ticket.md)**
- AC1 (cannot stage files outside the touched-file set without stopping) ->
  squash-branch.sh L198-204 + test Scenario 2 (4 assertions, incl. "no commit
  created, stray remains staged").
- AC2 (advanced base detected, not absorbed) -> L101-106 log + L109 reset
  target; test 3.1/D3.
- AC3 (reproduce branch/advance/squash, no revert) -> test Scenario 1 builds
  exactly that fixture (sibling commit pushed to origin/main mid-run) and
  asserts `sibling-file.txt` is absent from the squash commit while
  `own-file.txt` is present. My line-109 probe confirms this assertion is not
  vacuous.
- AC4 ("staged more than expected" never silent) -> unconditional count+list
  print L169-175, plus stderr reports naming each unexpected path.
- The ticket's "suggested direction" of *requiring a rebase* was consciously
  narrowed to log-don't-gate (design D3); the AC itself only requires explicit
  detection rather than absorption, which is satisfied.

**5. Scope**
- `git show --stat 9b3f9e1`: the CON-129 commit touches only
  `core/roles/orchestrator.md`, `core/scripts/squash-branch.sh`,
  `test/scripts/squash-branch.test.sh`, `package.json`, and its own change
  dir. Nothing in `cleanup.sh`, `lib/cli/*`, or `git-child-env*` — the CON-133
  files that appear in `main...HEAD` are from the already-merged 6699214, not
  from this commit. No CON-128/131/132/121/HEL-764 territory touched.
- `files-modified.md` accurately declares all four non-change-dir files (so
  the script's own guard would pass on this very run).

**6. Full suite, fresh**
- `npm test` run by me from scratch: exit 0, `# pass 2230 / # fail 0` for the
  node test runner, and every bash suite reported `... passed, 0 failed` (32
  such lines). No `not ok` / assertion-FAIL lines anywhere in the log. (The
  "FAIL " strings present in the log are the guard's own expected stderr text
  inside passing negative-path scenarios.)

### Verdict: CONFIRM

### Non-blocking notes
1. `test/scripts/squash-branch.test.sh` L22-27: the EXIT trap runs `git
   checkout -- core/scripts/squash-branch.sh` unconditionally, including on a
   clean pass. That silently discards a developer's UNCOMMITTED edits to that
   file if they run `npm test` while iterating on it. The trap is the right
   safety net for the mutation scenarios; consider stashing the pre-run
   content (e.g. `cp` to a temp file up front) and restoring from that copy
   instead of from HEAD.
2. L115 is dead code: `echo "$OUT1" | grep -qi "base ${BASE1##*/}"` with a
   comment calling itself a no-op guard against unbound-var warnings. It
   asserts nothing; delete it.
3. This suite adds a hard `python3` dependency to `npm test` (L242). Every
   other bash suite in the `test` script is pure shell. Worth either noting in
   `test/scripts/`'s docs or reimplementing the one-line mutation with `sed`.
4. Rendered-output drift: `scripts/concertino/` in this repo does not contain
   `squash-branch.sh`. This is pre-existing dogfooding drift, not a regression
   (`report-cost.sh` from CON-108 is likewise absent on `main`), and
   `lib/cli/emit.js` L426-428 copies `core/scripts/**` recursively, so real
   consumers pick it up on the next `concertino sync`. Flagging only so the
   next self-sync isn't a surprise.
