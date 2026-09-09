## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed against base `d792b42`; single commit `36d98a6`.

### Phase 1: Spec Review — PASS

- AC1 (structural check in routine verification): met. `test/scripts/rendered-scripts-drift.test.sh` is appended to the explicit chain in `package.json:23`; full `npm test` re-run by me exits 0 with the new suite reporting 18/0.
- AC2 (failable by mutation, demonstrated): met, and independently reproduced by me against the real tree — see Phase 2.
- AC3 (remedy stated, no hand-edit invitation): met; failure line names `concertino sync` + "commit the resulting render as its own reviewable diff" and explicitly says "Do not hand-edit files under scripts/concertino/". Asserted by tests 2.20/2.21.
- AC4 (not a naive whole-tree byte compare): met by construction — enumeration is `find` over `core/scripts` only, so `.concertino.env` and `speeds.json` are never considered.
- AC5 (drift cleared, green on arrival): met. `cmp` confirms all four files byte-identical to core; `diff -rq core/scripts scripts/concertino` reports only the two intentionally-absent files.
- AC6 (`pricing-table.json` / `report-cost.sh` untouched): met. Not tracked on the branch (`git ls-files` empty); still present, still `??` untracked, and still byte-identical to core in the main checkout at `/home/matt/Development/concertino/` after my full suite runs.
- Tasks all marked done and match what was implemented. No scope creep: the diff is the new test, the one-line `package.json` chain link, and four re-rendered files.
- Recorded autonomous decision (exemption list) is consistent with the shipped code and confined to the missing-counterpart case.

### Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH` (no `CLEAN_WORKTREE` set):
- `npm test` → exit 0. Worktree `git status --porcelain` empty afterward (the suite leaves no residue, including the test that runs `sync` into scratch).

Independent mutation evidence (I re-ran, not trusting the transcripts):
- Appended a byte to `scripts/concertino/emit-event.sh` → gate exit 1, `content differs: emit-event.sh`, test 1.1 flips to FAIL. Restored → green.
- Cleared the exec bit on `scripts/concertino/lib/git-child-env.sh` (content identical) → exit 1 under `not executable:`, and NOT under `content differs`. Restored → green.
- Added `core/scripts/zz-throwaway.sh` with no render → exit 1 under `never rendered:`. Removed → green.
- Sourced with `RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY=1` and ran `run_drift_check` with a synthetic `emit-event.sh` exemption over a mutated render → still exit 1 as a content mismatch. Restored → exit 0.

Mode semantics verified as specified: `core/scripts/lib/git-child-env.sh` is `100644` and its render `100755` with identical blob `a1eff65` — the clean tree is green, so the gate asserts executability rather than mode equality, exactly as designed. No rendered `.sh` lacks `u+x`.

Re-render content verified, not assumed: `scripts/concertino/squash-branch.sh` is byte-identical to core and carries CON-164 `DRY_RUN=1` (`:41,94-96,302`), CON-162 staged-blob validation and index/worktree divergence refusal (`:136,152,174,187`), CON-163 validate-before-reset ordering (guard at `:137-187`, `git reset --soft "$MERGE_BASE"` only at `:300-307`), and the grouped-bullet declaration parser (`:67-72`).

Code quality: follows the house bash-test shape (`set -uo pipefail`, `NO_COLOR=1`, `ROOT` from `BASH_SOURCE`, PASS/FAIL counters, non-zero exit). Check logic is a single reusable `run_drift_check` rather than duplicated per case; mutations run against `mktemp -d` scratch trees, so the suite never mutates the checkout. No dead code, no TODO/FIXME, no owner-protected path referenced for writing anywhere in the diff. Behaviour-preserving where expected: the four rendered files are exact copies of core, with no drive-by edits.

### Phase 3: UI Review — N/A

Node/bash tooling repo; no `frontend/**`, no API/schema/spec-surface changes. No dev server started.

### Overall: PASS

### Non-blocking Suggestions

- `RENDERED_SCRIPTS_DRIFT_SOURCE_ONLY=1` is a second env escape hatch: if it were ever set in the ambient environment, `npm test`'s invocation of the script would `exit 0` having asserted nothing. It is opt-in, test-only, and nothing sets it — but unlike `RENDERED_SCRIPTS_DRIFT_EXEMPT_EXTRA` it is not recorded under design.md's Risks. Worth one line there for symmetry.
- The test-case numbering has gaps (2.10/2.14/2.16/2.19 exist only as section comments), which reads as if checks were dropped. Cosmetic.
- The "core file deleted, render left behind" blind spot is documented and accepted; if it ever bites, the cheap follow-up is a rendered-side orphan scan with `.concertino.env`/`speeds.json` skipped.
