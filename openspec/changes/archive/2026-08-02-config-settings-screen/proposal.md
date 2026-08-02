## Why

`concertino.config.json` is currently only editable by hand or via `concertino update <key=value>` on the CLI. There is no in-TUI way to browse what a setting means or change it without leaving the dashboard, editing a file, and re-syncing. The schema at `config/concertino.schema.json` already carries descriptions/types/enums/defaults for every field, but nothing in the TUI surfaces them. This makes the config opaque to anyone who hasn't memorized the schema, and turns a one-key toggle (e.g. flipping `agentMerge.enabled`) into a context switch out of the dashboard.

## What Changes

- Add a new `s` keybinding on the fleet screen that opens a settings screen (`mode = 'settings'`), registered in `router.js` alongside the existing screens.
- Add `lib/ui/screens/settings.js`, following the existing per-screen `render`/`handleKey` (`routeHandleKey`) seam.
- The settings screen groups fields into sections matching the schema's own top-level keys (`project`, `ticketProvider`, `specProvider`, `worktree`, `devServers`, `gates`, `canonicalDocs`, `ui`, `dashboard`, `budgets`, `models`, `modelTiers`, `speeds`, `agentMerge`, `commitTrailer`, `harnesses`), navigable as a section list + field list (two-pane, matching the existing drilldown/launchpad multi-panel convention).
- Each field shows: its `description` (from the schema), its current value (from the loaded config, falling back to the schema `default` when unset), and its `type`/`enum` constraint when the schema defines one.
- Fields are editable in place. An edit is staged in screen-local state, not written to disk immediately.
- A dedicated save key validates the full in-memory candidate config against the schema (reusing the existing `bin/concertino` config-loading/validation logic — extracted into a shared, reusable function rather than re-implemented) and, only if valid, writes it back to `concertino.config.json`. A failed validation surfaces the specific error(s) inline and leaves the on-disk file untouched.
- Escape returns to the fleet screen, discarding any unsaved edits.
- **BREAKING**: none — this is purely additive to the TUI; the CLI (`concertino update`, `concertino validate`) and on-disk config format are unchanged.

## Capabilities

### New Capabilities
- `settings-screen`: an in-TUI screen (opened via `s` from the fleet screen) for browsing and editing every field in `concertino.config.json`, grouped by the schema's top-level sections, with per-field descriptions/types/current-values, in-place editing, schema validation before write, and explicit save/discard semantics.

### Modified Capabilities
(none — no existing capability's requirements change; `bin/concertino`'s validation logic is refactored for reuse, but its own CLI-facing behavior/contract is unchanged, so this is an implementation detail, not a spec-level change to an existing capability)

## Impact

- **New file:** `lib/ui/screens/settings.js` (render/handleKey/routeHandleKey, following docview.js's/fleet.js's existing structure).
- **Modified:** `lib/ui/router.js` (register the `settings` screen).
- **Modified:** `lib/ui/screens/fleet.js` (`s` key → `open-settings` action).
- **Modified:** `lib/ui/watch.js` (mode transitions to/from `'settings'`, state fields for the open settings session, wiring `open-settings`/save/discard actions).
- **Modified:** `bin/concertino` (extract cmdValidate's config-checking logic into a shared, reusable validate-candidate-config function so the settings screen and `concertino validate`/`concertino update` share one implementation; no change to either CLI command's observable output/behavior).
- **Read-only:** `config/concertino.schema.json` (source of descriptions/types/enums/defaults — not modified).
- No changes to `concertino.config.json`'s on-disk format, `concertino update`, or `concertino validate`'s CLI behavior.
