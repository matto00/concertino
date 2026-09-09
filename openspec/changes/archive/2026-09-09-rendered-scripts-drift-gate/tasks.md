## 1. Write the drift gate

- [x] 1.1 Create `test/scripts/rendered-scripts-drift.test.sh` following the house shape used by `test/scripts/tui-attached.test.sh` (`set -uo pipefail`, `NO_COLOR=1`, `ROOT` from `BASH_SOURCE`, `PASS`/`FAIL` counters, non-zero exit when `FAIL` is non-zero).
- [x] 1.2 Enumerate the comparison set recursively from `core/scripts/**` only (relative paths, including the nested `lib/` subdirectory); never enumerate from `scripts/concertino/`.
- [x] 1.3 For each enumerated path, byte-compare against `scripts/concertino/<same relative path>`, and separately assert that every rendered `.sh` is executable (do NOT compare the two modes — `lib/cli/emit.js:450` chmods every rendered `.sh` to 0755 regardless of core's mode, and `core/scripts/lib/git-child-env.sh` is committed 644 against a 755 render, so mode equality would be red on arrival with a remedy that cannot clear it); collect content mismatches, non-executable renders, and missing counterparts into three separate lists. A rendered `.sh` that is not executable is unrunnable and must not stay green.
- [x] 1.4 Add the exemption table at the top of the script, seeded with `pricing-table.json` and `report-cost.sh`, each with the written reason "owner has not ruled — tracked by CON-173". Apply it to the missing-counterpart list only; never to content mismatches. The table must be readable from the environment (e.g. an env var whose entries are appended to the built-in list) so task 3.4 can add a synthetic entry without editing the script under test.
- [x] 1.5 On failure, print the offending paths under three separate headings: `content differs`, `not executable`, and `never rendered`, and print the remedy: run `concertino sync` and commit the resulting render as its own reviewable diff. Do not print any text suggesting an edit to a file under `scripts/concertino/`.
- [x] 1.6 Register the script in `package.json`'s `test` script, by appending another `&& bash test/scripts/<name>.test.sh` link to the explicit chain (it is a named chain, not a glob).

## 2. Clear the existing drift

- [x] 2.1 Copy `core/scripts/squash-branch.sh` over `scripts/concertino/squash-branch.sh`.
- [x] 2.2 Copy `core/scripts/check-merge-readiness.sh` over `scripts/concertino/check-merge-readiness.sh`.
- [x] 2.3 Copy `core/scripts/cleanup.sh` over `scripts/concertino/cleanup.sh`.
- [x] 2.4 Copy `core/scripts/README.md` over `scripts/concertino/README.md`.
- [x] 2.5 Ensure every copied `.sh` file is executable (0755), matching what `concertino sync` itself would produce.
- [x] 2.6 Confirm no other file under `core/scripts/**` differs, and confirm `scripts/concertino/.concertino.env` and `scripts/concertino/speeds.json` are unmodified by this change.
- [x] 2.7 Do not run `concertino sync` in this worktree, and do not add, move, or delete `pricing-table.json` or `report-cost.sh` anywhere.

## 3. Demonstrate the gate is failable by mutation

- [x] 3.1 Run the gate against the unmutated tree; record the green output. Note explicitly that this alone is not evidence the gate works.
- [x] 3.2 Append a byte to `scripts/concertino/emit-event.sh`, run the gate, record the non-zero exit and the `content differs` line naming that file, then restore the file and confirm the gate is green again.
- [x] 3.2b Clear the executable bit on a rendered `.sh` whose content matches core, run the gate, record the non-zero exit and the non-executable line naming it, then restore the bit and confirm the gate is green again. Also record that `core/scripts/lib/git-child-env.sh` (core 644, render 755, identical blob) does NOT fail the gate, demonstrating the assert-executable framing rather than mode equality.
- [x] 3.3 Create a throwaway file under `core/scripts/` with no rendered counterpart, run the gate, record the non-zero exit and the `never rendered` line naming it, then delete it and confirm the gate is green again.
- [x] 3.4 Verify the exemption cannot suppress a content mismatch, WITHOUT writing to any owner-protected path. Do not create, overwrite or delete `scripts/concertino/pricing-table.json` or `scripts/concertino/report-cost.sh` under any circumstances: those files are absent in this worktree but PRESENT as protected untracked files in the main checkout at `/home/matt/Development/concertino/scripts/concertino/`, which shares this worktree's path prefix, so a wrong working directory destroys exactly what AC 6 forbids. Instead: pick an ordinary rendered file that already exists in both trees (e.g. `emit-event.sh`), add a temporary synthetic exemption entry for it via the environment-supplied exemption list, append a byte to the rendered copy, run the gate, and record that it still fails as a content mismatch despite being exempt. Then restore the file and drop the synthetic entry.
- [x] 3.5 Write the three mutation transcripts (3.2, 3.3, 3.4) verbatim into the change directory as mutation evidence.

## 4. Verify

- [x] 4.1 Confirm `scripts/concertino/squash-branch.sh` is byte-identical to core and grep it for the validate-before-reset ordering, the staged-blob validation, the `DRY_RUN` mode, and the grouped-bullet declaration parser, to show the merged fixes actually arrived.
- [x] 4.2 Run the full `npm test` suite and record the result.
- [x] 4.3 Run `npx openspec validate rendered-scripts-drift-gate --type change` to exit zero.
- [x] 4.5 Confirm, as the final step before committing, that `/home/matt/Development/concertino/scripts/concertino/pricing-table.json` and `/home/matt/Development/concertino/scripts/concertino/report-cost.sh` still exist in the main checkout, are still untracked, and are still byte-identical to their `core/scripts/` counterparts. Record the check.
- [x] 4.4 Write `files-modified.md` in the change directory declaring every path this change touches.
