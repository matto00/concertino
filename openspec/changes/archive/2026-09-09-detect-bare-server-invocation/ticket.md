# CON-165: A bare npm/vite/sbt invocation silently inherits ambient defaults instead of the run's pinned config

## Description

When an agent invokes a build/dev tool bare (`npm run dev` rather than the canonical script), it silently inherits an ambient default instead of the run's pinned configuration. Nothing complains. The run continues, measuring the wrong thing.

Live instance, helio HEL-469: `run.start` declared `dev_port=5901`; the dev server was actually on 5176 (vite's own `5173` default, auto-incremented into another worktree's port range) — meaning the server was started bare, with no script env. The failure is silent because the fallback port is a legitimate default.

A second failure two steps downstream in the same run: a `start-servers.sh` call omitting the worktree path created a stray `5901/backend/.env` directory (from `$PWD`), which tripped the credential-leak hook and forced a `git commit -n` gate bypass.

Related, same shape: HEL-451 — 119 lines written into the shared main checkout instead of the run's worktree (bare invocation inheriting `$PWD`).

## Acceptance Criteria

- Canonical scripts require the worktree path positionally; none may default it to `$PWD`.
- Role docs (executor/evaluator/skeptic) explicitly prohibit invoking `npm`/`vite`/`sbt`/`npx playwright` bare where a canonical script exists.
- `start-servers.sh`'s reuse path ("already healthy, reusing") verifies the process actually serving the health URL belongs to this worktree (cwd check), rather than silently adopting whatever is listening on the port — converting the silent-adoption class to a loud one.
- Mutation-failable coverage: starting a server bare, on a colliding port, from outside the worktree must cause the run to refuse or report the mismatch (not silently reuse it) — a test that only exercises the scripted path must not be able to pass this coverage.

## Premise Validation Findings (see persisted evidence)

- Fix 1 (worktree path required positionally, never `$PWD`) is **already fully satisfied** across every canonical script in `core/scripts/` — no code change needed there.
- Fix 3 as literally stated ("assert the port `start-servers.sh` bound matches `DEV_PORT`") is already true by construction when the script is actually invoked with correct args — the real, still-open mechanical gap is the reuse path's lack of process-identity verification (the CON-155 shape, still live).
- Fix 2 (role-doc prohibition) is not yet present anywhere.
- Fix 4 (fail-closed tooling) is explicitly flagged in the ticket as the most invasive option to weigh, not adopt by default.
