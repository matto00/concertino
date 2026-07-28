## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket ACs (fetched CON-7 from Linear directly, not from planning docs alone)**:
  1. `duration_ms` reflects true ms resolution, not multiples of 1000.
  2. Portability preserved (works where `date +%s%3N` unsupported).
  3. `READY`/`PASS`/`FAIL` stdout byte-for-byte unchanged.
  4. Telemetry can't fail a run — every emit stays `|| true`.
  5. Tests assert a sub-second gate reports a non-zero, non-1000-multiple duration.

- **AC1 — true ms resolution, with an independent regression proof (not taken on
  faith from evaluation-1.md's claim)**: extracted `core/scripts/assert-phase.sh`
  and `core/scripts/start-servers.sh` at `3e172c6~1` (pre-fix) into scratch files,
  swapped them into the tracked paths, and re-ran
  `bash test/scripts/assert-phase.test.sh` / `test/scripts/start-servers.test.sh`
  myself:
  ```
  FAIL sub-second setup run reports true ms resolution ... expected [yes] got [no]
  19 passed, 1 failed
  FAIL sub-second server-start run reports true ms resolution ... expected [yes] got [no]
  11 passed, 1 failed
  ```
  Then restored via `git checkout HEAD -- core/scripts/assert-phase.sh
  core/scripts/start-servers.sh` and re-ran: both suites pass 20/20 and 12/12, and
  `diff` against `scripts/concertino/{assert-phase,start-servers}.sh` is empty
  (mirrors intact after restore). This proves the new tests are not vacuous — they
  fail against the exact pre-fix code and pass against the fix.

- **AC2 — portability**: `now_ms()` in both scripts is a byte-identical duplicate
  of `emit-event.sh`'s existing, already-shipped helper (confirmed by direct
  comparison of the three function bodies). Additionally reproduced the BSD-date
  failure mode myself: wrote a fake `date` shim on `PATH` that fails on `%3N`
  (mimicking BSD/macOS), and confirmed under `bash -c 'set -euo pipefail; ...'`
  that the `local d; d="$(date +%s%3N 2>/dev/null)"` pattern does **not** abort the
  script even though `set -e` is active in both `assert-phase.sh` and
  `start-servers.sh` (both have `set -euo pipefail`) — the fallback to
  `node -e 'Date.now()'` fires correctly. This independently confirms the
  evaluator's claim rather than trusting the prose.

- **AC3 — stdout contract unchanged**: `git diff 3e172c6~1 3e172c6 -- core/scripts/assert-phase.sh core/scripts/start-servers.sh`
  grepped for `echo|PASS|FAIL|READY` shows zero touched emission lines (the one
  match, "already", is a false-positive substring hit inside a code comment, not
  an emission line). The full diff confirms only the clock-source lines
  (`START_TS`, `DURATION_MS`/`duration_ms`) and the new `now_ms()` block changed.
  Exact-string test assertions (`stdout is PASS setup`, `stdout is READY backend`)
  also pass unmodified.

- **AC4 — `|| true` guards**: `grep -n "emit-event.sh" core/scripts/assert-phase.sh core/scripts/start-servers.sh`
  shows exactly 3 call sites across the two modified scripts (2 in
  assert-phase.sh, 1 in start-servers.sh); all 3 end in `|| true`. No new
  unguarded call introduced.

- **AC5 — test coverage shape**: both new tests loop up to 20 times and assert
  `$((D % 1000)) != 0`, which by construction also excludes `duration_ms == 0`
  (0 is itself a multiple of 1000) — matching the ticket's "non-zero,
  non-1000-multiple" wording precisely, not just "non-1000-multiple."

- **Mirrors identical**: `diff core/scripts/assert-phase.sh scripts/concertino/assert-phase.sh`
  and the `start-servers.sh` pair both exit 0 (byte-identical), verified directly
  by me, not taken from `files-modified.md`'s claim.

- **Full test suite, run myself**: `npm test` →
  `emit-event.sh`: 36 passed; `assert-phase.sh`: 20 passed; `start-servers.sh`:
  12 passed; `concertino watch (smoke)`: 5 passed; `node --test`: `tests 70,
  pass 70, fail 0`. All zero failures.

- **Spec delta**: `openspec/specs/gate-telemetry/spec.md` (main spec, not just the
  change delta) was updated with the tightened requirement wording and new
  "Sub-second gate reports true millisecond resolution" scenario — confirmed via
  `git show 3e172c6 -- openspec/specs/gate-telemetry/spec.md`.
  `npx openspec validate --strict fix-gate-duration-precision` → "Change
  'fix-gate-duration-precision' is valid".

- **No scope creep**: `git show --stat 3e172c6` touches only the two procedure
  scripts + mirrors, two test files, two spec files (change delta + main spec),
  and the change's own planning artifacts. No reducer/dashboard/UI changes,
  consistent with the ticket's stated non-goals.

- **No UI review applicable**: change is shell-scripts/telemetry only; no UI
  changed, no design-standard check needed (N/A per orchestrator input, confirmed
  by the diff containing zero `.js`/`.jsx`/frontend files).

- **Worktree left clean after verification**: `git status --short` after my
  temporary pre-fix-code swap and restore shows only the expected
  `workflow-state.md` modification and the untracked `evaluation-1.md` — no
  residual edits from my testing.

### Verdict: CONFIRM

### Non-blocking notes
- None beyond what evaluation-1.md already surfaced (the 20-iteration retry loop
  adequately addresses the sub-second-test flakiness risk raised at the design
  gate).
