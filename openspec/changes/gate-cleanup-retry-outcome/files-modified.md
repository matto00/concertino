# Files Modified — gate-cleanup-retry-outcome (CON-99)

- `core/scripts/cleanup.sh` — when a post-`retry` fast-forward attempt still doesn't resolve
  to `updated`/`current` (i.e. lands on `dirty`, `diverged`, `failed`, `fetch-failed`, or
  `no-local-base`), emit a `gate.warning` telemetry event (`gate=phase:cleanup`,
  `resolved=false`, `reason=` distinguishing "confirmed still behind" from "unknown state")
  via `emit-event.sh`, in addition to the pre-existing stderr-only note. No change to
  `cleanup.sh --phase4`'s exit code, the bounded retry/skip loop shape, or the unconditional
  `run.end status=delivered`.
- `scripts/concertino/cleanup.sh` — re-synced copy of `core/scripts/cleanup.sh` (identical,
  kept byte-for-byte in sync; `concertino sync` unavailable in this worktree — no rendered
  `concertino.config.json` present — so the copy was made directly and diffed to confirm
  identity).
- `test/scripts/cleanup.test.sh` — added `gate.warning` assertions to the existing
  still-dirty-retry-exhaustion and fetch-failed-retry-exhaustion scenarios (`gate=phase:cleanup`,
  `resolved=false`, `reason=` content, ticket tagging, and that `run.end status=delivered`
  still fires alongside the warning); added `hasnt "gate.warning"` assertions to the
  already-resolves-cleanly retry scenario and to both skip-only (no retry) scenarios, to lock
  in that the new telemetry fires only on the unresolved-after-retry paths.

No other files were changed. `openspec/changes/gate-cleanup-retry-outcome/specs/main-fast-forward/spec.md`
was confirmed (task 3.1) to already match the implemented behavior exactly — no edit needed.
