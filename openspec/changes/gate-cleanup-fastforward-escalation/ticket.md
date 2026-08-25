# CON-138: cleanup.sh's fast-forward escalation still calls --await ungated, so Phase 4 burns the deadline with no TUI

## Description

CON-126 gated the escalation raise path on TUI liveness in `core/roles/orchestrator.md` and `adapters/claude-code/command.md`. `core/scripts/cleanup.sh:345` was not gated and still calls:

```sh
ANSWER="$("${SCRIPT_DIR}/emit-event.sh" escalation --await \
  ticket="$T" \
  question="can't fast-forward local ${BASE_BRANCH} (${REASON})" \
  options=retry,skip || true)"
```

`grep -n "tui-attached\|TUI_ATTACHED" core/scripts/cleanup.sh` returns nothing. With no dashboard attached this blocks for the full `dashboard.escalationTimeoutMinutes` window (default 8 minutes) against a screen nobody is watching, then falls through to `|| true` — exactly the defect CON-126 exists to remove, on a path CON-126 did not cover.

This fires whenever `attempt_fast_forward` reports `dirty`, `diverged`, or `failed` — routine in the helio checkout due to permanently-untracked working files. Observed live during CON-132's delivery on 2026-08-23.

## What to change

* Gate this call on the same `tui-attached.sh` signal CON-126 introduced, so the no-TUI path skips the blocking wait.
* Decide the no-TUI behaviour deliberately: default to `skip` (leave the base exactly as found — already the documented timeout behaviour), since `cleanup.sh` has no chat channel of its own to fall back to the way the orchestrator does.
* Preserve the existing contract when a TUI **is** attached: `retry` re-runs the algorithm exactly once; any other answer — skip, free text, or timeout — leaves the base as found and does not raise a second escalation.
* Keep "a timeout is never an approval" true on both branches.
* Report the outcome rather than silently swallowing it via `|| true` — the no-TUI skip should be visible (e.g. via the existing `gate.warning` telemetry pattern already used lower in this same function for CON-99), not silent.

## Acceptance Criteria

- [ ] `core/scripts/cleanup.sh` consults the TUI signal (`tui-attached.sh`) before invoking `emit-event.sh escalation --await`.
- [ ] With no TUI attached, a dirty/diverged/failed fast-forward completes Phase 4 without a blocking wait, and the outcome is reported rather than silently swallowed by `|| true`.
- [ ] With a TUI attached, the retry/skip loop behaves exactly as it does today.
- [ ] A timeout is still never treated as an approval, and never as a `retry`.
- [ ] Verified by measuring the no-TUI path's wall-clock duration, not by asserting the correct branch was selected — the standard CON-126 used (its no-TUI branch measured 21ms and 0.015s).
- [ ] The fix lands in `core/` (not a rendered copy under `scripts/concertino/`) so it survives `concertino sync`.
- [ ] Full enumeration of every `--await`/`--raise-only`/`--wait-only` call site across `core/scripts/` is documented, verified in both directions (nothing omitted, nothing wrongly included), confirming whether any additional ungated site exists beyond `cleanup.sh:345`.

## Related

* CON-126 — gated the orchestrator and Claude Code command paths; this is the site it left uncovered.
* CON-131 — cleanup.sh failure visibility; the `|| true` here is the same "swallow and continue" shape.
* CON-121 — other_runs_live() false-positives forever when Phase 4 ends on an unresolved escalation timeout; downstream of this fix.
* HEL-764 — the fast-forward safety check false-positives on untracked files, which is what makes this path fire so often in helio.
* HEL-812 — tracking scripts/concertino/ would remove two of three untracked files that trigger it.
