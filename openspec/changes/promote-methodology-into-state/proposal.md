## Why

A run's methodology — verification/implementation constraints reached during
Planning or a design-gate REFUTE round — is currently recorded only in
`tasks.md`. Both the executor and evaluator resume paths explicitly skip
re-reading `tasks.md`/planning artifacts on resume (`core/roles/executor.md`:
"skip step 1 and jump to step 2"; `core/roles/evaluator.md`: "do NOT re-read
the ticket/proposal/design/tasks"). A constraint agreed expensively in round 1
is therefore silently out of force by round 3, and nothing detects the loss —
confirmed against this repo at `8c746fb` (see `premise-validation.md`).

## What Changes

- Add `CONSTRAINTS` (standing methodology constraints, id + text + provenance
  + retired flag), `CONSTRAINT_REVIEWS` (one entry per skeptic verdict,
  recording what — if anything — that verdict promoted), and
  `SKEPTIC_VERDICTS_TOTAL` (a counter) to `workflow-state.template.md`.
  Written/incremented at the moment a skeptic verdict is received or a
  Planning ESCALATION resolves — not only into `tasks.md`.
- `core/roles/orchestrator.md` (Phase 1 design gate and Phase 2 final gate):
  after every skeptic verdict, record a `CONSTRAINT_REVIEWS` entry (promoting
  a `CONSTRAINTS` entry + `tasks.md` marker when the verdict settles a
  methodology-shaped constraint; empty `promoted` otherwise) before resuming
  the executor or re-running the gate.
- `core/roles/executor.md` and `core/roles/evaluator.md`: since both roles
  already read `workflow-state.md` on every cycle including resume (budgets,
  ports, cycle count), their existing resume path picks up `CONSTRAINTS`
  automatically — add one line to each doc's resume note instructing the role
  to treat non-retired `CONSTRAINTS` as binding, same standing as the Iron
  Laws.
- **Mechanical divergence check (CON-166/CON-173 precedent):** add a
  `check-constraints-carryover.sh` script, run as an explicit new Phase 3
  step 0 (before `design.md`'s re-persist and before the squash/archive —
  `assert-phase.sh`'s `delivery` phase fires only after archiving has
  already moved these files, so this check is never wired into it), that
  three-way-compares `tasks.md`'s markers,
  `CONSTRAINTS`, and the union of `CONSTRAINT_REVIEWS[].promoted`, and also
  checks `len(CONSTRAINT_REVIEWS) == SKEPTIC_VERDICTS_TOTAL` — catching an
  unrecorded verdict, not only a mismatched marker. Detection is mechanical;
  remediation remains a prompt-level obligation, matching CON-166's
  asymmetry. (Design-gate round 1 found the original same-instruction
  dual-write design could not detect a never-promoted constraint at all —
  see `design.md` Decision 2 for the honest scope of what this revision
  actually closes.)
- Explicit placement decision, recorded in `design.md`: this ships at the
  Concertino level (`core/`), not per-repo — see design.md for reasoning.

## Capabilities

### New Capabilities

- `methodology-carryover`: standing run constraints carried in
  `workflow-state.md` across resume, plus a mechanical divergence check
  against `tasks.md`.

### Modified Capabilities

(none — no existing capability spec currently governs `workflow-state.md`'s
schema or the resume-read contract; this is new behavior, not a change to an
existing documented requirement)

## Impact

- `core/workflow-state.template.md` — new `CONSTRAINTS`, `CONSTRAINT_REVIEWS`,
  `SKEPTIC_VERDICTS_TOTAL` fields; amended "never prose procedure" invariant
  comment (Decision 2b).
- `core/roles/orchestrator.md` — write `CONSTRAINTS`/`CONSTRAINT_REVIEWS` at
  the point a verdict/resolution is reached (Planning escalation resolution;
  every design-gate/final-gate skeptic verdict); a new explicit Phase 3 step 0
  running the divergence check before the squash/archive.
- `core/roles/executor.md`, `core/roles/evaluator.md` — resume-note addition:
  treat non-retired `CONSTRAINTS` as binding.
- `core/scripts/check-constraints-carryover.sh` (new, standalone — not wired
  into `assert-phase.sh`, which runs the `delivery` phase after archiving has
  already moved the relevant files) — mechanical divergence check.
- Rendered mirror in `scripts/concertino/` (this repo self-hosts; CON-173's
  drift gate requires the render to move in the same delivery — updated via
  direct `cp`, not `concertino sync`, per delivery instructions).
- No breaking change to `workflow-state.md`'s existing fields, and no change
  to `assert-phase.sh` at all — all three new fields are additive/optional,
  defaulting to `[]`/`[]`/`0` when absent from an existing file.
