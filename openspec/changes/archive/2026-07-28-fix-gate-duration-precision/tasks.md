## 1. `assert-phase.sh`

- [x] 1.1 Add the `now_ms()` helper (duplicated from `core/scripts/emit-event.sh`
      line ~31: `date +%s%3N`, falling back to `node -e 'process.stdout.write(String(Date.now()))'`
      when unsupported) to `core/scripts/assert-phase.sh`.
- [x] 1.2 Replace `START_TS="$(date +%s)"` with `START_TS="$(now_ms)"`.
- [x] 1.3 Replace `DURATION_MS=$(( ($(date +%s) - START_TS) * 1000 ))` with
      `DURATION_MS=$(( $(now_ms) - START_TS ))`.
- [x] 1.4 Verify byte-for-byte: `PASS $PHASE` / `FAIL <reason>` stdout/stderr
      output is unchanged for every phase (`setup`, `servers`, `delivery`,
      `cleanup`).

## 2. `start-servers.sh`

- [x] 2.1 Add the same `now_ms()` helper to `core/scripts/start-servers.sh`.
- [x] 2.2 Replace `local start_ts; start_ts="$(date +%s)"` with
      `local start_ts; start_ts="$(now_ms)"` in `start_one()`.
- [x] 2.3 Replace `local duration_ms=$(( ($(date +%s) - start_ts) * 1000 ))`
      with `local duration_ms=$(( $(now_ms) - start_ts ))`.
- [x] 2.4 Verify byte-for-byte: `READY <label>=<url>` stdout output and the
      `FAIL <label> did not become healthy...` stderr/exit behavior are
      unchanged.

## 3. Sync rendered copies

- [x] 3.1 Apply the identical `now_ms()` + measurement changes to
      `scripts/concertino/assert-phase.sh` and
      `scripts/concertino/start-servers.sh` (via `concertino sync` against this
      repo's own config if that path is wired up; otherwise hand-mirror the
      edit).
- [x] 3.2 Diff `core/scripts/assert-phase.sh` vs
      `scripts/concertino/assert-phase.sh`, and `core/scripts/start-servers.sh`
      vs `scripts/concertino/start-servers.sh`, to confirm they're identical.

## 4. Tests

- [x] 4.1 Extend `test/scripts/assert-phase.test.sh`: assert that a passing
      `setup` phase whose checks run in well under a second reports a
      `duration_ms` that is both non-negative and NOT a multiple of 1000 (a
      probabilistic but effectively-always-true assertion at this timescale —
      follow the existing file's `node -e` JSON-field-extraction pattern).
- [x] 4.2 Extend `test/scripts/start-servers.test.sh` (or add if the CON-1
      change didn't leave meaningful coverage here) with the analogous
      non-1000-multiple assertion for a server-start `gate.result`.
- [x] 4.3 Run `npm test` and confirm the full suite passes.

## 5. Spec sync

- [x] 5.1 Confirm `openspec/changes/fix-gate-duration-precision/specs/gate-telemetry/spec.md`'s
      MODIFIED requirement wording matches the implemented behavior (millisecond
      resolution, no whole-second quantization). Applied the same MODIFIED
      requirement to `openspec/specs/gate-telemetry/spec.md` (the main spec);
      `openspec validate --strict fix-gate-duration-precision` confirms the
      change is valid.

## 6. Verification

- [x] 6.1 Manually exercise `assert-phase.sh setup` against a valid worktree
      path with a ticket-shaped directory name and inspect
      `.concertino/runs/<ticket>/events.jsonl` for a non-1000-multiple
      `duration_ms`. (Scratch repo `HEL-9`: `duration_ms: 1`.)
- [x] 6.2 Manually exercise `assert-phase.sh setup` against a missing worktree
      path (forces a fail) and confirm `duration_ms` and `first_error` are both
      still present and correct. (Scratch repo `HEL-10`: `status: "fail"`,
      `duration_ms: 2`, `first_error: "worktree dir missing: ..."`.)
- [x] 6.3 Confirm no other caller of `assert-phase.sh` / `start-servers.sh`
      depends on the previous whole-second-quantized `duration_ms` values in a
      way this change would break (should be none — the field stayed the same
      type, only more precise). `grep -rn duration_ms` across the repo shows
      only `lib/ui/reducer.js` consuming it (`ev.duration_ms != null ? ... :
      null`, a plain pass-through) and test files asserting numeric/non-negative
      — no consumer depends on the value being a multiple of 1000.
