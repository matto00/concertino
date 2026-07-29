- `core/scripts/assert-phase.sh` — `delivery)` case: added the best-effort, non-blocking
  stale-base check (fetch `CONCERTINO_BASE_REMOTE`/`CONCERTINO_BASE_BRANCH`, compare
  `merge-base(HEAD, fetched tip)` to the fetched tip, print a capped stderr warning and emit a
  `gate.warning` telemetry event when they differ). Moved `GATE_TICKET`/`looks_like_ticket`
  above the phase `case` dispatch (previously computed only after it) so the `delivery` case's
  own telemetry call can use them too — behavior for every other phase is unchanged.
- `scripts/concertino/assert-phase.sh` — self-hosted rendered mirror of the above, produced via
  `node bin/concertino sync --out=.` (kept byte-identical to `core/scripts/assert-phase.sh`, as
  it was before this change).
- `test/scripts/assert-phase.test.sh` — new `assert-phase.sh delivery (CON-31 stale-base
  warning)` coverage: base current (silent, no telemetry), base 3 commits behind (warning +
  `gate.warning` event, gate still passes), base 12 commits behind (count correct, list capped
  at 5, `(+7 more)` suffix), and fetch failure (silent skip, gate unaffected).
- `ROADMAP.md` — removed the shipped "Stale-base warning at the delivery gate" near-term item.
