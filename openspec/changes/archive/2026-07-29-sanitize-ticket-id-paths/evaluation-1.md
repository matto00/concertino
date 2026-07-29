## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All four acceptance criteria are addressed explicitly, not partially:
  - Both scripts validate `TICKET_ID`/`TICKET` against the exact shared pattern
    `^[A-Za-z#][A-Za-z0-9_-]*[0-9]$` before any path is built
    (`core/scripts/emit-event.sh:72,149`, `core/scripts/persist-evidence.sh:37-42`).
  - `emit-event.sh` degrades by emitting nothing (folded into the existing
    `[ -z "$TICKET" ] && exit 0` branch, same line-adjacent guard, exit 0,
    `core/scripts/emit-event.sh:148-149`).
  - `persist-evidence.sh` keeps its `FAIL <reason>` / no-`READY` / non-zero-exit
    contract (`core/scripts/persist-evidence.sh:39-42`); no caller changes were
    needed or made, matching `files-modified.md`'s claim.
  - Tests cover a `../../../../escape`-shaped id against both scripts and assert
    no file/directory appears outside the expected location
    (`test/scripts/emit-event.test.sh:350-365`, `test/scripts/persist-evidence.test.sh:72-91`).
- No AC was reinterpreted. The design doc's two different failure shapes
  (silent-drop vs. FAIL/non-zero) are exactly what the ticket calls for, and both
  are justified against each script's pre-existing contract rather than inventing
  a new one.
- All `tasks.md` items are checked and match what was implemented — verified each
  against the diff (1.1/1.2 persist-evidence, 2.1/2.2 emit-event, 3.1 pattern-test
  extension, 4.1-4.3 new filesystem tests, 5.1/5.2 sync + full-suite run).
- No scope creep. The "sweep" task (proposal's "What Changes" bullet 5) is
  documentation-only in this diff — no other script was touched — and a quick
  grep of `gather-escalation-context.sh`/`start-servers.sh`/`cleanup.sh`/
  `setup-worktree.sh` for `TICKET`-derived `dir=`/`mkdir`/`cp` usage confirms none
  exist, so the "none found" claim holds.
- No regressions: the only pre-existing test touched is the numeric-ticket case
  in `emit-event.test.sh` (`ticket=42` → `ticket=HEL-42`), which is a necessary
  consequence of narrowing the accepted shape, called out explicitly in both
  `files-modified.md` and an inline comment, and the sibling `role=7`
  string-typing assertion is left intact.
- No API/schema changes needed (shell-only, no public interface change beyond the
  narrowed input contract, which the spec deltas already document).
- Spec deltas (`specs/ticket-id-path-safety/spec.md`,
  `specs/evidence-telemetry/spec.md`) match the implemented behavior scenario for
  scenario — placement-before-any-side-effect, degradation shape per script, and
  the five-way byte-identical pattern assertion.

### Phase 2: Code Review — PASS
Issues: none.

- **Guard placement**: confirmed by direct read of both scripts that the shape
  check runs before any filesystem mutation.
  - `persist-evidence.sh:39-42` — the check runs immediately after argument
    parsing (line 30-31), before `main_checkout()` (line 66) and before `mkdir -p`
    (line 73). No `SOURCE_PATH` read happens first for the traversal case either
    (that check is at line 61, after the ticket check).
  - `emit-event.sh:149` — the check runs before `RUN_DIR` is computed (line 151)
    and before `mkdir -p "$RUN_DIR"` (line 152). `main_checkout()` at line 104 is
    a read-only `git rev-parse`/`cd`/`pwd` resolution, not a filesystem mutation,
    so nothing is written before the guard either. The `--await` branch (line 187
    onward) is reached only after this same linear guard, so it is covered
    without a second check, as tasks.md 2.2 requires.
- **Byte-identical pattern across all five shell copies**: verified via
  `grep -n "looks_like_ticket() {"` across `core/scripts/{assert-phase,
  emit-event,persist-evidence}.sh` and their `scripts/concertino/` renders — all
  six lines are character-for-character identical, and match
  `lib/ui/ticket.js`'s `TICKET_RE`. `test/scripts/ticket-pattern.test.sh` was
  correctly extended (not duplicated) to assert this at 5-way granularity and
  passes.
- **Rendered-copy sync**: `diff core/scripts/emit-event.sh
  scripts/concertino/emit-event.sh` and the `persist-evidence.sh` equivalent both
  report no differences — confirms task 5.1 was actually run, not just claimed.
- **DRY**: the literal-copy-not-refactor choice is an explicit, justified
  non-goal in design.md (every script in this suite is deliberately
  independent/single-file), consistent with the existing five sibling copies.
  Not a violation given the documented precedent.
- **Readable**: both new guards carry a comment explaining the traversal risk and
  pointing at the sibling scripts that already carry the pattern. No magic
  values — the regex is the same literal used everywhere else in the suite.
- **Error handling**: `persist-evidence.sh` uses the same `FAIL <reason>` /
  stderr / non-zero-exit shape as its other three failure causes in the same
  file; `emit-event.sh` folds into its existing empty-ticket exit-0 path rather
  than inventing a new contract. Both match the design doc's stated rationale.
- **Tests meaningful**: the new test cases assert exit code, stdout/stderr
  contract (READY/FAIL presence), and a before/after `find` diff proving no file
  was created — these would catch a real regression (e.g., a guard that fires
  after `mkdir -p` instead of before, or a pattern that silently drifts). A
  well-formed sibling ticket id is exercised in the same run to prove the guard
  narrows rather than breaks normal use (AC's implicit non-regression bar).
- **No dead code**: no unused imports, no leftover TODO/FIXME in the diff.
- **No over-engineering**: design.md explicitly rejects extracting a shared
  shell library and rejects unifying the two scripts' failure shapes — both
  correctly scoped to the minimum fix.
- Minor style note (non-blocking): the new persist-evidence.sh traversal test
  reuses the pre-existing hardcoded `/tmp/persist-evidence-test-err` path rather
  than `mktemp`, but this exactly matches the pattern already used two test
  cases earlier in the same file (line 52), so it is consistent with existing
  convention, not a new problem introduced by this change.

### Phase 3: UI Review — N/A
No UI review configured for this project; change is shell-script only with no
observable UI surface.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- The traversal-shaped filesystem assertions (`find "$REPO" ... | sort`
  before/after) are scoped to the test's throwaway repo under `$REPO`
  (itself under `mktemp -d`, typically `/tmp`), not a global filesystem scan.
  This is sufficient evidence given the guard fires before any `mkdir`/`cp` call
  (confirmed by direct code read above), but a future hardening pass could widen
  the assertion to also snapshot a directory one level above `$REPO` for
  extra defense-in-depth against a future regression that moves the guard after
  a filesystem call.

### Verification Evidence
- `npm test` re-run independently in the worktree: exit 0, `423 passed, 0
  failed` (node test runner) plus all shell suites reporting `0 failed`,
  including `emit-event.sh` (63 passed), `persist-evidence.sh` (20 passed), and
  `ticket-pattern.test.sh` (15 passed, including the new 5-way byte-identical
  assertion and the traversal-shaped cases in both scripts).
