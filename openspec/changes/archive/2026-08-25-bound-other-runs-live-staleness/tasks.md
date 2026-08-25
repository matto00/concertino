## 1. Implementation

- [x] 1.1 Add a staleness-window check to `other_runs_live()` in `core/scripts/cleanup.sh`: only report a run live when `run.start` present, `run.end` absent, AND the last extractable event's `t` timestamp is within `CONCERTINO_LIVE_RUN_STALE_HOURS` (default 6) hours of now.
- [x] 1.2 Extract the last event's timestamp by scanning backwards from the end of the file for the last line that parses as a JSON object with a numeric `t` field (not a blind `tail -1`), matching the existing grep/awk-based style already used in this function. If no such line is found, fall back to today's presence-based verdict (treat as LIVE) — never treat an unparsable timestamp as "not live."
- [x] 1.3 Document `CONCERTINO_LIVE_RUN_STALE_HOURS` alongside `CONCERTINO_CLEANUP_SKIP_SYNC` in the same file's comments.
- [x] 1.4 Correct the in-code comment at `core/scripts/cleanup.sh:413-420`, which currently claims a stuck run "stays 'live' by this test until its run dir is pruned (`lib/ui/retention.js` prunes exactly those, by mtime)" — this is backwards. `retention.isEligible()` requires `hasRunEnd()`, so retention never prunes exactly the stuck-marker case; that's why the staleness bound in this change is needed instead. Do not carry the inverted claim forward into the replacement comment.
- [x] 1.5 Re-render the change into the WORKTREE's own `scripts/concertino/cleanup.sh` (this worktree, not the main checkout — the test suite in task 2.2 executes the worktree's rendered copy) and commit both `core/scripts/cleanup.sh` and the re-rendered `scripts/concertino/cleanup.sh` together.

## 2. Verification (red-then-green, permanent regression coverage)

- [x] 2.1 In `test/scripts/cleanup.test.sh`, parameterise `fake_event()`'s hardcoded `"t":1` (1970) to accept an optional timestamp argument defaulting to "now" (epoch ms), so existing liveness test cases (TICK-88/TICK-30/TICK-31 etc.) keep passing for the reason they always did — recency — not by accident.
- [x] 2.2 Add permanent regression cases to `test/scripts/cleanup.test.sh`'s CON-66 section (near line 500-570) covering, in addition to the existing scenarios:
  - a stale run (`run.start`, no `run.end`, `t` older than the staleness window) ⇒ sync proceeds (this is the HEL-560 shape — the RED case before the fix, GREEN after)
  - a recent run (`run.start`, no `run.end`, `t` within the window) ⇒ sync still skipped (the no-false-negative case)
  - `run.end` present with an old `t` ⇒ sync still proceeds, unchanged from today (regression guard)
  - `CONCERTINO_LIVE_RUN_STALE_HOURS` override is honoured (e.g. a run just outside a shortened custom window is treated as not-live)
  - an unparsable/missing `t` on the last line ⇒ treated as live (fails closed, per design Decision 5)
- [x] 2.3 Capture RED: run the new stale-run test case against the pre-fix `other_runs_live()` (e.g. via a throwaway checkout of the pre-change script, or by temporarily reverting the staleness check) and confirm it reports live / sync is skipped. Save this as evidence.
- [x] 2.4 Capture GREEN: after the fix, run the full `test/scripts/cleanup.test.sh` (via `npm test` or standalone) and confirm all cases pass, including the new ones from 2.2.
- [x] 2.5 Run the full `npm test` suite (this file is already wired into it per `package.json`) and confirm no other suite regressed.

## 3. Wrap-up

- [x] 3.1 Confirm HEL-560's real marker (read-only, in the helio repo) would now be classified not-live under the new logic (dry-run classification only — never modify the helio repo).
- [x] 3.2 Update files-modified.md / commit per squash-branch conventions.
