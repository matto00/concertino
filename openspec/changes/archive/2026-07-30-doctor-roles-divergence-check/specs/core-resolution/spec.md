## ADDED Requirements

### Requirement: doctor's divergence comparison covers roles/
`concertino doctor`'s core-divergence comparison SHALL include `core/roles/*` alongside `core/scripts/*`, `core/laws/*`, and `core/workflow-state.template.md` when determining whether the target's core has diverged from the executing script's core.

#### Scenario: diverged role file triggers the same divergence note as scripts/laws
- **WHEN** `concertino doctor` is run against a target whose `core/roles/*.md` content differs from the executing script's own `core/roles/*.md`, with `scripts/`, `laws/`, and `workflow-state.template.md` otherwise identical
- **THEN** `doctor` reports the same divergence note it already prints for a `scripts/` or `laws/` difference
