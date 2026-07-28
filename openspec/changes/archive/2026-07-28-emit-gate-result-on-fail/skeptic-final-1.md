## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff.** `git diff main...HEAD --stat` in the worktree: only
  `core/scripts/start-servers.sh` (+6/-1), `scripts/concertino/start-servers.sh`
  (+6/-1, mirror), `test/scripts/start-servers.test.sh` (+27), the
  `gate-telemetry` spec delta, and change-folder planning docs. No scope creep.

- **AC1 — `gate.result` with `gate=server:<label>`, `status=fail`,
  `duration_ms`, `first_error` on health-wait timeout.** Read
  `core/scripts/start-servers.sh:61-67`: the new emit sits inside the
  `if ! timeout ...; then` block, after the existing `echo "FAIL ..." >&2`
  and before `exit 1`:
  ```
  CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
    "ticket=${T}" "gate=server:${label}" "status=fail" "duration_ms=${fail_duration_ms}" \
    "first_error=${label} did not become healthy at ${url} within ${timeout}s" || true
  ```
  Confirmed live by running `bash test/scripts/start-servers.test.sh` myself
  (not trusting the evaluator's pasted output) — the new `HEL-3` case starts a
  server with an unreachable health URL (`http://127.0.0.1:1/`) and a 1s
  timeout, then parses the emitted `events.jsonl` line with `node -e
  JSON.parse(...)` and asserts `kind=gate.result`, `gate=server:backend`,
  `status=fail`, `duration_ms` is a non-negative number, and `first_error`
  is non-empty and includes the health URL. All 21 assertions passed
  (`21 passed, 0 failed`), reproduced twice.

- **AC2 — stdout/stderr and `exit 1` unchanged.** Diff shows the new lines
  inserted strictly between the pre-existing `echo "FAIL..."` and the
  pre-existing `exit 1` — neither of those two lines was touched. Test
  asserts `stderr FAIL line unchanged` matches the exact prior format and
  `exit 1 on health timeout` — both pass.

- **AC3 — telemetry cannot fail the run.** The emit line ends in `|| true`,
  identical guard shape to the pre-existing pass-path emission two lines
  below it (`core/scripts/start-servers.sh:70-71`). Verified `emit-event.sh`
  itself runs under `set -uo pipefail` (no `-e`) and its header comment
  states it "ALWAYS exits 0 in normal mode" — consistent with symmetry.

- **AC4 — `scripts/concertino/start-servers.sh` byte-identical to
  `core/scripts/start-servers.sh`.** Ran `diff core/scripts/start-servers.sh
  scripts/concertino/start-servers.sh` myself → no output, `IDENTICAL`.

- **AC5 — `gate-telemetry` spec updated to cover `start-servers.sh`'s
  failure path.** Read the full spec delta at
  `openspec/changes/emit-gate-result-on-fail/specs/gate-telemetry/spec.md`:
  new scenarios "Failing server-start gate reports its duration" and
  "Server that never becomes healthy reports a first error" explicitly cover
  the new behavior; a fourth requirement/scenario locks the byte-for-byte
  stderr/exit-code contract for `start-servers.sh`'s failure path
  specifically. Ran `npx openspec validate emit-gate-result-on-fail --strict`
  myself → `Change 'emit-gate-result-on-fail' is valid`.

- **AC6 — test coverage.** `test/scripts/start-servers.test.sh` new case
  (`HEL-3`) covers exit code, unchanged stderr text, event existence, kind,
  gate name, status, `duration_ms` type/sign, and `first_error`
  content/presence — 12 new assertions, all passing when run directly.

- **Regression check — full suite.** Ran `npm test` myself (not the
  evaluator's paste): `node --test` (all fleet/reducer/format/session unit
  tests pass), then `emit-event.test.sh` (36/36), `assert-phase.test.sh`
  (19/19), `start-servers.test.sh` (21/21), `watch-smoke.test.sh` (5/5). Zero
  failures across the whole suite, run twice for stability.

- **`set -e` / compound-command correctness.** Traced the
  `[[ "$T" =~ regex ]] && emit-event.sh ... || true` idiom under the
  script's global `set -euo pipefail`: the trailing `|| true` makes the
  compound statement's exit status always 0 regardless of whether the regex
  matched or the emit succeeded, so the following `exit 1` always executes as
  intended — this is the exact same idiom already used (and presumably
  already trusted) on the pass path two lines later, so no new risk is
  introduced.

- **Reducer already generic.** Read `lib/ui/reducer.js`'s `gate.result` case
  (around line 83-92): it reads `ev.gate`, `ev.status`, `ev.duration_ms`,
  `ev.first_error` generically off any `gate.result` event kind — no
  dashboard code needed to change for this event to show up in the gate
  panel, consistent with the proposal's stated no-op-on-reducer claim.

- **Scope / tasks.md.** `grep -c '\[ \]' tasks.md` → 0 unchecked items;
  `grep -c '\[x\]' tasks.md` → 9 checked. Matches the evaluator's claim.

- **Design fidelity.** Compared `design.md`'s "Decisions" section
  line-by-line against the diff: `first_error` string format, `duration_ms`
  measured from the same `start_ts`, the `T` assignment moved to the top of
  `start_one()`, the inline regex reused verbatim (no new
  `looks_like_ticket`-style helper) — all match exactly what's implemented.

### N/A domains
No UI is configured for this project (per gate instructions) — this change
is a shell-script/telemetry change with no dev-server-visible surface, so
section 4 (UI/design judgment) does not apply. Servers were not started for
this review since there is no view to screenshot.

### Verdict: CONFIRM

### Non-blocking notes
- None. The change is small, symmetric with the existing pass-path pattern
  and with `assert-phase.sh`'s prior art, fully tested, and every stated
  acceptance criterion is traceable to real code and a passing test I ran
  myself.
