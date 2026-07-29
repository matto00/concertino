## 1. `concertino sync` renders `CONCERTINO_HARNESS`

- [x] 1.1 In `bin/concertino`'s `renderEnv(c)`, add a `CONCERTINO_HARNESS` line:
      the single value when `c.harnesses.length === 1`, else empty string.
- [x] 1.2 Add an informational line to `cmdValidate`'s "Integrations" section
      reporting how `CONCERTINO_HARNESS` will resolve (static value vs.
      runtime-detected) for the project's configured `harnesses`. Never a
      validation failure.

## 2. Runtime detection in `setup-worktree.sh`

- [x] 2.1 In `core/scripts/setup-worktree.sh`, add a `detect_harness()` helper
      run after the `.concertino.env` source line: `CLAUDECODE` non-empty →
      `claude-code`; `CODEX_SANDBOX` or `CODEX_SANDBOX_NETWORK_DISABLED`
      non-empty → `codex`; else empty.
- [x] 2.2 Resolve `HARNESS="${RUNTIME_HARNESS:-${CONCERTINO_HARNESS:-unknown}}"`
      and use `HARNESS` (not the raw `CONCERTINO_HARNESS`) in the `run.start`
      emission's `harness=` argument.
- [x] 2.3 Update the script's header comment block to document the new
      resolution order (runtime signal → static default → `unknown`).

## 3. Docs

- [x] 3.1 Update `docs/config-reference.md`'s `harnesses` row (Top level table)
      and/or add a short paragraph explaining that `harnesses` drives a static
      `CONCERTINO_HARNESS` default in `.concertino.env`, overridden at runtime
      by harness-set environment variables for multi-harness projects.
- [x] 3.2 Update `core/scripts/README.md`'s `.concertino.env` key list to
      include `CONCERTINO_HARNESS` with a one-line description and the
      resolution order.
- [x] 3.3 Update `config/concertino.schema.json`'s `harnesses` description to
      note it drives `CONCERTINO_HARNESS` in `.concertino.env` (documentation
      comment only — no new schema field).

## 4. Regenerate this project's own synced copies

- [x] 4.1 Run `node bin/concertino sync` (or the project's normal sync
      invocation) in the worktree so `scripts/concertino/setup-worktree.sh`,
      `scripts/concertino/README.md`, and `scripts/concertino/.concertino.env`
      pick up the `core/scripts/*` and `bin/concertino` changes (this project
      dogfoods its own tool per `docs/harness-capabilities.md`).
- [x] 4.2 Verify the regenerated `.concertino.env` contains
      `CONCERTINO_HARNESS='claude-code'` (this project's config has exactly one
      configured harness today).

## 5. Verification

- [x] 5.1 Add or extend a `test/scripts/*.test.sh` covering: (a) `renderEnv`
      writes the correct static `CONCERTINO_HARNESS` for both the
      single-harness and multi-harness config cases, and (b)
      `setup-worktree.sh`'s runtime detection picks `claude-code` when
      `CLAUDECODE` is set, `codex` when `CODEX_SANDBOX` is set, and falls back
      correctly when neither is set — overriding a conflicting static default
      in each case.
- [x] 5.2 Wire the new test into `package.json`'s `test` script alongside the
      other `test/scripts/*.test.sh` entries.
- [x] 5.3 Run `npm test` and confirm it passes.
- [x] 5.4 Manually inspect a fresh `run.start` event emitted by this worktree's
      own `setup-worktree.sh` invocation (already run during orchestrator
      Setup) and confirm `harness=claude-code`, not `harness=unknown`.
