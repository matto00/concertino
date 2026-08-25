## 1. Audit

- [x] 1.1 Enumerate every executable `--await`/`--raise-only`/`--wait-only` call site under
      `core/scripts/*.sh` (both directions: grep forward for the flags, grep reverse for
      `emit-event.sh escalation` invocations), confirming `core/scripts/cleanup.sh` is the only
      ungated one and none is missed or wrongly included. Write the enumeration (site list, both
      grep directions, result) into this run's Delivery report — it does not exist yet as of
      Planning; this task is what produces it, not a task that confirms something already done.

## 2. Implementation

- [x] 2.1 In `core/scripts/cleanup.sh`, wrap the fast-forward escalation's `emit-event.sh
      escalation --await` call in a `tui-attached.sh` check, invoked via `cleanup.sh`'s own
      `$SCRIPT_DIR` (i.e. `if "${SCRIPT_DIR}/tui-attached.sh"; then ... else ... fi`) — NOT the
      cwd-relative `scripts/concertino/tui-attached.sh` form `core/roles/orchestrator.md` uses,
      which is only safe there because the orchestrator always runs from the repo root;
      `cleanup.sh` runs against an arbitrary worktree cwd, so a cwd-relative path would silently
      fail closed (tui-attached.sh not found -> non-zero -> "not attached") and the bug would
      appear fixed while never actually being tested.
- [x] 2.2 On the no-TUI branch, skip straight to the existing `skip`/timeout outcome (leave local
      `main` exactly as found, no retry attempted) and emit one `gate.warning` event
      (`gate=phase:cleanup`, `resolved=false`, `reason=` naming "no TUI attached" plus the
      underlying `FF_STATUS`/`FF_REASON`) so the outcome is dashboard-visible instead of swallowed
      by `|| true`. Do NOT also call `emit-event.sh escalation --raise-only` here — see design.md
      Decision 3 for why this deliberately differs from CON-126's own no-TUI branch (which does
      raise-only).
- [x] 2.3 Confirm the TUI-attached branch's behavior (the `--await` call, the `retry`/`skip`
      handling, the existing "still behind after retry"/"unknown after retry" `gate.warning`
      cases) is byte-for-byte unchanged.

## 3. Spec sync

- [x] 3.1 Confirm `openspec/changes/gate-cleanup-fastforward-escalation/specs/main-fast-forward/spec.md`
      (already drafted in Planning) accurately reflects the implemented behavior; adjust if the
      implementation diverges from the draft.

## 4. Verification

- [x] 4.1 Demonstrate (not just assert) the no-TUI path's wall-clock duration with no TUI attached
      — measure it directly, following CON-126's own precedent (21ms / 0.015s), rather than only
      checking that the correct code branch was taken.
- [x] 4.2 Demonstrate the TUI-attached path still calls `--await` (e.g. by mocking/stubbing
      `tui-attached.sh` to succeed and confirming the call is reached — or documenting precisely
      why this half cannot be demonstrated without an actual dashboard process, if that turns out
      to be the case).
- [x] 4.3 Confirm existing `cleanup.sh`-related tests (if any) still pass, and add/extend test
      coverage for both branches if a test harness for this script exists.
- [x] 4.4 Run standard verification gates (lint/format/tests as applicable) and
      `openspec validate gate-cleanup-fastforward-escalation --strict` (the installed CLI, 1.2.0,
      rejects a `--change` flag — this is the correct invocation).
