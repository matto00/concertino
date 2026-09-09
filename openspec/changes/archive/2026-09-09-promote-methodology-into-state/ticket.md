# CON-161: Methodology recorded in tasks.md is not binding, because agents re-read workflow-state.md on resume

## Description

A run's *methodology* — the how-to-verify decisions reached during Planning and
during design-gate rounds — gets written into `tasks.md`. But an agent resuming
mid-run re-reads `workflow-state.md`, not `tasks.md`. So a methodology
constraint agreed in round 1 is not reliably in force in round 3, and nothing
detects that it lapsed.

Observed shape: a decision like "read token values from source, never
transcribe them" or "this exception must be able to expire" is recorded in the
task list, then a later cycle proceeds without it because the resumed agent's
binding context never included it.

## Why it isn't just a documentation nit

The decisions most likely to be lost this way are exactly the ones that were
expensive to reach. Several this batch took two or three design-gate rounds to
settle. Losing one silently re-opens a defect class that a gate has already
paid to close, and the loss is invisible — there is no "this constraint was
dropped" signal, only work that quietly stops honouring it.

## Suggested direction

Pick one of:

1. **Promote methodology into** `workflow-state.md` — a dedicated section for
   constraints that bind for the remainder of the run, written there at the
   moment they are agreed rather than only into `tasks.md`.
2. **Make** `tasks.md` **part of the resume read** wherever `workflow-state.md`
   is read, so the two can't diverge in what an agent actually has in context.
3. Have `assert-phase.sh` verify that constraints recorded in one place are
   present in the other, and fail loudly on divergence.

Option 1 is probably right: `workflow-state.md` is already the resume
contract, and the fix is to stop treating it as *state* only and let it also
carry *standing constraints*.

## Related

- CON-140 / CON-146 — same family of "the doc says it and the behaviour
  doesn't follow", but those concern a rule that IS in the role doc and still
  isn't obeyed. This one is a rule that never reaches the agent's context at
  all.
- CON-166 — precedent for making *detection* mechanical (verdict-SHA binding,
  STALE/exit-4) while leaving remediation as a prompt obligation.
- CON-173 — precedent for a mechanical drift gate.

Raised during the v0.7 original-scope overnight batch, 2026-09-08. Lane A owes
a view on whether this is best fixed at the Concertino level or per-repo.

## Acceptance Criteria

- A methodology constraint agreed during Planning or a design-gate round is
  written into `workflow-state.md` at the moment it is agreed, as a standing
  constraint section, not only into `tasks.md`.
- Every role doc whose resume path already reads `workflow-state.md` picks up
  these constraints automatically (no new file to separately re-read).
- A mechanical check (in the spirit of CON-166's STALE / CON-173's drift gate)
  detects divergence between constraints recorded in `workflow-state.md` and
  the corresponding methodology text in `tasks.md`/`design.md`, and fails
  loudly rather than silently — detection is mechanical even though full
  remediation may remain a prompt-level obligation.
- A decision is recorded on whether this belongs at the Concertino level (this
  repo) or per-repo (e.g. helio), with reasoning in `design.md`.
- New assertions added by this change are proven to fail against the
  pre-fix tree (red-first), per the pattern documented in helio's
  `MISTAKES.md` and this batch's recurring "precondition guarantees its own
  assertion" trap.
