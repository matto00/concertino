## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All five ticket ACs verified directly:
  - `gate.result` with `gate=server:<label>`, `status=fail`, `duration_ms`, `first_error` is emitted on the health-wait timeout path (`core/scripts/start-servers.sh:62-65`), confirmed by new test case `HEL-3` in `test/scripts/start-servers.test.sh` (all 21 assertions pass, including the new 12).
  - Existing stdout/stderr `FAIL ... (log: ...)` text and `exit 1` are unchanged — diff shows only new lines inserted between the existing `echo "FAIL..."` and `exit 1`; test asserts the stderr line verbatim.
  - New emit is guarded with `|| true` (line 65), matching the existing pass-path pattern.
  - `scripts/concertino/start-servers.sh` re-rendered and confirmed byte-identical to `core/scripts/start-servers.sh` (`diff` returns no output).
  - `openspec/specs/gate-telemetry/spec.md` delta broadens all three relevant requirements ("gate.result events carry a duration", "Failing gate.result events carry the first error line", "Existing stdout and telemetry-safety contracts are preserved") to cover `start-servers.sh`'s failure path, with matching scenarios.
  - `test/scripts/start-servers.test.sh` covers the new failure emission with 9 new assertions (exit code, stderr text, event existence, kind, gate, status, duration_ms type/sign, first_error content).
- Design doc's specific mechanics matched exactly: `T` assignment moved to top of `start_one()` (line 53, before the `curl` check), same inline ticket regex reused (no new `looks_like_ticket`-style helper introduced), `first_error` content matches the decided string format, `duration_ms` measured from the same `start_ts`.
- `tasks.md`: all items in sections 1-5 marked `[x]` and match what was implemented; re-ran the two "Verification" tasks myself (`openspec validate emit-gate-result-on-fail --strict` → valid; sync diff → identical) rather than trusting the checkmarks.
- No scope creep: diff touches only `core/scripts/start-servers.sh`, its rendered mirror, the test file, and planning-doc files. No unrelated files changed.
- No regressions: reran the full existing script test suite (`assert-phase.test.sh`, `emit-event.test.sh`, `watch-smoke.test.sh`) alongside `start-servers.test.sh` — all pass (19 + 36 + 5 + 21 = 81 assertions, 0 failures).
- No API/schema changes beyond the spec delta itself, which is updated. Confirmed `lib/ui/reducer.js` already reads `duration_ms`/`first_error` generically off any `gate.result` event (`lib/ui/reducer.js:87-88`) — no reducer change needed or made, consistent with the proposal's stated impact.
- Planning artifacts (proposal/design/tasks/spec delta) accurately reflect the final implemented behavior; no divergence found.

### Phase 2: Code Review — PASS
Issues: none.

- Emission sits inside the `if ! timeout ...; then` block, after the existing `FAIL` echo and before `exit 1`, guarded by `|| true` — telemetry cannot affect the exit path or exit code.
- `fail_duration_ms` computed via the same `$(( ($(date +%s) - start_ts) * 1000 ))` pattern already used on the pass path (line 69) — consistent, no new arithmetic idiom introduced, and (being a pre-existing pattern reused verbatim) carries no new `set -e` risk.
- DRY: the ticket-name guard regex, the `emit-event.sh` invocation shape, and the `duration_ms` computation are all reused verbatim from the existing pass-path call site rather than reintroduced as a new abstraction — appropriately minimal diff, matching the design's explicit "no new helper" decision.
- Readable: `first_error` string is self-describing and matches the stderr message content (minus the host-local log path, per design rationale).
- No dead code, no leftover TODO/FIXME, no unused imports.
- No over-engineering — no trap-based refactor, no new function, single straight-line addition as designed.
- Test additions are meaningful: they exercise the real failure code path with an unreachable URL (`http://127.0.0.1:1/`) and a 1s timeout, and would catch a regression in any of exit code, stderr text, event emission, or field correctness (status/duration_ms/first_error).
- Security/error-handling: no new user input is parsed or trusted beyond what already existed (label/url/timeout are script-internal config); no injection surface introduced.
- No canonical code-quality standard is configured for this repo (per task input), so no standard-specific mechanical citations apply beyond the above general checks.

### Phase 3: UI Review — N/A
No UI review configured for this project; dev-server phase skipped per instructions.

### Overall: PASS

### Change Requests
(none — no FAIL)

### Non-blocking Suggestions
- None.
