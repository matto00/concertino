## ADDED Requirements

### Requirement: Gate-chain diffs are mechanically classified
The delivery workflow SHALL provide a script (`scripts/concertino/check-gate-chain-change.sh`) that, given a worktree and its base branch, determines whether the branch's diff touches the target repo's commit-gate chain: any path under `.husky/**`, or a script referenced (directly or via a `package.json` `scripts` entry) from `.husky/pre-commit`'s command list.

#### Scenario: Diff touches .husky directly
- **WHEN** the branch's diff includes a change to a file under `.husky/`
- **THEN** the script reports the change as gate-chain-touching

#### Scenario: Diff touches a script the hook invokes, not .husky itself
- **WHEN** `.husky/pre-commit` runs `npm run check:foo` and the branch's diff modifies the file backing the `check:foo` script in `package.json`
- **THEN** the script reports the change as gate-chain-touching

#### Scenario: Ordinary diff, no gate-chain files touched
- **WHEN** the branch's diff touches neither `.husky/**` nor any script referenced from `.husky/pre-commit`
- **THEN** the script reports the change as not gate-chain-touching, with no further requirements imposed

### Requirement: Delivery blocks on missing gate-chain evidence
`assert-phase.sh delivery` SHALL fail (exit non-zero, `FAIL ...`) when `check-gate-chain-change.sh` reports the branch's diff as gate-chain-touching, unless all of the following hold, checked against `.concertino/runs/<TICKET_ID>/evidence/` (the durable directory `persist-evidence.sh` writes into, preserving each source's path relative to its own worktree top-level — see that script's destination-naming contract):
- a persisted `design.md` (at `.concertino/runs/<TICKET_ID>/evidence/openspec/changes/<CHANGE_NAME>/design.md`, i.e. `persist-evidence.sh`'s ordinary worktree-relative destination for that file) containing a `## Gate-Chain Implications Checklist` heading with all required sub-items (what it executes; what environment it inherits and from where; whether it writes outside its own sandbox; linked-worktree vs. main-checkout behavior; first-run behavior) answered with non-empty, non-placeholder content;
- for **every** gate-chain-touching script path `check-gate-chain-change.sh` identified in the diff (not merely one unrelated passing transcript) — a persisted isolation-test transcript at the fixed, predictable destination `test-gate-in-isolation.sh` always writes to for that exact script path (see the Isolation-test helper requirement's destination-naming rule below), recording a pass verdict for that script.

A run that omits either piece of evidence, or that has isolation-test evidence only for some (not all) of the gate-chain-touching scripts actually in the diff, SHALL fail this gate regardless of whether an agent believed it had satisfied the requirement — the check is against the evidence artifacts on disk, keyed to the specific script paths the diff actually touched, not against agent self-report or an unrelated script's passing evidence.

#### Scenario: Gate-chain diff with no evidence
- **WHEN** the branch's diff is gate-chain-touching and no evidence directory/files exist for the ticket
- **THEN** `assert-phase.sh delivery` fails with a message identifying the missing evidence

#### Scenario: Gate-chain diff with checklist but no isolation-test evidence
- **WHEN** the branch's diff is gate-chain-touching, the persisted `design.md` contains a fully-answered checklist, but no isolation-test transcript exists for any gate-chain-touching script in the diff
- **THEN** `assert-phase.sh delivery` fails with a message identifying the missing isolation-test evidence

#### Scenario: Isolation-test evidence exists but not for the script actually changed
- **WHEN** the branch's diff adds or modifies gate-chain script `scripts/foo.mjs`, and a persisted isolation-test transcript exists only for a different, previously-tested script `scripts/bar.mjs`
- **THEN** `assert-phase.sh delivery` fails, identifying `scripts/foo.mjs` specifically as missing its own isolation-test evidence — a passing transcript for an unrelated script SHALL NOT satisfy this gate

#### Scenario: Gate-chain diff with both evidence pieces present and complete for every touched script
- **WHEN** the branch's diff is gate-chain-touching and both the answered checklist and a passing isolation-test transcript for every gate-chain-touching script in the diff exist under `.concertino/runs/<TICKET_ID>/evidence/`
- **THEN** `assert-phase.sh delivery` proceeds to its other existing checks unaffected

#### Scenario: Non-gate-chain diff
- **WHEN** the branch's diff is not gate-chain-touching
- **THEN** `assert-phase.sh delivery` runs unaffected by this requirement (no evidence required)

### Requirement: Isolation-test helper for a new or modified gate
The delivery workflow SHALL provide `scripts/concertino/test-gate-in-isolation.sh`, which exercises the actual target gate script exactly once against a disposable fixture repo (created under `mktemp -d`, never a real repo) shaped to reproduce a linked-worktree hook invocation (`GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` exported as Husky exports them for a linked worktree), and persists a transcript recording the run's command, the fixture's observed before/after state, and a pass/fail corruption verdict. The helper SHALL NOT require the target script to behave differently across two runs to produce passing evidence — a target script that is already safe under the hook-shaped environment SHALL be able to produce passing evidence from its single run.

**Destination naming (binds evidence to the specific script tested):** given `<path-to-gate-script>` relative to the worktree top-level, the helper writes its transcript to `$WORKTREE_PATH/.concertino/gate-chain-isolation-evidence/<path-to-gate-script-with-/-replaced-by-__>.md` before persisting it, so `persist-evidence.sh`'s worktree-relative destination-naming contract yields a durable copy at `.concertino/runs/<TICKET_ID>/evidence/.concertino/gate-chain-isolation-evidence/<flattened-script-path>.md` — a fixed, predictable, per-script path the Delivery-gate requirement above can check for deterministically, keyed to the exact script path that changed, rather than accepting any transcript that happens to exist.

#### Scenario: Target script is safe under the hook-shaped environment
- **WHEN** the helper runs the target gate script against the fixture under the hook-shaped environment and the fixture is unchanged in kind afterward (still non-bare, `.git` file/manifest intact)
- **THEN** the transcript records a pass verdict, and this single run's transcript is sufficient evidence — no second run is required

#### Scenario: Target script is unsafe under the hook-shaped environment
- **WHEN** the helper runs the target gate script against the fixture under the hook-shaped environment and the fixture is corrupted afterward (e.g. `git rev-parse --is-bare-repository` flips to `true`, or the fixture's `.git` is destroyed)
- **THEN** the helper exits non-zero, the transcript records a fail verdict with the observed corruption, and this is the correct, intended outcome for a script not yet safe to wire in

#### Scenario: The helper's own detection methodology is proven against known references, not the target script itself
- **WHEN** the helper's own selftest runs a bundled known-bad reference script (one that calls bare `git init` while `GIT_DIR` is exported) and a bundled known-good reference script through the same fixture-and-detection logic
- **THEN** the selftest asserts the known-bad script is detected as corrupting the fixture and the known-good script is detected as leaving it intact, proving the detection logic itself is sound independent of whatever real target script a delivery run later exercises

#### Scenario: Helper leaves the real, surrounding repo's git state provably unchanged
- **WHEN** the helper executes its run
- **THEN** it records a small, fixed set of concrete invariants of the real repo it is running inside (`git rev-parse --is-bare-repository`, `git rev-parse HEAD`, and `git worktree list`) immediately before and immediately after the run, and fails loudly — surfacing the diff between the two snapshots — if any of them changed. This targets the specific, real failure mode (the surrounding repo itself being bricked) rather than the unbounded, unimplementable "no file anywhere outside the fixture was ever touched" claim — the helper cannot observe every filesystem write without OS-level tracing (`strace`/`inotify`), which this design deliberately does not depend on.
