## Why

`test/scripts/escalation-loop.test.sh`'s CON-180 reproduction block wins a deliberate race by
waiting a fixed wall-clock `sleep 1`. Probing shows that constant has only ~55ms of headroom on
an idle machine (measured first-read margin 0.943-0.947s against a 1.000s budget) and exceeds
the budget outright under contention, because it races `emit-event.sh`'s own 1s poll interval.
The result is a spurious red CI leg on unrelated changes — it already cost a full diagnostic
cycle on PR #141 (CON-188), which is blocked on this fix, and which presented as a two-leg
failure because matrix fail-fast cancelled the other leg.

## What Changes

- The CON-180 repro block waits on a **condition** — positive evidence that the mutant has
  actually performed its first read of `answer.json` — instead of a wall-clock margin, before
  writing `MALFORMED_B`.
- The generated pre-fix mutant records that first read by writing a marker file immediately
  after it parses the read's result and before it enters its injected race window. The marker is
  written only when the test supplies the marker path, so the mutant's shape is otherwise
  unchanged.
- The wait is bounded and reports a **loud failure through the suite's own `check()`** if the
  marker never appears, rather than silently proceeding to assert against a wrong interleaving.
- Sibling fixed waits in the same file are deliberately left alone, with the reasoning recorded:
  none of them is a which-write-wins race (see design.md).

Not changing: `core/scripts/emit-event.sh` itself, the assertions' meaning, the injected 2s race
window, or the CON-180 fix under test. No shipped behavior changes.

## Capabilities

### New Capabilities

(none — this change modifies one test file's wait logic and ships no runtime
behavior change, so there is no requirement-level behavior for a spec to
describe. The change's `.openspec.yaml` sets `skip_specs: true` and the archive
step uses `--skip-specs`, following the established precedent in this repo; see
design.md Decision 5.)

### Modified Capabilities

(none — `pr-ci` requires only that the suite runs on PRs and pushes, which is
unaffected. No existing capability describes this test's internal wait
discipline, and none needs to.)

## Impact

- `test/scripts/escalation-loop.test.sh` only. No `core/`, `lib/`, `adapters/`, or `bin/` change,
  so no rendered-adapter or `concertino sync` implications.
- Runtime: the block gets slightly faster on an idle machine (it proceeds as soon as the read is
  observed, ~0.95s today) and stops failing on a slow one.
