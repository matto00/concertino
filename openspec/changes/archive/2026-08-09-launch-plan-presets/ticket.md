# CON-111: Launch presets for the launch plan's harness/speed/provider combo

## Description

The launch plan's per-row overrides (`H` harness, `S` speed, `P` provider — see `docs/dashboard.md`'s launch-pad section) have to be re-cycled by hand every time a batch is launched. A recurring combo (e.g. "fast, local/ollama, agent-merge on") has no way to be saved and reapplied.

## Proposed

A named preset — captured from the launch plan's current batch-level settings (harness/speed/provider/agent-merge), saved to `.concertino/cache/` alongside the existing ticket cache, and selectable from the launch plan (a new key — needs a free letter, see design decisions) to apply all of a preset's settings to the current batch in one keystroke.

## Design decisions to escalate

* Batch-level only, or does a preset also carry per-row overrides? Per-row overrides are keyed to a specific ticket selection, which won't generally match the next batch's tickets — likely batch-level only, but worth confirming rather than silently assuming.
* Where presets are managed (create/rename/delete) — inline on the launch plan, or a dedicated screen off the settings screen?
* Free letter for the "apply preset" key — `keys.js`'s claimed-letter tally is already dense (`a c d f h H j k l L m n N p P q r s S t y`); this needs an explicit pick.

## Acceptance criteria

* A batch-level harness/speed/provider/agent-merge combo can be saved as a named preset and reapplied to a later batch in one keystroke.
* Presets persist across dashboard restarts (same durability precedent as the queue cache).
* Documented in `docs/dashboard.md`'s launch-pad section.
