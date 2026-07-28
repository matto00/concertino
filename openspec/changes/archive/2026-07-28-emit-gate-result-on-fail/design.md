## Context

`core/scripts/start-servers.sh`'s `start_one()` helper already emits a
passing `gate.result` (with `duration_ms`, added by CON-1) right before its
final `echo "READY ..."`. Its failure branch — `wait_for`/`timeout` failing —
prints `FAIL ... (log: ...)` to stderr and calls `exit 1` with no telemetry
emission at all. `assert-phase.sh` already has the analogous failing-path
emission (`status=fail`, `duration_ms`, `first_error`, trimmed at the
source); this change makes `start-servers.sh` symmetric with it.

## Goals / Non-Goals

**Goals:**
- Emit exactly one `gate.result status=fail` event, with `duration_ms` and
  `first_error`, immediately before the existing `exit 1` in `start_one()`.
- Keep the emission guarded (`|| true`) and ticket-gated so telemetry can
  never fail the script and never fires for non-ticket worktree names (e.g.
  test fixtures). `start-servers.sh` has no `looks_like_ticket` function
  today — that helper is local to `assert-phase.sh` — so the guard reuses the
  exact inline regex the pass-path emission already uses at line 66
  (`[[ "$T" =~ ^[A-Za-z#][A-Za-z0-9._-]*[0-9]$ ]] && ...`), rather than
  naming a function that doesn't exist in this file. No new helper is
  introduced; both emit call sites (pass and fail) use the same inline test.
- The `local T="${WORKTREE_PATH##*/}"` assignment (currently line 65, after
  the `if/else` block) must move to the top of `start_one()` — before the
  `if ! curl -sf ...` branch — so `$T` is in scope for the new failure-path
  emission, which sits *inside* that `if` block, not just for the pass-path
  emission that follows it today.
- Preserve `FAIL <reason>` stderr text and the `exit 1` byte-for-byte.
- Re-render `scripts/concertino/start-servers.sh` via `concertino sync`.
- Broaden the `gate-telemetry` spec's `first_error` requirement to cover
  `start-servers.sh`.

**Non-Goals:**
- Changing whether a failed server-start is treated as an environmental
  BLOCKER by the orchestrator — that behavior (unchanged `exit 1`) stays
  exactly as is. This ticket only adds a telemetry row alongside it; the two
  answer different questions (BLOCKER = "tell a human now", gate.result =
  "put a row in the panel"), so they coexist rather than one replacing the
  other.
- Touching `assert-phase.sh`, `emit-event.sh`, or the dashboard reducer —
  the reducer already reads `duration_ms`/`first_error` generically off any
  `gate.result` event, so no dashboard code changes.

## Decisions

- **`first_error` content**: `"${label} did not become healthy at ${url}
  within ${timeout}s"` — the same information already in the stderr `FAIL`
  line (minus the log path, which is host-local and not useful in
  telemetry), so no new string needs to be composed or trimmed against a
  separate length bound. It's well under the 200-char bound
  `assert-phase.sh` uses for the same field, so no truncation logic is
  needed here (unlike `assert-phase.sh`, which accumulates arbitrary
  multi-check failure text and must guard against an oversized message).
- **`duration_ms` on the failure path**: reuse the same `start_ts` captured
  at the top of `start_one()`, measured the same way as the passing path
  (`($(date +%s) - start_ts) * 1000`) — the elapsed wall-clock time up to
  the `timeout` command returning, not the configured `$timeout` value
  itself (they'll usually be close but the measured value is the honest
  one).
- **Emit before `exit 1`, not via a trap**: `start_one()` runs under the
  script's global `set -euo pipefail`; a trap-based approach would need to
  distinguish this exit from any other early exit in the function and adds
  indirection for one call site. A straight-line emit immediately before the
  existing `exit 1` mirrors `assert-phase.sh`'s structure and is the
  smallest diff.
- **Where in the function**: emit sits inside the `if ! timeout ...; then`
  block, after the existing `echo "FAIL ..." >&2` and before `exit 1` — so a
  telemetry hiccup (`|| true`) still can't stop the exit, matching the
  existing guarantee. Because this call site is inside the `if/else` that
  currently precedes the `local T=...` assignment, that assignment moves to
  the top of `start_one()` (see Goals) so `$T` is available at both the new
  failure-path call site and the existing pass-path one.

## Risks / Trade-offs

- [Risk] A future refactor moves the `exit 1` without moving the emit call
  with it, silently reopening the gap. → Mitigation: `test/scripts/start-servers.test.sh` asserts the failure-path event exists with the right fields, so a regression fails CI, not just review.
- [Risk] Duplicate telemetry rows if `start_one()` is ever called in a retry
  loop. → Mitigation: out of scope — `start_one()` is called exactly once
  per label today; not changing that here.

