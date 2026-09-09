## Why

A bare `npm`/`vite`/`sbt`/`npx playwright` invocation — bypassing the canonical `start-servers.sh` — silently inherits an ambient default (port, cwd) instead of the run's pinned config. This is a defect class that manufactures gate bypasses (CON-165, drawn from helio HEL-469/HEL-451): a wrong-port/wrong-cwd server measures the wrong thing, or writes into the wrong worktree, and nothing complains, because the fallback looks like a legitimate default. `start-servers.sh`'s own "already healthy, reusing" path compounds this — it adopts whatever process is listening on the expected port with no check that it belongs to this run's worktree (the CON-155 shape, still live today).

## What Changes

- `start-servers.sh`'s reuse branch (`already healthy ... reusing`) now verifies the responding process's cwd resolves under `WORKTREE_PATH` before treating it as this run's server; a healthy-but-foreign process is treated as a mismatch (loud `FAIL`), not silently adopted.
- `core/roles/executor.md`, `evaluator.md`, and `skeptic.md` each gain an explicit, literal prohibition: never invoke `npm`/`vite`/`sbt`/`npx playwright` bare where a canonical script (`start-servers.sh`, project gate commands) exists for the same purpose — a prompt-level obligation, deliberately not load-bearing alone (per the ticket's own caution and this batch's CON-140/146/161/171 precedent that prompt-only fixes are insufficient).
- Corresponding rendered copies under `scripts/concertino/` are updated in the same commit (CON-173 drift gate).
- No change to Fix 1 (already fully satisfied — verified during premise validation, see `.concertino/runs/CON-165/evidence/premise-validation.md`) and no change adopting Fix 4 (fail-closed tooling) — evaluated and explicitly deferred as too invasive for this ticket, consistent with the ticket's own "weigh honestly" framing.

## Capabilities

### New Capabilities
- `dev-server-process-identity`: canonical server-start scripts must verify a reused, already-healthy server process actually belongs to the current run's worktree before adopting it, rather than trusting the health check alone.

### Modified Capabilities
(none — no existing capability spec currently governs `start-servers.sh`'s reuse behavior)

## Impact

- `core/scripts/start-servers.sh` (template) and its rendered copy `scripts/concertino/start-servers.sh`.
- `core/roles/executor.md`, `core/roles/evaluator.md`, `core/roles/skeptic.md`.
- New mutation-failable test coverage exercising the reuse path against a bare, colliding-port process started from outside the worktree.
