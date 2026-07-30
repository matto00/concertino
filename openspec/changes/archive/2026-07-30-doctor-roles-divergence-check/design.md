## Context

`coresDiffer(coreA, coreB)` in `bin/concertino` iterates `for (const sub of ['scripts', 'laws'])`, diffing every file under each subdirectory between the two cores via `fileDiffers()`, then separately checks `workflow-state.template.md`. `roles/` is never included.

## Goals / Non-Goals

**Goals:**
- Detect drift in `core/roles/*.md` the same way drift in `core/scripts/*` and `core/laws/*` is already detected.

**Non-Goals:**
- Changing what happens once a divergence is detected (the existing note-and-continue behavior is unchanged).
- Touching `resolveCore()` or any other part of core resolution.

## Decisions

- Add `'roles'` to the existing `for (const sub of ['scripts', 'laws'])` loop in `coresDiffer()`, rather than writing a separate check — the loop already generalizes over a list of subdirectories and diffs every file found in either core's copy of that subdirectory (additions/removals included, via the `Set` union of both directory listings), so `roles/` needs no new logic, just membership in the list.

## Risks / Trade-offs

- None of note — this only adds a comparison; it cannot make an already-passing `doctor` run fail spuriously unless `core/roles/*` genuinely differs, which is exactly the condition it's meant to catch.
