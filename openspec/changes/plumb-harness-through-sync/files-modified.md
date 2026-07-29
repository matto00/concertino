# Files modified — CON-2 plumb-harness-through-sync

- `bin/concertino` — `renderEnv(c)` now writes a `CONCERTINO_HARNESS` line
  (the single configured harness, or empty when more than one is configured);
  `cmdValidate`'s "Integrations" section gains an informational
  `harness telemetry` line reporting static vs. runtime-detected resolution
  (never a validation failure).
- `core/scripts/setup-worktree.sh` (canonical source) — adds a
  `detect_harness()` helper (CLAUDECODE → claude-code, checked first;
  CODEX_SANDBOX/CODEX_SANDBOX_NETWORK_DISABLED → codex) and resolves
  `HARNESS="${RUNTIME_HARNESS:-${CONCERTINO_HARNESS:-unknown}}"`, used in the
  `run.start` emission instead of the raw `CONCERTINO_HARNESS`; header comment
  updated to document the resolution order.
- `scripts/concertino/setup-worktree.sh` — regenerated copy of the above via
  `concertino sync` (do not hand-edit; edit `core/scripts/setup-worktree.sh`).
- `core/scripts/README.md` — `.concertino.env` key list gains
  `CONCERTINO_HARNESS` with a one-line description and the resolution order.
- `scripts/concertino/README.md` — regenerated copy of the above via
  `concertino sync`.
- `docs/config-reference.md` — `harnesses` table row updated and a new
  paragraph explains the static default / runtime-override / `unknown`
  fallback chain.
- `config/concertino.schema.json` — `harnesses` property description notes it
  drives the `CONCERTINO_HARNESS` `.concertino.env` key (documentation only,
  no new schema field).
- `scripts/concertino/.concertino.env` — regenerated via `concertino sync`;
  now contains `CONCERTINO_HARNESS='claude-code'` (this project's own config
  has exactly one configured harness).
- `test/scripts/harness-identity.test.sh` — new test covering (a)
  `renderEnv`'s static `CONCERTINO_HARNESS` computation for both the
  single-harness and multi-harness config cases, and (b)
  `setup-worktree.sh`'s runtime `detect_harness()` resolution, including the
  both-signals-set-simultaneously case (CLAUDECODE wins), the static-default
  fallback, the honest `unknown` fallback, and a runtime signal overriding a
  conflicting static default.
- `package.json` — wires `test/scripts/harness-identity.test.sh` into the
  `test` script alongside the other `test/scripts/*.test.sh` entries.
