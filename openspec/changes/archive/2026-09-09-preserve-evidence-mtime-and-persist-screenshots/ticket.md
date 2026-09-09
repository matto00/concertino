# CON-160: Evidence written worktree-local is destroyed at Phase 4, and rescuing it destroys its timestamp provenance

## Description

Two halves of one problem, found together during HEL-732:

1. Evidence a run writes worktree-local (screenshots, measurement dumps, before/after captures) is destroyed at Phase 4, when `cleanup.sh` removes the worktree.
2. Rescuing it destroys its timestamp provenance. Moving the files into the main checkout rewrote every BEFORE capture's mtime to the move time, so the stamps can no longer establish that the BEFOREs predate the change they document.

So the only evidence that survives a run is evidence whose provenance the rescue has already broken. This is not ticket-specific: any run that relocates evidence produces the same rewritten stamps.

Concretely, on HEL-732: 12 PNGs were moved to the main checkout to survive `cleanup.sh --phase4`, and all BEFOREs then carried an mtime of 09:42 — the same as the AFTERs.

**Premise correction from CON-160's own delivery (see `.concertino/runs/CON-160/evidence/premise-validation.md`):** `scripts/concertino/persist-evidence.sh` already exists at the base commit and already gives orchestrator/evaluator/skeptic/auditor *report* artifacts (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `evaluation-N.md`, `skeptic-*.md`, `auditor-report.md`, `premise-validation.md`) a durable location in the main checkout, outside the worktree. The real gaps are narrower than the ticket's "suggested direction" implies:

- **Gap A:** there is no established `persist-evidence.sh` call site for raw screenshot/measurement evidence (Playwright before/after PNGs, byte-size dumps) captured mid-review by the evaluator/skeptic — only their final report gets persisted today. That is why HEL-732 needed a manual "rescue move" at all.
- **Gap B:** `persist-evidence.sh` copies with `cp -f` (no `-p`), so even the one call path that already exists rewrites mtimes on every persisted artifact — not just on ad-hoc manual rescues. This is a single-line fix with a broad blast radius (every current and future caller).

## Acceptance Criteria

- `persist-evidence.sh` preserves the source file's mtime (and other stat-preservable attributes) on copy, verified by a test that a source file's mtime, deliberately backdated, survives a persist call unchanged.
- The evaluator and skeptic role docs (and, if applicable, the executor's) gain an explicit, named convention for persisting raw screenshot/measurement evidence (not just their final report) through `persist-evidence.sh` at capture time, during the run — not via a later manual rescue.
- Role docs state explicitly that temporal and positional evidence (mtime ordering, directory placement) is fragile across relocation, and that self-authenticating evidence (e.g. content/byte-size deltas) is preferred wherever the claim allows it.
- A gate-defect condition is documented: a gate that accepts mtime-based evidence at face value after being told the mtimes are unsound is a gate defect regardless of verdict.
- `scripts/concertino/persist-evidence.sh` (the rendered copy) is kept in sync with `core/scripts/persist-evidence.sh` per the drift gate (CON-173) — both updated in the same delivery via direct `cp`, not `concertino sync`.
