## 1. Fix mtime preservation in persist-evidence.sh

- [x] 1.1 Locate the existing test suite for `persist-evidence.sh` (if any) and add a test that
      backdates a source file's mtime via `touch -d`, calls the pre-fix script, and asserts it
      goes RED (destination mtime != source mtime) — confirming the bug is real before fixing it.
- [x] 1.2 Change `core/scripts/persist-evidence.sh`'s copy line from `cp -f` to `cp -fp`.
- [x] 1.3 Re-run the same test and confirm it goes GREEN.
- [x] 1.4 Mirror the fix into `scripts/concertino/persist-evidence.sh` via direct `cp` from
      `core/scripts/persist-evidence.sh` (never `concertino sync` — CON-173 drift gate). Diff the
      two files afterward to confirm they are byte-identical.
- [x] 1.5 Update the script's header comment block to note mtime preservation as part of its
      contract.

## 2. Extend evidence-telemetry spec

- [x] 2.1 Confirm `openspec validate preserve-evidence-mtime-and-persist-screenshots --type change`
      passes with the delta spec already written in this change (`specs/evidence-telemetry/
      spec.md`).

## 3. Evaluator/skeptic role-doc conventions

- [x] 3.1 Add a "Persisting screenshot/measurement evidence" subsection to `core/roles/
      evaluator.md`, instructing a `persist-evidence.sh` call for each cited screenshot/
      measurement artifact at capture time, with the report citing the persisted path.
- [x] 3.2 Mirror the same subsection into `core/roles/skeptic.md` (adjusted for the skeptic's own
      report-naming convention).
- [x] 3.3 Add the "temporal/positional evidence is fragile across relocation; prefer self-
      authenticating evidence" note to both role docs.
- [x] 3.4 Add the gate-defect condition ("accepting disclosed-unsound mtime evidence at face
      value is a recorded defect regardless of verdict") to both role docs.

## 4. Verification

- [x] 4.1 Run the full test suite covering `scripts/concertino/persist-evidence.sh` /
      `core/scripts/persist-evidence.sh` and confirm green.
- [x] 4.2 Run `openspec validate preserve-evidence-mtime-and-persist-screenshots --type change`
      and confirm it exits zero.
- [x] 4.3 Manually exercise `persist-evidence.sh` end-to-end (backdated source → persist → verify
      destination mtime) inside the worktree as a final sanity check before handoff.
