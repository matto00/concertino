## Why

`persist-evidence.sh` already gives every run's planning/evaluation/skeptic/auditor *report*
artifacts a durable home outside the worktree (`evidence-telemetry`), but it copies with `cp -f`
(no `-p`), so every persisted artifact's mtime is silently rewritten to the copy time — and no
role ever persists raw screenshot/measurement evidence (only their final report), so that
evidence still needs a manual "rescue move" that suffers the same mtime loss. On HEL-732 this
made 12 before/after PNGs carry an identical mtime, destroying the one signal that could show
which captures predated the change. Evidence that is actively misleading is worse than evidence
that is simply absent.

## What Changes

- `persist-evidence.sh` copies with `cp -fp` instead of `cp -f`, preserving the source's mtime
  (and other stat-preservable attributes) on every call, for every existing caller, with no flag
  needed to opt in.
- The evaluator and skeptic role docs gain an explicit, named convention
  (`persist-artifact-evidence`) for persisting raw screenshot/measurement evidence they capture
  mid-review through `persist-evidence.sh` at capture time, alongside their existing final-report
  persist call — closing the gap that made HEL-732's manual rescue necessary in the first place.
- Role docs (evaluator, skeptic) state explicitly that temporal (mtime) and positional (directory
  placement) evidence is fragile across any relocation, and that self-authenticating evidence
  (content/byte-size deltas, checksums) is preferred wherever the claim being made allows it.
- A gate-defect condition is documented: a gate (evaluator or skeptic) that accepts mtime-based
  ordering evidence at face value after being told the mtimes are unsound is a gate defect,
  recorded regardless of that gate's verdict.
- `scripts/concertino/persist-evidence.sh` (the rendered self-hosted copy) is updated via direct
  `cp` from `core/scripts/persist-evidence.sh` in the same delivery, per the CON-173 drift gate —
  never via `concertino sync`.

## Capabilities

### New Capabilities

(none — this extends an existing capability's requirements; no new capability path)

### Modified Capabilities

- `evidence-telemetry`: `persist-evidence.sh` now preserves the source's mtime on copy
  (`cp -fp`), and the evaluator/skeptic gain a named convention for persisting screenshot/
  measurement evidence during a run, not only their final report, with role-doc guidance on
  evidence fragility and a documented gate-defect condition for accepted-at-face-value unsound
  mtime evidence.

## Impact

- `core/scripts/persist-evidence.sh` / `scripts/concertino/persist-evidence.sh` — one-line copy
  flag change, plus updated header comments.
- `core/roles/evaluator.md`, `core/roles/skeptic.md` — new "persisting screenshot/measurement
  evidence" subsection each, plus a short "evidence fragility" note and the gate-defect
  condition.
- `openspec/specs/evidence-telemetry/spec.md` — new/updated requirements for mtime preservation
  and screenshot-evidence persistence.
- No API, schema, or wire-format changes. No breaking changes.
