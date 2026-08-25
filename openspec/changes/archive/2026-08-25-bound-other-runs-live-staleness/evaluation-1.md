## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All 4 ticket.md acceptance criteria are satisfiable by this diff:
  - AC1 (unresolved-escalation run does not permanently block sync): satisfied by the
    staleness window — a stuck run's last event ages past 6h and stops being reported live.
  - AC2 (false-positive window bounded, not indefinite): satisfied — bounded by
    `CONCERTINO_LIVE_RUN_STALE_HOURS` (default 6h).
  - AC3 (fix lands in `core/`): satisfied — `core/scripts/cleanup.sh` is the only functional
    edit; `scripts/concertino/cleanup.sh` is a re-render, verified byte-identical
    (`diff core/scripts/cleanup.sh scripts/concertino/cleanup.sh` → no output).
  - AC4 (no false negative for a genuinely live run): satisfied and explicitly tested (the
    "recent run" regression case, TICK-33).
- design.md's 5 Decisions are all faithfully implemented in the diff:
  - Decision 1 (time-based bound, not new event kind): implemented exactly as described.
  - Decision 2 (no PID-based liveness): confirmed absent from the diff.
  - Decision 3 (6h default, `CONCERTINO_LIVE_RUN_STALE_HOURS` override, falls back to 6 on
    unset/non-numeric): implemented verbatim (`case "$stale_hours" in ''|*[!0-9]*) stale_hours=6
    ;; esac`).
  - Decision 4 (last-event timestamp via the same grep-based style already in the function):
    implemented via a backward array scan over already-read lines, consistent with the file's
    existing dependency-light style.
  - Decision 5 (unparsable/missing timestamp fails closed to LIVE, scanning backwards rather
    than blind `tail -1`): implemented exactly — confirmed both by code inspection and by the
    "unparsable last t" regression test (TICK-36), which deliberately includes zero parseable
    `t` fields anywhere in the fixture to rule out a scan that gives up too early.
  - The inverted in-code comment at the old `cleanup.sh:413-420` is corrected — the new comment
    explicitly states retention "will NEVER prune" a run missing `run.end` (matching design.md's
    correction), replacing the old backwards claim that retention prunes it by mtime.
- tasks.md: all items marked `[x]`; each matches what the diff actually implements (verified
  1.1–1.5, 2.1–2.5, 3.1–3.2 individually against the diff/test output — no partial or
  reinterpreted item found).
- No scope creep: `git diff 25ffd4e~1 25ffd4e --stat` touches exactly `core/scripts/cleanup.sh`,
  `scripts/concertino/cleanup.sh` (mechanical re-render), `test/scripts/cleanup.test.sh`, and the
  change's own openspec artifacts — nothing else.
- No regression to existing behavior: the pre-existing CON-66 test cases still pass (verified via
  a live RED/GREEN re-run — see Phase 2) because `fake_event()`'s new `t` parameter defaults to
  "now," preserving every old case's original recency-based semantics rather than silently
  changing what they exercise.
- Spec delta (`specs/cleanup-sync-guard/spec.md`, ADDED requirement) matches the implemented
  behavior scenario-for-scenario (stale-not-live, recent-still-live, run.end-always-not-live,
  unparsable-fails-closed) — all four scenarios have a corresponding test case in the diff.

### Phase 2: Code Review — PASS
Issues: none.

Gates run fresh (this is a `core/`+`test/` bash-script change; ran the project's actual gate,
`npm test`, in `WORKTREE_PATH` — no `frontend/**` or `backend/**` files touched, and
`CLEAN_WORKTREE` was not set for this speed):

- `bash test/scripts/cleanup.test.sh` (standalone, fresh run): **146 passed, 0 failed** — matches
  the executor's reported GREEN count exactly.
- Full `npm test`: **2248 node tests, 0 failures**, plus all bash suites (`squash-branch.test.sh`
  19/19, `check-gate-chain-change.sh` 8/8, `test-gate-in-isolation.sh` 9/9, `tui-attached.sh`
  10/10, `openspec-validate-cmd.test.sh` 6/6, and `cleanup.test.sh` 146/146 embedded within) — all
  green, matching the executor's report.
- **RED evidence independently reproduced**, not trusted from the executor's report: checked out
  the pre-fix `core/scripts/cleanup.sh` and `scripts/concertino/cleanup.sh` (`git show
  25ffd4e~1:...` over both files) with the new test file left in place, re-ran
  `bash test/scripts/cleanup.test.sh` → **143 passed, 3 failed** — matches the executor's claimed
  RED count exactly. Restored the post-fix files afterward (confirmed `git diff` clean, no stray
  changes left in the worktree).
- **HEL-560 real-marker claim independently verified** (read-only) against the actual helio repo:
  `/home/matt/Development/helio/.concertino/runs/HEL-560/events.jsonl`'s last event
  (`t":1786557443128`) is ~313 hours old — comfortably past the 6h default window — so the fix
  would correctly classify it not-live. No writes made to the helio repo.
- Design-standard review: `core/scripts/cleanup.sh` is plain bash per CONTRIBUTING.md's
  "`core/scripts/*.sh` are plain, already-runnable bash — no templating — copied verbatim" rule;
  no templating was introduced. `DESIGN.md` is not binding here (no `frontend/**` files touched).
- DRY / readable / modular: the staleness check reuses the function's existing grep-based
  file-presence check and adds one bounded backward-scan loop; no new external dependency
  (`jq`, etc.) introduced, consistent with the file's existing style. The env-var parsing mirrors
  the adjacent `CONCERTINO_CLEANUP_SKIP_SYNC` pattern almost verbatim, as design.md required.
- Type/robustness: numeric coercion for `CONCERTINO_LIVE_RUN_STALE_HOURS` uses a glob-based
  non-numeric guard (`*[!0-9]*`) before arithmetic, avoiding an unguarded `$(( ))` on
  attacker/human-supplied env input.
- Error handling: the fail-closed-to-LIVE path is exercised by an explicit adversarial fixture
  (TICK-36) with zero parseable `t` fields anywhere in the file, not just in the last line —
  closing the "scan gives up too early and finds a stale timestamp further back" gap the test's
  own comment calls out.
- No dead code: no leftover TODO/FIXME, no unused variables in the diff (`stale_hours`,
  `stale_ms`, `last_ts`, `now_ms`, `age_ms`, `line`, `i`, `lines` are all used).
- No over-engineering: no PID/lockfile machinery was added (Decision 2's rejection is honored),
  no new terminal-event kind was introduced (Decision 1's rejection is honored).
- Tests meaningful: each of the 5 new regression cases targets a distinct branch of the new logic
  (stale, recent, completed-but-old, custom-override, unparsable) and each was confirmed to
  actually exercise that branch via the RED/GREEN re-run above — a real regression in any one
  branch would be caught.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` files changed by this diff (`openspec/specs/cleanup-sync-guard/spec.md` above
is a change-scoped delta file, not the shipped `openspec/specs/**` tree, and even so this is a
pure bash procedure-script change with no UI surface). Confirmed no dev-server start was required
per the executor's own framing and the ticket's nature.

### Overall: PASS

### Non-blocking Suggestions
- None.
