## Context

`core/scripts/assert-phase.sh` and `core/scripts/start-servers.sh` each already
call `core/scripts/emit-event.sh gate.result ...` at one or more points. The
reducer (`lib/ui/reducer.js`) already has a `gate.result` case that reads
`ev.duration_ms` and `ev.first_error`, defaulting both to `null` when absent —
so this change is additive on the emitter side only; no reducer or dashboard
change is needed or in scope.

Both scripts run under `set -euo pipefail` and use `|| true` around every
`emit-event.sh` call today, per the existing "telemetry never fails a run"
convention documented in `emit-event.sh`'s header comment.

## Goals / Non-Goals

**Goals:**
- Every existing `gate.result` emission from `assert-phase.sh` and
  `start-servers.sh` carries `duration_ms`, measured around the work that call
  site actually gates (not the whole script).
- `assert-phase.sh`'s failing-path emission carries `first_error`: the first
  line of the accumulated failure text.
- `first_error` is trimmed at the source (not just relying on
  `emit-event.sh`'s whole-line truncation) so an oversized error doesn't blow
  the 4000-byte cap and silently drop every other field on that line.
- `READY` / `PASS` / `FAIL` stdout is byte-for-byte unchanged.
- `scripts/concertino/*.sh` stay in sync with `core/scripts/*.sh` via
  `concertino sync` (this project runs concertino on itself).

**Non-Goals:**
- Adding a new failure-path `gate.result` emission to `start-servers.sh`. It
  has none today — a server that never becomes healthy is treated as an
  environmental `BLOCKER`, not a gate result, and inventing one is outside this
  ticket's acceptance criteria.
- Any reducer, dashboard, or event-schema-version change — the consumer side
  already handles these fields.
- Sub-millisecond precision or monotonic-clock guarantees; wall-clock seconds
  (`date +%s`) multiplied to milliseconds is sufficient for a UI timing panel.

## Decisions

**Duration measurement: `date +%s` deltas around each gated unit of work, not
a shared helper.**
`assert-phase.sh`'s `case` statement runs a different check per phase
(`setup`/`servers`/`delivery`/`cleanup`); the gate result is emitted once,
after the `case` block, for whichever phase ran. So duration is measured by
recording `START=$(date +%s)` immediately before the `case` statement and
computing `duration_ms=$(( (SECONDS_NOW - START) * 1000 ))` at the point the
existing pass/fail emission already happens. `start-servers.sh` emits per
server inside `start_one()`, so duration is measured inside that function,
around the health-wait/reuse branch, per invocation (once for backend, once
for frontend) — each gets its own accurate duration rather than one shared
number.

Alternative considered: a `time_it()` wrapper function shared by both scripts.
Rejected — the two scripts gate different shapes of work (one `case` block
emitting once; one function invoked per server), so a generic wrapper would
need to thread the emit call through anyway, adding indirection without
removing any duplication that matters at this scale (two call sites total).

Alternative considered: `date +%s%3N` (millisecond resolution, matching
`emit-event.sh`'s own `now_ms()`). Rejected for the *measurement* — reusing
`now_ms()` from `emit-event.sh` would require sourcing it or duplicating its
BSD/macOS `%3N` fallback in two more places. Since a gate takes at minimum
tens of milliseconds and typically seconds, second-resolution deltas
multiplied by 1000 are accurate enough for the UI's purpose (this is a timing
*panel*, not a profiler) and keep the change to the two files the ticket names.

**`first_error` capture: track the first failing message text, not re-parse
stderr.**
`assert-phase.sh`'s `fail()` helper already receives the human-readable reason
as `"$*"` and prints it to stderr. It's changed to also record the *first*
call's message into a variable (`FIRST_ERROR`), left empty on subsequent
calls. This avoids re-scraping stderr (which is not captured to a variable
today, only streamed) and matches "first line of the failure output" directly
from the source that already generates that text.

**Trimming `first_error` at the source.**
`FIRST_ERROR` is capped to 200 characters before being passed to
`emit-event.sh` (`${FIRST_ERROR:0:200}`). 200 chars comfortably fits every
existing `fail()` message in `assert-phase.sh` untruncated (the longest today
is the worktree-missing message, well under 100 chars) while leaving enormous
headroom under the 4000-byte line cap for the other fixed fields
(`t`, `kind`, `project`, `ticket`, `role`, `gate`, `status`, `duration_ms`).
`emit-event.sh`'s existing `json_escape` still runs on the value, so embedded
quotes/newlines stay safe; the source-side trim is a courtesy so a future long
`fail()` message degrades to "truncated but present" rather than "dropped
along with the rest of the line" per `write_line`'s all-or-nothing truncation
(it replaces the entire `FIELDS` string, not just the oversized field, when
the total line exceeds the cap).

## Risks / Trade-offs

- [Second-resolution timing rounds very fast gates (e.g. `setup`, which is
  just filesystem stat calls) down to `0`ms] → Acceptable: `duration_ms: 0` is
  a valid, honest measurement, not a bug, and the ticket doesn't require
  sub-second resolution.
- [`start_one`'s reuse branch ("already healthy, reusing") measures only the
  cheap health-check, not a real startup] → Correct behavior by design: the
  duration reflects what that invocation actually did.
- [Two source-of-truth copies (`core/scripts/` and `scripts/concertino/`) can
  drift if `concertino sync` isn't re-run] → Mitigated by running `concertino
  sync` as part of this change's task list and verifying the two files are
  identical again (the existing convention per `df083a3`).

## Migration Plan

Not applicable — additive telemetry fields, no data migration, no rollback
concerns beyond a normal revert.
