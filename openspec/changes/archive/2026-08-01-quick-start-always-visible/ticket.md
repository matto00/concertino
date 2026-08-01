# CON-56: Quick Start section always visible by default (remove the toggle)

## Description

QUICK START is currently hidden by default and shown only via the `Q` toggle key: `quickStartVisible` starts `false` (`lib/ui/watch.js:545`), flipped by `Q` (`QUICK_START_TOGGLE_KEY`, `lib/ui/screens/fleet.js:92`, handled in `watch.js:1380-1428`), and `buildSections()` only includes the section `if (o.quickStartVisible)` (`fleet.js:365`).

Make Quick Start always shown — no toggle needed.

## Acceptance Criteria

* QUICK START renders on every fleet page load with no user action required (`buildSections()` no longer gates it behind a visibility flag).
* The `Q` toggle key and its handling in `watch.js:1380-1428` are removed (not left as a dead no-op) — check `fleet.js:83-91`'s collision-avoidance comment for `Q` in case that key should be freed up or reassigned rather than deleted outright.
* `docs/dashboard.md` and any other keybinding docs/help text referencing the `Q` toggle are updated to drop it.
* Existing Quick Start row rendering/interaction (`renderQuickStartRow()`, local focus navigation) is unchanged — only its default visibility changes.
