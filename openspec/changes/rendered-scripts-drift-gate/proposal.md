## Why

Concertino self-hosts. Every ticket it delivers is guarded by the rendered scripts under `scripts/concertino/`, which `concertino sync` generates from `core/scripts/`. When those two trees disagree, a run is guarded by a snapshot of what the guards used to be — silently, because a stale copy does not error, it just enforces an older contract.

They currently disagree. At the base commit `d792b42`, four tracked files differ: `squash-branch.sh` (by 24 insertions / 124 deletions, missing the CON-163 validate-before-reset fix, the CON-162 staged-blob validation, the CON-164 `DRY_RUN=1` mode, and the grouped-bullet declaration parser), `check-merge-readiness.sh`, `cleanup.sh`, and `README.md`. Every run tonight — including the runs that shipped those very squash-branch fixes — was guarded by the stale copy.

Nothing catches this. `concertino.config.json` sets `cleanup.skipSync: true`, so nothing auto-renders. `concertino doctor` does already byte-compare the trees (`checkArtifacts()`), but only as a WARN in a command nothing runs, absent from `npm test` and from every hook. The drift has only ever been found by a human diffing by hand — and that has now happened twice (`c203d27` was the first hand catch-up), which is precisely why a reminder is not the fix.

## What Changes

- A new drift gate compares each file under `core/scripts/**` against its rendered counterpart under `scripts/concertino/**` and fails on disagreement, wired into the existing `npm test` suite so it runs on every routine verification rather than on demand.
- The gate reports two distinct conditions, because they are different problems: a **content mismatch** (the file was rendered and has since gone stale) and a **missing counterpart** (the file never arrived). Its failure output names the offending paths and states the remedy — run `concertino sync`, commit the result as its own reviewable diff — and never suggests hand-editing the render target.
- Files with no `core/scripts/` source (`.concertino.env`, `speeds.json`) are out of scope by construction, not by exclusion list: the gate enumerates from `core/scripts/**` and never from the rendered directory.
- A narrow exemption list, in which every entry carries a written reason, suppresses the missing-counterpart failure only. It is seeded with `pricing-table.json` and `report-cost.sh` (reason: owner has not ruled — tracked by CON-173, filed by this change's design gate). It cannot suppress a content mismatch.
- The gate also asserts that every rendered `.sh` is executable — the property `concertino sync` actually establishes — rather than comparing modes, which would misreport a correctly-rendered file.
- The existing drift is cleared by re-rendering the four stale files from core, so the gate is green on arrival rather than red.

## Capabilities

### New Capabilities
- `rendered-script-drift-gate`: the self-hosted rendered scripts under `scripts/concertino/` must not diverge from `core/scripts/`, enforced mechanically by the repo's own test suite.

### Modified Capabilities

## Impact

- New test script under `test/scripts/`, registered in `package.json`'s `test` script.
- Re-rendered content for `scripts/concertino/{squash-branch.sh,check-merge-readiness.sh,cleanup.sh,README.md}`.
- No change to `concertino sync` itself, to `lib/cli/doctor.js`, or to any core script's behaviour.
- `scripts/concertino/pricing-table.json` and `scripts/concertino/report-cost.sh` in the main checkout are untouched.
