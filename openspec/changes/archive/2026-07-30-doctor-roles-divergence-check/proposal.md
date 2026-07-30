## Why

`bin/concertino`'s `coresDiffer()` — the function `doctor` uses to warn when a project's rendered core has drifted from the source-of-truth core — compares `scripts/`, `laws/`, and `workflow-state.template.md`, but not `roles/`. Roles are the actual behavioral spec each agent reads, so a diverged `core/roles/*.md` is arguably the most consequential drift `doctor` could miss, and today it misses it silently. Flagged as a known gap by CON-13's own review and never picked up since.

## What Changes

- `coresDiffer()` in `bin/concertino` also compares `core/roles/*` between the two cores, using the same per-file-diff logic already applied to `scripts/` and `laws/`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `core-resolution`: document that `doctor`'s divergence comparison covers `roles/` in addition to `scripts/`, `laws/`, and `workflow-state.template.md`.

## Impact

- `bin/concertino` (source of truth for `doctor`)
- `test/scripts/doctor-artifacts.test.sh` (new assertion for a diverged `roles/` file)
