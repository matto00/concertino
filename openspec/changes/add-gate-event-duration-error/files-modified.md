- `core/scripts/assert-phase.sh` — source of truth: measures wall-clock duration around the phase's checks and emits `duration_ms` on both the pass and fail `gate.result` events; `fail()` now also captures the first failure message into `FIRST_ERROR` (trimmed to 200 chars at the source) and emits it as `first_error` on the fail path only. `fail()` is changed to always `return 0` regardless of branch — see the root-cause note below.
- `core/scripts/start-servers.sh` — source of truth: `start_one()` measures wall-clock duration around the reuse-check/start-and-wait sequence for one server and emits `duration_ms` on its `gate.result` event.
- `scripts/concertino/assert-phase.sh` — re-rendered from `core/scripts/assert-phase.sh` via `concertino sync`; byte-identical to the core source.
- `scripts/concertino/start-servers.sh` — re-rendered from `core/scripts/start-servers.sh` via `concertino sync`; byte-identical to the core source.
- `test/scripts/assert-phase.test.sh` — new shell tests: passing `setup` phase emits `duration_ms` with no `first_error`; failing `setup` phase (two checks trip) emits `duration_ms` and a `first_error` equal to only the *first* failure message; an oversized `delivery`-phase failure message is trimmed to 200 chars at the source.
- `test/scripts/start-servers.test.sh` — new shell tests: a backend `gate.result` (via the "already healthy, reusing" branch against a trivial local HTTP listener) carries a numeric, non-negative `duration_ms`; no server configured emits no event and exits 0.
- `package.json` — wires `test/scripts/assert-phase.test.sh` and `test/scripts/start-servers.test.sh` into the `test` script alongside the existing `emit-event.test.sh`.
- `openspec/changes/add-gate-event-duration-error/tasks.md` — all tasks marked complete.

## Root cause note (systematic-debugging)

**Root cause:** `assert-phase.sh`'s `fail()` helper, as first written for this change, ended with `[ -z "$FIRST_ERROR" ] && FIRST_ERROR=...`. On the *second* (and later) call within one phase — where `$FIRST_ERROR` is already set — the `&&` short-circuits and the compound command evaluates to non-zero, which becomes `fail()`'s own return status. Every call site is `check || fail "..."`; when `fail()` itself returns non-zero as the last command of that `||` list, `set -euo pipefail` kills the whole script right there, before the `gate.result` emission at the bottom of the file is ever reached.

**Probe:** `bash -x core/scripts/assert-phase.sh setup <missing-worktree>` (a case that trips two `fail()` calls in a row).

**Probe output (before the fix):** the trace shows both `FAIL` lines printed, then stops immediately after `+ '[' -z 'worktree dir missing: ...' ']'` with the shell exiting — never reaching the `GATE_TICKET`/`emit-event.sh` block. `test/scripts/assert-phase.test.sh`'s two-failure case failed with `events.jsonl` never created.

**Fix:** rewrote `fail()` to end with an explicit `return 0` after an `if`/`fi` (not a trailing `&&`), so its own exit status is always 0 on every branch, matching its pre-change behavior. Re-ran the probe and the full test file: the `gate.result` event is now written on both the single-failure and multi-failure paths (`test/scripts/assert-phase.test.sh`, 19/19 passing).
