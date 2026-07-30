## Files Modified

- `lib/ui/format.js` — Added `SUPPORTS_256` capability detection; refactored colour functions (`red`, `green`, `yellow`, `blue`, `magenta`, `cyan`) to dispatch on 256-colour support via shared `fg()` helper; changed `STATUS_COLOUR.running` from `dim` to `cyan`; added `bgFill()` nesting-safe background-fill primitive.

- `lib/ui/layout.js` — Updated `borderColour(false)` to return `f.dim` instead of identity function for unfocused borders; added optional `fillRow` parameter to `box()` to apply background fill to a designated content row after truncate/pad pipeline.

- `lib/ui/screens/launchpad.js` — Updated `ticketRow()` to drop outer `f.bold` from selected+focused row and route `▲ running` status through `f.STATUS_COLOUR.running` instead of hardcoded `f.yellow`; modified `renderLaunchPad()` to track selected row indices and pass `fillRow` to box options when pane is focused.

- `lib/ui/screens/fleet.js` — Added typographic hierarchy: bold ticket IDs, dim phase and elapsed time; changed per-row progress bar to use `STATUS_COLOUR[run.status]` instead of hardcoded `f.dim`.

- `test/format-colour.test.js` — Added `delete process.env.TERM` and `delete process.env.COLORTERM` before re-requiring modules to ensure deterministic colour-tier tests; added test coverage for `SUPPORTS_256` dispatch, `STATUS_COLOUR.running` vs `done`, and `bgFill` behavior.

- `test/layout-colour.test.js` — Added same `TERM`/`COLORTERM` deletion for deterministic testing; updated unfocused-box tests to assert `f.dim` SGR escape instead of no escape; added test coverage for `box()` with `fillRow` option.

- `test/launchpad.test.js` — Added `delete process.env.TERM`/`COLORTERM` to `withColour()` helper; CR1 replaced vacuous unfocused-selection assertion with real dim + no-fill checks; CR2 added direct `epicRow()` and `ticketRow()` tests verifying no outer-bold styling; CR4 updated pre-existing test asserting focused-selection fill (background highlight) instead of bold.

- `test/fleet.test.js` — Added `delete process.env.TERM`/`COLORTERM` for deterministic testing; added test coverage that running runs' progress bars carry `STATUS_COLOUR.running` (cyan) and done runs' bars carry dim, verified by locating bar lines and asserting their colour escapes.

- `lib/ui/screens/launchpad.js` (CR1 fix) — Fixed `epicRow()` to drop outer `f.bold` from selected+focused row, matching the same emphasis-swap pattern as `ticketRow()`.
