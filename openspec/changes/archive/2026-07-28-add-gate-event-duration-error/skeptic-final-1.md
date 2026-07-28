## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket + diff re-read from scratch**: `openspec/changes/add-gate-event-duration-error/ticket.md`
  (5 ACs) and `git diff main...HEAD --stat` — 16 files, all within scope
  (`core/scripts/{assert-phase,start-servers}.sh`, their `scripts/concertino/`
  rendered copies, two new test files, `package.json` test-script wiring, and
  openspec change artifacts). No unrelated files touched.

- **AC1 (`duration_ms` on every `gate.result`)**: read the full diff of both
  scripts (`git diff main...HEAD -- core/scripts/assert-phase.sh
  core/scripts/start-servers.sh`). `assert-phase.sh` records `START_TS` before
  the `case` block and computes `DURATION_MS` right before both the pass and
  fail emit call sites (lines 50, 111, 114-115, 119-120). `start-servers.sh`'s
  `start_one()` records `start_ts` before the reuse-check/start-and-wait branch
  and computes `duration_ms` right before its one `gate.result` emission (lines
  52, 64, 66-67). Both existing emit call sites now carry `duration_ms=`.

- **AC2 (`first_error` on failing gate, truncated to fit the cap)**: `fail()`
  in `assert-phase.sh` (lines 28-43) captures only the *first* call's message
  into `FIRST_ERROR`, trimmed to `${msg:0:200}` at assignment. Emitted only on
  the fail-path `gate.result` (line 115). Read `core/scripts/emit-event.sh`
  in full and confirmed `MAX_LINE=4000` / `write_line`'s truncation is
  whole-line, all-or-nothing (drops all fields into `{"truncated":true}` if
  the line exceeds the cap) — so trimming `first_error` at the source to 200
  chars is the correct mitigation, not decorative.

- **AC3 (stdout/stderr contracts byte-for-byte unchanged)** — verified this
  empirically rather than by reading the diff, since "unchanged" claims are
  exactly the kind of thing worth reproducing:
  - Checked out `main`'s `core/scripts/assert-phase.sh` and `emit-event.sh`
    into a scratch dir, ran both the old and new `assert-phase.sh setup`
    against (a) a valid worktree and (b) a missing one, and diffed the
    captured stdout+stderr+exit-code byte-for-byte. **Identical in both
    cases** (`PASS setup` / two `FAIL ...` lines / exit 1).
  - Did the same for `start-servers.sh` against a fake healthy listener (the
    "already healthy, reusing" branch): old vs. new stdout+stderr **identical**
    (`note: backend already healthy...` / `READY backend=...`).
  - `diff core/scripts/{assert-phase,start-servers}.sh
    scripts/concertino/{assert-phase,start-servers}.sh` — both empty; the
    rendered copies are byte-identical to the sources (task 3.2 satisfied).

- **AC4 (telemetry can't fail a run)**: every `emit-event.sh gate.result` call
  site in both scripts still ends in `|| true` (confirmed by reading the full
  diff, not just grep). Also traced the `set -e` interaction the executor's
  root-cause note describes: `fail()` now ends in an unconditional `return 0`
  on every branch (not the old buggy `&&`-chain), so a second-or-later
  `check || fail ...` in one phase can never itself kill the script under
  `set -euo pipefail`. Confirmed this holds for the `cleanup` phase's
  `curl ... && fail ... || true` pattern too (traced the four
  success/failure permutations by hand — always resolves to exit 0 for that
  statement regardless of `fail()`'s new behavior).

- **AC5 (shell tests for pass+duration and fail+first-error)**: read
  `test/scripts/assert-phase.test.sh` (3 scenarios / 19 assertions — passing
  phase with numeric duration and no `first_error`; failing phase with two
  tripped checks confirming `first_error` is only the *first* message;
  oversized message trimmed to exactly 200 chars) and
  `test/scripts/start-servers.test.sh` (2 scenarios / 11 assertions — reuse
  branch with numeric duration; nothing-configured branch is a no-op). Ran
  both independently, fresh: `bash test/scripts/assert-phase.test.sh` → 19
  passed, 0 failed; `bash test/scripts/start-servers.test.sh` → 11 passed, 0
  failed.

- **Full suite**: ran `npm test` fresh (not trusting the evaluator's pasted
  output) — `node --test` (all `lib/ui` reducer/fleet/render tests),
  `emit-event.test.sh` (36 passed), `assert-phase.test.sh` (19 passed),
  `start-servers.test.sh` (11 passed), `watch-smoke.test.sh` (5 passed).
  Overall exit code 0, no failures anywhere.

- **openspec validate**: `npx openspec validate add-gate-event-duration-error
  --strict` → "Change 'add-gate-event-duration-error' is valid". Read
  `specs/gate-telemetry/spec.md` — three ADDED requirements with scenarios
  that faithfully mirror the ticket's 5 ACs and the design's stated
  trim-at-source / first-only semantics.

- **Non-goal check (no new failure-path emission in `start-servers.sh`)**:
  confirmed via the diff and design.md's explicit non-goal that
  `start-servers.sh` had no failing `gate.result` emission before this change
  and still has none — a server that never becomes healthy stays an
  environmental BLOCKER (`exit 1` with a `FAIL` line, no telemetry). This
  matches the ticket's AC1 wording ("emit `duration_ms` on every `gate.result`"
  — every *emitted* event, not a mandate to invent a new emission point) and
  was already flagged and accepted at the design gate
  (`skeptic-design-1.md`).

- **Debugging law check**: `files-modified.md`'s root-cause note describes a
  real bug the executor introduced and caught mid-implementation (a
  `&&`-terminated `fail()` body whose return status regressed under `set -e`
  on the second-or-later call within one phase, killing the script before the
  `gate.result` emission). Probe (`bash -x ... setup <missing-worktree>`,
  trace stopping right after the second `fail()` call) is recorded, the fix
  (`return 0` unconditionally) is present in the final code, and
  `test/scripts/assert-phase.test.sh`'s "multiple checks fail" scenario
  exercises exactly that path (two tripped checks in one phase, `gate.result`
  still reaches disk) — a regression here would fail that test, so the test
  is not vacuous.

- **No dependents broken**: grepped the whole repo for `gate.result` consumers
  outside this change — only `lib/ui/reducer.js` (already reads
  `ev.duration_ms`/`ev.first_error` with `null` defaults, confirmed at lines
  87-88, untouched by this diff) and test fixtures that already assume
  `duration_ms` (`test/reducer.test.js`, `test/fleet.test.js`). Nothing reads
  the old bare `gate, status` field set in a way this change would break.

- **UI gate**: N/A per the task brief — this project has no UI standard
  configured, and the diff touches no UI files (`lib/ui/*` untouched). Skipped
  the dev-server/screenshot step as instructed.

### Verdict: CONFIRM

### Non-blocking notes
- Second-resolution timing (`date +%s` deltas ×1000) means `duration_ms` will
  only ever be a multiple of 1000. This was already disclosed and accepted at
  the design gate as an intentional trade-off, not a defect — noting it again
  here only because a future reader of the dashboard's timing panel might
  otherwise assume millisecond resolution.
