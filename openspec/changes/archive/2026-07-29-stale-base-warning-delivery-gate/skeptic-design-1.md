## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **ticket.md ACs read directly** (`openspec/changes/stale-base-warning-delivery-gate/ticket.md`):
  4 ACs — warn naming commits, never block/escalate, silent when current, remove ROADMAP item.
  All four are traceable to specific decisions/tasks (see below).

- **`core/scripts/assert-phase.sh` read in full** (ground truth, not the proposal's summary).
  Confirmed: `delivery)` case currently only checks branch-pushed and clean-worktree via
  `fail()`; stdout contract is exactly `PASS <phase>` or nothing, matching design.md Decision 2's
  claim verbatim (`echo "PASS $PHASE"` at line 134, `fail()` writes `FAIL $msg` to stderr at line
  30). `set -euo pipefail` at line 2 confirms tasks.md 1.3's "must not trip set -e" constraint is
  real, not invented.

- **`core/scripts/setup-worktree.sh` read in full.** Confirmed `CONCERTINO_BASE_REMOTE`/
  `CONCERTINO_BASE_BRANCH` default to `origin`/`main` (lines 74-75) exactly as design.md and
  tasks.md 1.1 claim, and confirmed the "never rebases <base> into the feature branch after
  cutting it" convention design.md Decision 1 relies on — nothing in setup-worktree.sh's flow
  touches the branch again after `git worktree add`.

- **`core/scripts/cleanup.sh` read in full.** Confirmed the "fetch, compare, best-effort" shape
  (`attempt_fast_forward()`, lines 92-153) design.md cites as precedent is real and uses the same
  `BASE_REMOTE`/`BASE_BRANCH` default-resolution pattern the new check reuses.

- **`bin/concertino`'s `checkBaseBranch` (doctor) read** (lines 915-946). Confirmed it's the
  other cited precedent: fetch-best-effort, silent on fetch failure, warn-only, never blocking —
  matches design.md's characterization exactly.

- **`openspec/specs/main-fast-forward/spec.md` read in full** — confirmed as the closest existing
  spec precedent for a fetch-and-compare check, and confirmed proposal.md/design.md's claims about
  it (`CONCERTINO_BASE_REMOTE`/`BASE_BRANCH` defaults, best-effort skip-on-fetch-failure posture)
  match the actual spec text.

- **`core/scripts/emit-event.sh` read in full.** Confirmed: normal (non-`--await`) calls are
  fire-and-forget and always exit 0 (`write_line ... || true`, line 188) — so design.md Decision 2/3's
  claim that telemetry can never turn into a blocking escalation is structurally true, not just
  asserted. Confirmed `MAX_LINE=4000` (line 27) grounds design.md Decision 4's 5-commit cap
  rationale.

- **`lib/ui/reducer.js` read.** Confirmed `TIER2_KINDS = new Set(['run.start', 'gate.result'])`
  (line 13) and the `switch` in `applyEvent` has a `default: break` (line 142-143) — so an
  unrecognized `gate.warning` kind is genuinely ignored today, exactly as design.md Decision 3
  claims, not a hand-wave.

- **`test/scripts/assert-phase.test.sh` read in full.** Confirmed the existing test file's
  structure/helpers (`new_repo`, `check`) and the literal `check "stdout is PASS setup" "$OUT"
  "PASS setup"` assertion design.md Decision 2 cites as the reason not to touch the stdout
  contract — real, not invented.

- **`test/scripts/cleanup.test.sh` read (partial).** Confirmed a working precedent
  (`new_pair`/`advance_remote`: bare remote + clone, then a second clone pushes to simulate a
  merge landing) for exactly the kind of test-repo-with-a-real-remote scaffolding tasks.md 2.1-2.4
  will need — this is proven feasible in this codebase, not speculative.

- **`ROADMAP.md` read.** Confirmed the exact "Stale-base warning at the delivery gate" bullet
  tasks.md 3.1 targets for removal exists verbatim in the Near-term section.

- **`diff core/scripts/assert-phase.sh scripts/concertino/assert-phase.sh`** — confirmed identical
  today, verifying proposal.md/tasks.md 1.5's premise that the rendered copy currently mirrors the
  core script and needs a matching update.

### Assessment against the review checklist

- **Placeholders/hand-waving:** none found. No `TODO`/`TBD`; every decision in design.md names a
  concrete mechanism and cites a real file/line as precedent (verified above).
- **Internal contradictions:** none. proposal.md → design.md → tasks.md → spec.md agree on: check
  location (inside `delivery)`, after existing checks), non-blocking posture, 5-commit cap with
  `(+N more)`, `gate.warning` telemetry shape, and the ROADMAP removal.
- **Ambiguity:** tasks.md 1.1 doesn't explicitly say whether this new check should run when the
  preceding pushed/clean checks have already set `FAILED=1`. This doesn't affect any AC (the gate's
  exit code and `PASS`/`FAIL` output are unaffected either way, per Decision 2), so it's a minor
  implementation-order question, not a design defect.
- **Scope drift:** none. Non-Goals explicitly and correctly exclude PR-body/dashboard rendering,
  acting on the divergence, and persisting a new base-SHA field — all reasonable exclusions that
  keep the change inside the ticket's stated AC surface (warn at the gate, via stderr + telemetry).
- **AC coverage:** all four ACs map to a specific task/requirement (see spec.md's four Requirements,
  each with scenarios mirroring the AC language almost verbatim).
- **Missing contract updates:** none needed — this is additive-only (Decision 2 is explicit that the
  `PASS <phase>` stdout contract must not change), and the design correctly identifies this as the
  reason not to reuse `gate.result` (Decision 3).

### Verdict: CONFIRM

### Non-blocking notes
1. tasks.md 1.1 could explicitly state whether the stale-base check runs even when the
   pushed/clean checks already failed (it doesn't matter for any AC, but would remove a small
   judgment call from the executor).
2. tasks.md 2.2's phrase "commit directly to the bare/local remote" is imprecise — a bare repo
   can't receive a working-tree commit directly; the executor should follow `cleanup.test.sh`'s
   proven `advance_remote()` pattern (clone, commit, push) rather than read this literally.
