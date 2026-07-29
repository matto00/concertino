## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff read in full** (`git diff main...HEAD`, 13 files, +673/-24). Read
  `core/scripts/assert-phase.sh`'s full delivery-gate diff directly (not the evaluator's summary):
  the new stale-base block is nested entirely inside the `delivery)` case, after the existing
  pushed/clean `fail()` checks and before the case's closing `;;` — it cannot influence `FAILED`,
  which the block never touches.
- **Rendered-copy parity (task 1.5)**: `diff core/scripts/assert-phase.sh
  scripts/concertino/assert-phase.sh` → identical, confirmed myself (not just trusted the
  evaluator's claim).
- **ROADMAP.md AC (ticket AC 4)**: `git diff main...HEAD -- ROADMAP.md` shows the "Stale-base
  warning at the delivery gate" bullet removed, nothing else touched.
- **`set -euo pipefail` safety (task 1.3)**: every git call in the new block is chained with
  `... || VAR=""` or guarded by a preceding `if`, so a failure anywhere degrades to skip rather
  than aborting the script — read the full block, this holds line by line.
- **Tests re-run myself, not trusted from the evaluation report**:
  `bash test/scripts/assert-phase.test.sh` → `49 passed, 0 failed`, including all 28 new CON-31
  assertions (current/3-behind/12-behind-truncated/fetch-fails), each against a real bare "remote"
  + real clone/push, not mocked git.
  `npm test` (full chained suite, 15 files) → exit 0, no `not ok` lines (the only "FAIL"/"failed"
  substring hits are expected literal test-name/assertion text, e.g. `check "FAIL printed to
  stderr"`).
- **Telemetry non-interference (AC 2)**: `lib/ui/reducer.js` — `TIER2_KINDS = new Set(['run.start',
  'gate.result'])` (line 13) and the `applyEvent` switch has `default: break` (lines 142-143), so
  the new `gate.warning` kind is a genuine no-op for dashboard/escalation state today, confirmed by
  reading the reducer directly, not asserted secondhand.
- **`emit-event.sh` has no kind allowlist** (`grep -n "unknown kind\|KNOWN_KINDS" core/scripts/emit-event.sh`
  → no match), so `gate.warning` is accepted as an ordinary event kind, consistent with design.md
  Decision 3.
- **Defaults consistency**: `core/scripts/setup-worktree.sh` uses the same
  `CONCERTINO_BASE_REMOTE`/`CONCERTINO_BASE_BRANCH` env vars with the same `origin`/`main`
  defaults (lines 74-75) as the new check, so "the base at setup time" and "the base this check
  compares against" are provably the same config surface.
- **Orchestrator role doc** (`core/roles/orchestrator.md:268-270`) already invokes
  `assert-phase.sh delivery` directly via the Bash tool before PR creation — confirms the design's
  Non-Goal reasoning (stderr output already reaches a surface the orchestrator reads) is real, not
  hand-waved, and no doc/role update was needed or made beyond that existing call site.
- **Scope check**: the only change outside the stale-base block itself is hoisting
  `GATE_TICKET`/`looks_like_ticket` above the `case` dispatch — read the diff, it is a pure
  relocation (identical RHS), required by task 1.4 so the new telemetry call can use them; every
  pre-existing setup/servers/cleanup test in the same file still passes unchanged, confirming no
  behavior change for other phases.

### Acceptance criteria — traced

1. "warn naming the commits it is behind by" → `core/scripts/assert-phase.sh` new block, `WARN base
   <remote>/<branch> has moved — this branch is N commit(s) behind:` plus up to 5 `git log --oneline`
   lines to stderr. Verified live in the 3-behind and 12-behind test scenarios (`ok warning names the
   commit count`, `ok warning names the merged commit subject`, `ok warning appends the +N more
   suffix`).
2. "never blocks delivery and never raises a blocking escalation" → block never sets `FAILED`, never
   changes exit code / `PASS delivery`; emits only `gate.warning` (not an `escalation.*` kind), which
   is a dashboard no-op per the reducer read above. Verified live: all 4 new scenarios still exit 0
   and print `PASS delivery`.
3. "current base -> no output" → verified live: `no WARN line when base current`, `only one event
   (gate.result) when base current`, `no gate.warning kind in log` all pass against a real repo with
   a truly current base.
4. "remove the ROADMAP item" → confirmed via `git diff -- ROADMAP.md`.

### Design-gate carryover

The design-gate skeptic (`skeptic-design-1.md`) issued only non-blocking notes (an implementation-
order ambiguity that doesn't affect any AC, and a wording nit in tasks.md 2.2). Both were resolved
sensibly in the implementation: the check runs unconditionally (harmless per that note, and flagged
again as a non-blocking evaluator suggestion), and the test used the proven clone/push pattern
instead of a literal direct-commit-to-bare-repo.

### UI / design judgment

N/A — this is a bash gate script + shell test change with no UI surface, matching the task's own
framing and this project's "no UI configured" note. No dev servers needed to be started.

### Verdict: CONFIRM

### Non-blocking notes
- `core/scripts/assert-phase.sh:125,131` — the `5` commit-list cap is a literal in two places, as
  the evaluator already flagged. Worth a named constant if this block is touched again, not worth a
  round-trip now.
- The check runs even when the preceding pushed/clean checks already failed, spending an
  unnecessary fetch on a gate call that's already doomed. Harmless (no AC depends on skipping it)
  and already flagged by both the design-gate skeptic and the evaluator; leaving as-is is reasonable.
