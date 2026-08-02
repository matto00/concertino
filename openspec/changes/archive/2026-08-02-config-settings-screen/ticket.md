# CON-57: "s" settings screen: view and edit concertino.config.json from the fleet page

## Description

There is currently no in-TUI way to view or edit config — `concertino.config.json` is only editable by hand or via `concertino update <key=value>` on the CLI (`cmdUpdate`, `bin/concertino:1633`). The schema is well-defined at `config/concertino.schema.json` (draft-07 JSON Schema covering `project`, `ticketProvider`, `specProvider`, `worktree`, `gates`, `ui`, `dashboard`, `budgets`, `models`, `speeds`, `agentMerge`, etc.), but nothing in the TUI reads it for display purposes.

Add an `s` keybinding on the fleet screen (confirmed free — not used anywhere in `fleet.js`'s `handleKey`) that opens a new settings screen for browsing and editing every setting in `concertino.config.json`, with per-setting descriptions.

This should be a fairly robust settings UI, not a flat key/value dump — sectioned by schema group (project, ticketProvider, worktree, gates, ui, dashboard, budgets, models, speeds, agentMerge, ...), matching the schema's own top-level grouping, with each field showing its description, current value, and (where the schema defines one) type/enum/default.

## Acceptance Criteria

* New `s` keybinding on the fleet screen opens a settings screen; a new mode/screen is registered in `router.js` alongside the existing `fleet`/`drilldown`/`ticketview`/etc. entries, following the codebase's existing per-screen `render`/`handleKey` pattern (no central keybinding registry exists yet — this screen owns its own `handleKey` like every other screen does).
* Settings are grouped into sections matching the schema's top-level keys, navigable (e.g. section list on one side, fields within the selected section on the other, or a collapsible tree — pick whatever fits the existing raw-ANSI rendering style used by `layout.js`/`format.js`).
* Each field displays its description pulled from `config/concertino.schema.json` (`description` keys), its current value (from the loaded `concertino.config.json`, falling back to schema default when unset), and its type/enum constraints where present.
* Fields are editable in place; edits are validated against the schema before being written back to `concertino.config.json` (reuse `loadConfig()`/`withDefaults()`/validation logic already used by `cmdValidate()` in `bin/concertino`, rather than re-implementing schema validation).
* Invalid edits (fails schema validation) are rejected with a visible error, not silently written or crash-inducing.
* Escape returns to the fleet screen without requiring a save; an explicit save action (e.g. a dedicated key, shown in the screen's footer/help hint) persists changes to disk.
* No regression to `concertino update <key=value>` or `concertino validate` CLI behavior — this is an additive UI on top of the same config file and schema.

## Reference

Linear: https://linear.app/helioapp/issue/CON-57/s-settings-screen-view-and-edit-concertinoconfigjson-from-the-fleet
