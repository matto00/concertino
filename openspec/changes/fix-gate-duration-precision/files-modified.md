# Files Modified

- `core/scripts/assert-phase.sh` — added a duplicated `now_ms()` helper (GNU `date +%s%3N`, falling back to `node -e 'Date.now()'`) and swapped `START_TS`/`DURATION_MS` from whole-second `date +%s` deltas to true millisecond timestamps. `PASS`/`FAIL` stdout/stderr contract unchanged.
- `core/scripts/start-servers.sh` — same `now_ms()` helper added; `start_ts`/`duration_ms` inside `start_one()` swapped from `date +%s` deltas to `now_ms()`. `READY`/`FAIL` stdout/stderr contract unchanged.
- `scripts/concertino/assert-phase.sh` — rendered mirror of the above, regenerated via `node bin/concertino sync --config=concertino.config.json --out=.` and confirmed byte-identical to `core/scripts/assert-phase.sh`.
- `scripts/concertino/start-servers.sh` — rendered mirror of the above, confirmed byte-identical to `core/scripts/start-servers.sh`.
- `openspec/specs/gate-telemetry/spec.md` — applied the MODIFIED "gate.result events carry a duration" requirement drafted in the change's delta: tightened wording to require millisecond-resolution timestamps (not whole-second deltas) and added the "Sub-second gate reports true millisecond resolution" scenario.
- `test/scripts/assert-phase.test.sh` — added a sub-second `setup`-phase test that samples up to 20 runs and asserts at least one reports a `duration_ms` that is not a multiple of 1000 (proves true ms resolution; tolerates a legitimate rare exact-millisecond-tick 0 result without flaking).
- `test/scripts/start-servers.test.sh` — added the analogous sub-second server-start test for the "already healthy, reusing" branch.
