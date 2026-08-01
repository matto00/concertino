## Why

The fleet view's `QUICK START` section — a priority-sorted shortcut to the top open tickets, with a one-key add-to-queue action — is currently hidden by default and only shown after the operator presses `Q`. That extra keypress adds friction to the exact workflow the section exists to speed up: starting the next most urgent ticket without leaving the fleet view. `QUICK START` should simply always be there, the same way `METRICS` already is.

## What Changes

- `buildSections()` (`lib/ui/screens/fleet.js`) no longer gates the `QUICK START` entry behind a `quickStartVisible` flag — it is now included unconditionally, exactly like the `METRICS` section already is.
- `watch.js` no longer maintains a `quickStartVisible` piece of state, defaulted `false`. **BREAKING** (internal state shape only, no external API): the section is now always computed and always rendered.
- The `Q` toggle key (`QUICK_START_TOGGLE_KEY`, `fleet.js`) and its `'toggle-quickstart'` action handling in `watch.js`'s `applyAction` are removed outright — not left as a dead no-op. Capital `Q` becomes free for future reassignment; `fleet.js`'s key-collision-avoidance comment block is updated to drop the claim.
- `docs/dashboard.md` (and any other keybinding help text) is updated to drop the `Q` toggle from the documented key map.
- `QUICK START`'s existing row rendering (`renderQuickStartRow()`) and local focus navigation (digit-jump into `quickstart` focus, `j`/`k` local cursor, `a` to add to queue, Escape to exit focus) are unchanged — only the section's default visibility changes, from conditional to unconditional.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `fleet-quick-start`: the "QUICK START is hidden by default and toggled by a dedicated key" requirement is replaced by "QUICK START is always visible, unconditionally" — the toggle mechanism and its `false`-by-default state are removed. Every other requirement in this capability (top-N priority ranking, empty/cold hints, non-perturbation of the run-selection index space, focus cursor and digit-jump entry, `a`-to-queue) is unchanged.

## Impact

- `lib/ui/screens/fleet.js`: `buildSections()`, `sectionJumpTargets()`, `handleKey()`, `render()`, the `QUICK_START_TOGGLE_KEY` constant and its collision-avoidance comment.
- `lib/ui/watch.js`: `quickStartVisible` state field and its initialization, the `'toggle-quickstart'` case in `applyAction`, and the `draw()` computation of `quickStartTickets`/`quickStartCold` (now unconditional instead of gated).
- `docs/dashboard.md`: keybinding documentation.
- Existing tests referencing `quickStartVisible`/the `Q` toggle/`'toggle-quickstart'`.
