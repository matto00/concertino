## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All 5 ticket acceptance criteria are addressed explicitly and match the implemented mechanism, not reinterpreted:
  - AC1 (diff classified during planning, run can't reach Delivery without checklist): `check-gate-chain-change.sh` classifies; `assert-phase.sh delivery` blocks. Verified working (see Phase 2).
  - AC2 (checklist explicitly asks the linked-worktree question): present verbatim as the 4th of 5 required sub-items, greppable in `assert-phase.sh` and mirrored in `core/roles/executor.md`/`core/roles/orchestrator.md`.
  - AC3 (isolation-first evidence recorded before wiring commit): `test-gate-in-isolation.sh` + executor.md 6a instruct isolation-test before the wiring commit; evidence path is durable via `persist-evidence.sh`.
  - AC4 ("I ran it and it passed" is not evidence, stated explicitly): present verbatim in `core/roles/executor.md` section 6a.
  - AC5 (enforced by workflow, not agent recall): mechanical script-based gate in `assert-phase.sh delivery`, fail-closed on classification/read errors.
- Tasks 1.1–5.3 in `tasks.md`: all 13 checked off and verified genuinely done (see Phase 2 — code exists, tests exist and pass, sync renders cleanly).
- No scope creep: diff is scoped to the classifier, isolation helper, Delivery-gate wiring, role-doc guidance, tests, and the two `lib/git-child-env.sh` files needed because the updated `assert-phase.sh` sources them (explicitly justified in `files-modified.md`). `package.json` change is a minimal two-line test-chain addition.
- No regressions: `npm test` is fully green (see Phase 2); existing `assert-phase.sh delivery` behavior for non-gate-chain diffs is explicitly tested and passes unaffected.
- No API/schema contracts affected (this is a Concertino workflow-process change, not a schema-touching change).
- `design.md` reflects the final implemented behavior, including two rounds of self-correction recorded honestly (Decision 4's template correction, Decision 5's red/green-infeasibility correction) — the corrections match what's actually implemented (verified directly against `test-gate-in-isolation.sh` and `assert-phase.sh`).

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates re-run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` flag set at this speed):**

```
$ npm test
...
check-gate-chain-change.sh: 8 passed, 0 failed
test-gate-in-isolation.sh: 9 passed, 0 failed
...
$ echo $?
0
```
Full suite green, no "not ok"/failed lines found via grep sweep of the complete output (including the pre-existing suites, `assert-phase.test.sh`'s new CON-132 section, `check-gate-chain-change.test.sh`, `test-gate-in-isolation.test.sh`).

**Independent verification of the executor's Decision-5 deviation claim (item 1 of the brief).** The executor's `test-gate-in-isolation.sh` exports `GIT_DIR`/`GIT_INDEX_FILE` but deliberately `unset`s `GIT_WORK_TREE` before invoking the target script, on the stated grounds that exporting `GIT_WORK_TREE` prevents reproducing the incident's bare-reinit mechanism, and that real hooks never export it. I reproduced this myself in two disposable `mktemp -d` fixtures (never against this repo or helio):
  - Fixture A: `git worktree add`, then `cd` into the linked worktree and ran `git init` with only `GIT_DIR`/`GIT_INDEX_FILE` exported (`GIT_WORK_TREE` unset) → the main repo's `.git` was flipped bare (`git rev-parse --is-bare-repository` → `true`), reproducing the incident exactly.
  - Fixture B: identical setup but with `GIT_WORK_TREE` additionally exported → `git init` left the repo non-bare (`false`) — confirms exporting `GIT_WORK_TREE` would have masked the exact defect this ticket exists to catch.
  - Fixture C: a real git repo with an actual `.git/hooks/pre-commit` script that dumps `env | grep '^GIT_'` invoked via `git worktree add` + `git commit` from the linked worktree — confirmed a genuine git hook exports only `GIT_DIR` and `GIT_INDEX_FILE`, never `GIT_WORK_TREE`.
  The executor's claim is correct on both halves: real hooks don't export `GIT_WORK_TREE`, and excluding it from the fixture is required to faithfully reproduce the incident rather than accidentally prevent it. This is a well-justified, verified deviation, not a shortcut.

**Verification of the Delivery-gate evidence check (item 2).** `test/scripts/assert-phase.test.sh`'s new CON-132 section (`new_gatechain_pair`, lines ~393-554) already builds real throwaway bare-remote+clone fixtures and calls the actual `assert-phase.sh delivery`/`check-gate-chain-change.sh` — not a reimplementation — for: no-evidence (FAIL), checklist-only (FAIL, isolation missing), evidence for the wrong script (FAIL naming the right one), full evidence (PASS), and a non-gate-chain diff (PASS, unaffected). This is genuine red-before-green against the real scripts and it passed cleanly under my own fresh `npm test` run (not trusting the executor's own report). I additionally read `assert-phase.sh`'s `delivery` case directly (lines 139-221) and confirmed the evidence-check logic — checklist heading/sub-item grep, per-script isolation-transcript lookup keyed off `check-gate-chain-change.sh`'s own `SCRIPT` lines — matches design.md Decisions 2-4 exactly, and fails closed (non-`GATECHAIN yes` classification errors also `fail`).

**Checklist wording consistency (item 3).** The exact heading `## Gate-Chain Implications Checklist` and the five sub-item prompts (`What does it execute?` / `What environment does it inherit, and from where?` / `Does it write anything outside its own sandbox?` / `Does it behave differently from a linked worktree than from a main checkout?` / `What happens on its first run?`) are byte-identical across `core/scripts/assert-phase.sh`'s grep logic, `core/roles/executor.md` §6a, and `core/roles/orchestrator.md` step 4a — confirmed via direct grep across all four files.
- **Non-blocking nit:** `core/roles/orchestrator.md` line 344 attributes the mechanical checklist grep to `check-gate-chain-change.sh`'s "Delivery gate," but the checklist-content check actually lives in `assert-phase.sh`'s `delivery` case (`check-gate-chain-change.sh` only classifies the diff, per Decision 2). Cosmetic misattribution only — the wording it points to is still correct and identical to what's actually enforced.

**`core/`→`scripts/concertino/` sync copies:** confirmed byte-identical via `diff` for all three rendered files (`check-gate-chain-change.sh`, `test-gate-in-isolation.sh`, `assert-phase.sh`).

**Sync dry-run (task 5.1):** ran `bin/concertino sync --out=<tmpdir> --dry-run --config=config/examples/concertino.json` myself against a throwaway `/tmp` dir — renders cleanly, validation passes, and both new scripts appear in the "would copy" list with no error.

**Pre-existing `scripts/concertino/` drift (item 5, informational, non-blocking):** confirmed via `git ls-tree main -- core/scripts/` vs. `git ls-tree main -- scripts/concertino/` (both compared against the actual `main` branch tip, matching `origin/main`) that `lib/`, `pricing-table.json`, `report-cost.sh`, and `squash-branch.sh` already existed under `core/scripts/` without a rendered counterpart under `scripts/concertino/` *before* this ticket's branch point — the executor's report is accurate; this drift predates and is unrelated to their changes.

**Standards compliance:** `CONTRIBUTING.md` has no file-size budget or `[mechanical]`-tagged rules for this repo (explicitly documented as intentional, not an oversight); new files (150/289/+69-line diff to `assert-phase.sh`) are reasonably sized and follow the repo's comment-heavy, ticket-id-provenance style consistent with existing code. DRY: reuses `persist-evidence.sh`, `lib/git-child-env.sh`'s `git_child` wrapper, and the existing `assert-phase.sh` fail-closed pattern rather than inventing new mechanisms. No dead code, no unused imports, no leftover TODO/FIXME found in the diff.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` changes — this is a pure Concertino-workflow (bash/markdown) change with no UI surface. (Note: this ticket's target repo is Concertino itself, which has no `frontend/`/`backend/` directories in the helio sense; the UI-review triggers do not apply.)

### Overall: PASS

### Non-blocking Suggestions
- `core/roles/orchestrator.md` line 344: correct "the same wording `check-gate-chain-change.sh`'s Delivery gate ... checks for mechanically" to attribute the checklist-content grep to `assert-phase.sh`'s `delivery` case instead, matching Decision 2's actual division of responsibility (`check-gate-chain-change.sh` classifies only).
