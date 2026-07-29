## Why

CON-25 fast-forwards local `<base>` after a run's PR merges, so the *next* run's `setup-worktree.sh`
branches from a current tip. That closes the problem from one end. The other end is still open: a
long-running orchestrator branches from a base that was current at setup time, and while it works
through planning, several execution/evaluation cycles, and the skeptic gates, sibling runs merge
and the base moves underneath it. Nothing tells it. The first sign of trouble is a PR conflict.
This change adds the belt-and-suspenders check `ROADMAP.md` still lists: a non-blocking warning at
the delivery gate that names how far behind the fetched remote base the run's branch is, so the
human sees it before it becomes a conflict, without ever stalling a finished run behind that
answer.

## What Changes

- `assert-phase.sh delivery` (the delivery gate the orchestrator already runs in Phase 3 before
  opening a PR) additionally fetches the configured base remote/branch and compares it against the
  merge-base of `HEAD` and that fetched tip. When the fetched tip carries commits the branch's base
  doesn't, it prints a `WARN` line to stderr (the same channel `cleanup.sh`'s "note:" messages and
  `assert-phase.sh`'s own `fail()` already use for human-facing, non-stdout-contract text) naming
  the commit count and (up to 5) the commits themselves, and emits a `gate.warning` telemetry event
  with the same facts. This check is strictly additive to the existing delivery-gate checks: it
  never sets the gate to `FAIL`, never changes the gate's exit code or its `PASS delivery` stdout
  line, and is skipped silently (no output at all) whenever the base is already current, the fetch
  fails (e.g. offline), or the base ref can't be resolved — mirroring the same best-effort posture
  `cleanup.sh --phase4`'s fast-forward and `doctor`'s existing local-base-behind-remote check
  already use for the same class of check. Because the orchestrator already runs this exact command
  and its output (the Bash tool surfaces stdout and stderr together) is what it reads to confirm the
  gate passed, the warning reaches the orchestrator — and from there the human, via the PR
  presentation it already does in Phase 3 — without requiring any change to the orchestrator role
  itself; a dedicated PR-body/dashboard rendering of it is left as a natural follow-up, not required
  here.
- `ROADMAP.md`'s "Stale-base warning at the delivery gate" near-term item is removed now that it's
  shipped.

## Capabilities

### New Capabilities
- `delivery-stale-base-warning`: a best-effort, non-blocking check at the delivery gate that warns
  when the run's branch has fallen behind the fetched remote base since setup, naming the commits
  it's behind by, and surfaces that warning through the gate's own stderr output and telemetry.

### Modified Capabilities
(none — no existing capability's requirements change; `main-fast-forward` covers Phase 4's
post-merge fast-forward and is unaffected by this pre-merge, warn-only check)

## Impact

- `core/scripts/assert-phase.sh` (and its rendered/self-hosted copy `scripts/concertino/assert-phase.sh`):
  new best-effort check inside the existing `delivery` case.
- `ROADMAP.md`: near-term item removed.
- `test/scripts/assert-phase.test.sh`: new coverage for the delivery-gate stale-base check (current
  base → silent; behind base → warning + telemetry, gate still passes; fetch failure → silent skip).
- No change to any existing script's exit codes, flags, or call signature — purely additive.
