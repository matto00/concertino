## 1. `assert-phase.sh`

- [x] 1.1 Record a start timestamp (`date +%s`) immediately before the `case
      "$PHASE" in` block.
- [x] 1.2 Change the `fail()` helper to also capture the *first* failure
      message into `FIRST_ERROR` (leave it untouched on later calls), trimmed
      to a bounded length (e.g. 200 chars) at assignment time.
- [x] 1.3 Compute `duration_ms` (integer milliseconds) at the point the
      existing pass/fail `gate.result` emission happens, from the delta
      against the start timestamp.
- [x] 1.4 Add `duration_ms=<n>` to both the existing pass and fail
      `emit-event.sh gate.result` call sites.
- [x] 1.5 Add `first_error=<msg>` to the fail `emit-event.sh gate.result` call
      site only, using the captured `FIRST_ERROR`.
- [x] 1.6 Verify byte-for-byte: `PASS $PHASE` / `FAIL <reason>` stdout/stderr
      output is unchanged for every phase (`setup`, `servers`, `delivery`,
      `cleanup`).

## 2. `start-servers.sh`

- [x] 2.1 In `start_one()`, record a start timestamp before the
      reuse-check/start-and-wait branch and compute `duration_ms` at the
      point the existing `gate.result` emission happens (right before `echo
      "READY ..."`).
- [x] 2.2 Add `duration_ms=<n>` to the existing `emit-event.sh gate.result`
      call site.
- [x] 2.3 Verify byte-for-byte: `READY <label>=<url>` stdout output and the
      `FAIL <label> did not become healthy...` stderr/exit behavior are
      unchanged.

## 3. Sync rendered copies

- [x] 3.1 Run `concertino sync` (or the project's documented sync command)
      against this repo's own config so `scripts/concertino/assert-phase.sh`
      and `scripts/concertino/start-servers.sh` match the updated
      `core/scripts/` sources.
- [x] 3.2 Diff `core/scripts/assert-phase.sh` vs
      `scripts/concertino/assert-phase.sh`, and `core/scripts/start-servers.sh`
      vs `scripts/concertino/start-servers.sh`, to confirm they're identical
      again.

## 4. Tests

- [x] 4.1 Add `test/scripts/assert-phase.test.sh` covering: a passing phase
      emits `gate.result` with a numeric `duration_ms` and no `first_error`;
      a failing phase emits `gate.result` with `status=fail`, a numeric
      `duration_ms`, and a `first_error` matching the first failure message
      (use the `setup` phase against throwaway directories, since it needs no
      running servers).
- [x] 4.2 Add `test/scripts/start-servers.test.sh` (or extend an existing
      fixture) covering: a `gate.result` for a server emits a numeric
      `duration_ms` (a fake `CONCERTINO_FRONTEND_START`/`CONCERTINO_FRONTEND_HEALTH`
      pair against a trivial local HTTP listener, or the "already healthy,
      reusing" branch, is sufficient — no need to exercise the real dev
      server).
- [x] 4.3 Wire both new test files into `package.json`'s `test` script
      alongside `test/scripts/emit-event.test.sh`.
- [x] 4.4 Run the full test suite (`npm test`) and confirm it passes.

## 5. Verification

- [x] 5.1 Manually exercise `assert-phase.sh setup` against a valid worktree
      path with a ticket-shaped directory name and inspect
      `.concertino/runs/<ticket>/events.jsonl` for the new fields.
- [x] 5.2 Manually exercise `assert-phase.sh setup` against a missing worktree
      path (forces a fail) and inspect the emitted event for `first_error`.
- [x] 5.3 Confirm no other caller of `assert-phase.sh` / `start-servers.sh`
      (agent role docs, other scripts) depends on the exact previous
      `gate.result` field set in a way this change would break.
