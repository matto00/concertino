## Context

`core/scripts/assert-phase.sh` computes `DURATION_MS=$(( ($(date +%s) - START_TS) * 1000 ))` around its `case "$PHASE" in` block; `core/scripts/start-servers.sh` does the identical thing inside `start_one()` around the reuse-check-or-start sequence. Both are whole-second deltas multiplied by 1000, so every emitted `duration_ms` is a multiple of 1000 regardless of true elapsed time. `core/scripts/emit-event.sh` already has an 8-line `now_ms()` that measures true milliseconds via `date +%s%3N`, falling back to `node -e 'Date.now()'` where `%3N` is unsupported (BSD/macOS `date`). `scripts/concertino/` holds rendered copies of these three files, kept in sync via `concertino sync` (this project runs concertino on itself, per the CON-1 design doc) — both trees need the identical fix.

## Goals / Non-Goals

**Goals:**
- `assert-phase.sh` and `start-servers.sh` measure `duration_ms` with true millisecond resolution, using the same GNU/BSD-portable strategy as `emit-event.sh`'s `now_ms()`.
- `READY` / `PASS` / `FAIL` stdout is byte-for-byte unchanged.
- Every `emit-event.sh` call site keeps its `|| true` guard — telemetry still cannot fail a run.
- `core/scripts/` and `scripts/concertino/` stay identical after the fix.

**Non-Goals:**
- No change to the `gate.result` field name, type, or JSON shape — `duration_ms` stays an integer count of milliseconds.
- No reducer, dashboard, or event-schema-version change — the consumer already treats `duration_ms` as a plain (now more precise) integer.
- No monotonic-clock guarantee — wall-clock milliseconds are sufficient for a UI timing panel; this fixes resolution, not clock semantics.

## Decisions

**Duplicate `now_ms()` into `assert-phase.sh` and `start-servers.sh` rather than sourcing `emit-event.sh`.**
This matches the existing convention (documented in the CON-1 design doc) that these procedure scripts stay standalone and don't cross-source each other — `assert-phase.sh` and `start-servers.sh` already *call* `emit-event.sh` as a subprocess for the actual emit, but neither sources it for internals. The helper is 8 lines; duplicating it into two files is cheaper and less coupling than introducing a new shared-lib file that all three scripts would need to source (which would also require path-resolution logic in each caller to find the shared file reliably from any invocation cwd).

Alternative considered: extract `now_ms()` into a new `core/scripts/lib/time.sh` sourced by all three scripts. Rejected — three call sites is exactly the scale at which this codebase's own convention (per the CON-1 design doc's rationale for not sharing a `time_it()` wrapper) says duplication is fine; a shared lib file adds a fourth file to keep in sync via `concertino sync` and a sourcing path-resolution concern for no real benefit at this size.

**Keep the measurement points identical to the current code — only swap the clock.**
`assert-phase.sh` still records its start timestamp immediately before the `case "$PHASE" in` block and computes the delta at the existing pass/fail emission point; `start-servers.sh` still measures inside `start_one()` around the reuse-check-or-start branch. Only `date +%s` (and the `* 1000` multiplication) is replaced by `now_ms()` and a plain subtraction. This keeps the diff minimal and avoids re-litigating CON-1's already-accepted decisions about *where* duration is measured.

**Sync `scripts/concertino/` by re-running `concertion sync` (or hand-mirroring if `sync` targets a different config), then diffing to confirm identical.**
Same approach CON-1 used. If `concertino sync` requires a specific config file this repo doesn't have wired to itself in one command, the fallback is to apply the identical edit by hand to `scripts/concertino/assert-phase.sh` and `scripts/concertino/start-servers.sh` and diff against `core/scripts/` to confirm byte-identical results.

## Risks / Trade-offs

- [`date +%s%3N` behaves differently across GNU/BSD `date`, exactly the portability concern CON-1's design doc flagged] → Mitigated: reusing the exact fallback logic already proven in `emit-event.sh`'s `now_ms()` (falls back to `node -e 'Date.now()'`, already a hard Concertino dependency) rather than inventing a new one.
- [Two more copies of an 8-line helper (four total across the repo, counting `core/` and `scripts/concertino/` copies of each) is duplication] → Accepted: matches this codebase's existing convention of small standalone procedure scripts over a shared-sourcing model; the two-copy cost was already implicitly accepted by `scripts/concertino/` mirroring `core/scripts/` at all.
- [Existing tests assert nothing about resolution today, only that `duration_ms` is a non-negative integer] → Addressed in tasks: new assertions that a sub-second gate reports a non-zero, non-1000-multiple value, so a regression back to whole-second quantization would be caught.
