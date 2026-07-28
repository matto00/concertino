## 1. Implementation

- [x] 1.1 In `core/scripts/start-servers.sh`'s `start_one()`, move the
      `local T="${WORKTREE_PATH##*/}"` assignment (currently after the
      `if/else` block) to the top of the function, before the
      `if curl -sf "$url" ...` branch, so `$T` is in scope at both the
      existing pass-path emit site and the new failure-path one.
- [x] 1.2 In the health-wait failure branch (`if ! timeout ...; then`),
      immediately before the existing `exit 1`, emit a `gate.result` event
      with `status=fail`, `duration_ms` (measured from the same `start_ts`
      captured at the top of `start_one()`), and `first_error` (e.g.
      `"${label} did not become healthy at ${url} within ${timeout}s"`).
      Guard the emit with `|| true`, and gate it with the same inline regex
      the existing pass-path emission uses (`[[ "$T" =~
      ^[A-Za-z#][A-Za-z0-9._-]*[0-9]$ ]] && ...`) — do NOT call
      `looks_like_ticket`; that function exists only in `assert-phase.sh`,
      not in `start-servers.sh`.
- [x] 1.3 Verify the existing stderr `FAIL <label> did not become healthy
      ...` line and `exit 1` are byte-for-byte unchanged.

## 2. Sync rendered copy

- [x] 2.1 Run `concertino sync` (or the project's equivalent) so
      `scripts/concertino/start-servers.sh` is re-rendered from
      `core/scripts/start-servers.sh` and stays byte-identical.

## 3. Spec

- [x] 3.1 Confirm `openspec/changes/emit-gate-result-on-fail/specs/gate-telemetry/spec.md`
      accurately reflects the implemented behavior (it should already, as
      design followed spec) — adjust if implementation diverged.

## 4. Tests

- [x] 4.1 Add a case to `test/scripts/start-servers.test.sh` covering a
      server that never becomes healthy: assert exit code `1`, unchanged
      stderr `FAIL` text, a `gate.result` event with `status=fail`, a
      numeric non-negative `duration_ms`, and a non-empty `first_error`
      mentioning the health URL.
- [x] 4.2 Run `bash test/scripts/start-servers.test.sh` and confirm all
      cases (existing + new) pass.

## 5. Verification

- [x] 5.1 `openspec validate emit-gate-result-on-fail --strict` passes.
- [x] 5.2 Manually diff `core/scripts/start-servers.sh` against
      `scripts/concertino/start-servers.sh` to confirm they are identical
      post-sync.
