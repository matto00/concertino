## 1. next-report-number.sh

- [x] 1.1 Create `core/scripts/next-report-number.sh`: usage
      `next-report-number.sh <change-dir> <kind>` (`kind` ∈ `evaluation` | `skeptic-design` |
      `skeptic-final`). Validate `<change-dir>` exists and is readable (`FAIL` otherwise). Scan for
      files matching `^<kind>-([0-9]+)\.md$`, compute `next` = (highest match, or 0) + 1. If
      `<change-dir>/<kind>-<next>.md` does not exist, print `READY number=<next>
      path=<change-dir>/<kind>-<next>.md` and exit 0; if it unexpectedly does exist, print
      `FAIL <reason>` to stderr and exit non-zero. Follow this repo's existing script conventions
      (`set -uo pipefail`, header comment explaining purpose/contract, no new binary deps).
- [x] 1.2 Copy `core/scripts/next-report-number.sh` to `scripts/concertino/next-report-number.sh`
      byte-identical (per `doctor.js`'s `checkArtifacts` contract — every file in `core/scripts/`
      has a byte-identical copy under `scripts/concertino/`).
- [x] 1.3 Add `test/scripts/next-report-number.test.sh` (matching this repo's existing
      `test/scripts/*.test.sh` convention for `core/scripts/*.sh` tests, e.g.
      `test/scripts/persist-evidence.test.sh`) covering: empty dir → 1; existing `-1`/`-2` → 3;
      independent numbering per kind; missing/unreadable change dir → FAIL; the
      unexpected-pre-existing-target FAIL path (may need to fabricate that state directly since
      the scan itself should never produce it in practice).
- [x] 1.4 Add `test/scripts/next-report-number.test.sh` to `package.json`'s hand-maintained
      `"test"` script chain (a flat `&&`-list of every `test/scripts/*.test.sh` file by name — no
      glob) so it actually runs under `npm test` and this change's own gate runs, not just when
      invoked manually.

## 2. persist-evidence.sh --no-clobber

- [x] 2.1 Add an optional `--no-clobber` third argument to `core/scripts/persist-evidence.sh`.
      When present: if the computed `DEST_PATH` exists, compare its content to `SOURCE_PATH`
      (e.g. `cmp -s`); identical → proceed to the existing `READY ref=` success path without
      re-copying; different → print `FAIL <reason>` to stderr, print no `READY` line, exit
      non-zero, leave the destination untouched. When absent, behavior is byte-for-byte unchanged
      from today.
- [x] 2.2 Update the script's header comment to document the new flag and its content-aware
      semantics, alongside the existing "Idempotent/re-runnable" note (clarify that note now
      applies unconditionally only when `--no-clobber` is omitted).
- [x] 2.3 Copy the updated `core/scripts/persist-evidence.sh` to
      `scripts/concertino/persist-evidence.sh` byte-identical.
- [x] 2.4 Extend `persist-evidence.test.sh` (or create it, matching this repo's existing test
      conventions for `core/scripts/*.sh`) with cases for: `--no-clobber` + no existing
      destination (succeeds, same as without the flag); `--no-clobber` + identical existing
      content (no-op success); `--no-clobber` + differing existing content (FAIL, destination
      unchanged); omitting `--no-clobber` entirely still unconditionally overwrites (regression
      guard for the existing idempotent-overwrite contract).

## 3. Evaluator role changes

- [x] 3.1 In `core/roles/evaluator.md`'s Output/Step 1, replace the unconditional
      `evaluation-<CYCLE>.md` write target with: call
      `scripts/concertino/next-report-number.sh WORKTREE_PATH/<change-dir> evaluation`, and write
      to the `path=` it returns. Update the report header format to state both the
      orchestrator-supplied `CYCLE` and the disk-derived filename, e.g.
      `## Evaluation Report — Cycle N (evaluation-<M>.md)`.
- [x] 3.2 Update the "Return only" verdict block and the `persist-evidence.sh`/`emit-event.sh`
      invocations immediately below it to reference the actual written path (no longer hardcoding
      `evaluation-<CYCLE>.md`), and add `--no-clobber` to that `persist-evidence.sh` call.
- [x] 3.3 Add a guardrail/step note: if `next-report-number.sh` fails, tag `BLOCKER` with the
      script's failure reason rather than guessing a fallback filename (mirrors the existing
      `start-servers.sh`/`persist-evidence.sh` FAIL-handling pattern already in this role).

## 4. Skeptic role changes

- [x] 4.1 In `core/roles/skeptic.md`'s Output/Step 1, replace the unconditional
      `skeptic-<GATE>-<N>.md` write target with: call
      `scripts/concertino/next-report-number.sh WORKTREE_PATH/<change-dir> skeptic-<GATE>` (i.e.
      `skeptic-design` or `skeptic-final` depending on `GATE`), and write to the `path=` it
      returns. Update the report header format to state both the orchestrator-supplied round `N`
      and the disk-derived filename, e.g. `## Skeptic Report — <GATE> gate (round N,
      skeptic-<GATE>-<M>.md)`.
- [x] 4.2 Update the "Step 2: Return" block and the `persist-evidence.sh`/`emit-event.sh`
      invocations immediately below it to reference the actual written path (no longer hardcoding
      `skeptic-<GATE>-<N>.md`), and add `--no-clobber` to that `persist-evidence.sh` call.
- [x] 4.3 Add the same `next-report-number.sh`-fails-is-a-`BLOCKER` guardrail note as the
      evaluator (task 3.3).

## 5. Verification

- [x] 5.1 Run this project's full script test suite (`npm test`, which runs `package.json`'s
      `test/scripts/*.test.sh` chain) and confirm no regressions, including the new
      `next-report-number.test.sh` (task 1.4) and extended `persist-evidence.test.sh` (task 2.4).
- [x] 5.2 Manually exercise the new numbering end-to-end in a scratch directory: create
      `evaluation-1.md`/`evaluation-2.md` by hand, run `next-report-number.sh` for `evaluation`,
      confirm it returns `3`; repeat for `skeptic-design`/`skeptic-final` confirming independent
      numbering.
- [x] 5.3 `openspec validate fix-report-numbering-collision --strict` passes clean.
- [x] 5.4 Confirm `core/roles/evaluator.md` and `core/roles/skeptic.md` no longer contain any
      unconditional `evaluation-<CYCLE>.md` / `skeptic-<GATE>-<N>.md` literal write-target
      references left over from before this change (grep to confirm every reference now goes
      through `next-report-number.sh`'s returned path).
