# settings-screen Specification

## Purpose
Provide an in-TUI settings screen, opened with `s` from the fleet screen, for browsing and editing every field in `concertino.config.json` — grouped by the config schema's own top-level sections, with per-field descriptions, types/enums, and current values, in-place editing, schema validation before write, and explicit save/discard — so operators no longer have to leave the dashboard to inspect or change configuration.
## Requirements
### Requirement: `s` keybinding opens the settings screen from the fleet screen
The fleet screen SHALL bind the `s` key to open a new settings screen (`mode = 'settings'`), registered in `router.js`'s `SCREENS` map alongside the existing `fleet`/`drilldown`/`ticketview`/`launchpad`/`docview`/`ticketdraft` entries, following the same `{ render, handleKey }` seam every other screen uses.

#### Scenario: Pressing s from the fleet screen opens settings
- **WHEN** the operator is on the fleet screen (`mode = 'fleet'`) with no prompt/confirmation overlay open and presses `s`
- **THEN** the app transitions to `mode = 'settings'` and renders the settings screen

#### Scenario: Escape returns to the fleet screen without saving
- **WHEN** the operator is on the settings screen, has made no unsaved edits or has unsaved edits, and presses Escape (with no field-edit prompt open)
- **THEN** the app discards any staged, unsaved edits and returns to `mode = 'fleet'` without writing to `concertino.config.json`

### Requirement: Settings are grouped into sections matching the config schema's top-level keys
The settings screen SHALL present a navigable, two-pane layout: a section list (the schema's top-level keys — `harnesses`, `project`, `ticketProvider`, `specProvider`, `worktree`, `devServers`, `gates`, `canonicalDocs`, `ui`, `dashboard`, `budgets`, `models`, `modelTiers`, `speeds`, `agentMerge`, `commitTrailer`) and a field list scoped to the selected section.

#### Scenario: Selecting a section shows its fields
- **WHEN** the operator moves the section-list cursor to a given top-level schema key and focuses the field pane
- **THEN** the field pane lists every leaf field under that section, each showing its dotted path relative to the section

### Requirement: Each field displays its schema description, current value, and type/enum constraint
For every field, the settings screen SHALL show the `description` from `config/concertino.schema.json`, the field's current value (from the loaded `concertino.config.json`, falling back to the schema's `default` when the field is unset), and the field's `type` or `enum` constraint when the schema defines one.

#### Scenario: An unset field shows its schema default
- **WHEN** a field is absent from the on-disk `concertino.config.json` and the schema declares a `default` for it
- **THEN** the settings screen displays that default as the field's current value, visibly distinguished from an explicitly-set value

#### Scenario: An enum field shows its allowed values
- **WHEN** a field's schema entry declares an `enum`
- **THEN** the settings screen displays the field's allowed values alongside its current value

### Requirement: Scalar and enum leaf fields are editable in place
The settings screen SHALL allow editing of scalar (string/number/integer/boolean) and enum leaf fields nested under `project`, `worktree.ports`, `ui`, `dashboard`, `budgets`, `agentMerge`, `commitTrailer`, per-role entries of `models`/`modelTiers`, and `speeds`. A boolean field SHALL toggle directly on `Enter`/`Space`. An enum field SHALL cycle to its next allowed value on `Enter`/`Space`. A string/number/integer field with no enum SHALL open a single-line text-edit prompt on `Enter`, seeded with its current value, committing the typed (and, for number/integer fields, numerically-coerced) value into the in-memory candidate config on `Enter` and discarding the in-progress edit on `Escape`.

Array-of-object and object-collection fields (`harnesses`, `gates`, `canonicalDocs`, `devServers`) are out of scope for in-place editing in this screen; they SHALL render read-only with a hint directing the operator to `concertino update` or a direct file edit.

#### Scenario: Editing a boolean field toggles it
- **WHEN** the operator selects a boolean field (e.g. `agentMerge.enabled`) and presses `Enter`
- **THEN** the field's staged value flips to its opposite boolean value without opening a text prompt

#### Scenario: Editing an enum field cycles its value
- **WHEN** the operator selects a field whose schema declares an `enum` and presses `Enter`
- **THEN** the field's staged value advances to the next value in the schema's `enum` list, wrapping back to the first after the last

#### Scenario: Editing a free-text field opens a seeded prompt
- **WHEN** the operator selects a string or number field with no `enum` and presses `Enter`
- **THEN** a single-line text-edit prompt opens, pre-filled with the field's current value, and typing plus `Enter` commits the new value into the in-memory candidate config

#### Scenario: An array/object-collection field is read-only
- **WHEN** the operator selects a field under `harnesses`, `gates`, `canonicalDocs`, or `devServers`
- **THEN** the settings screen displays its value without entering an editable state, alongside a hint to use `concertino update` or a direct file edit

### Requirement: Saving validates the full candidate config against the schema before writing
The settings screen SHALL provide a dedicated save action, distinct from the fleet screen's own `s` keybinding, shown in the screen's footer. On save, the settings screen SHALL validate the complete in-memory candidate configuration (the on-disk config with all staged edits applied) using the same validation logic `concertino validate` (`cmdValidate` in `bin/concertino`) already applies — reused via a shared function, not reimplemented — before writing anything to disk.

#### Scenario: A valid set of edits is saved to disk
- **WHEN** the operator has staged one or more edits that pass schema validation and triggers the save action
- **THEN** the candidate configuration is written to `concertino.config.json` and the app returns to `mode = 'fleet'`

#### Scenario: An invalid edit is rejected, not written
- **WHEN** the operator has staged an edit that fails schema validation (e.g. a value outside an enum's allowed set written through a path this screen does not itself prevent, or a required field cleared) and triggers the save action
- **THEN** the settings screen displays the specific validation error(s) inline, leaves `concertino.config.json` unmodified, and remains open with the invalid edits still staged

### Requirement: No regression to existing CLI config behavior
`concertino update <key=value>` and `concertino validate` SHALL retain their existing observable behavior (stdout output, exit codes) after the settings screen is added — any shared validation logic extraction SHALL NOT alter what either CLI command prints or when it exits non-zero.

#### Scenario: concertino validate output is unchanged
- **WHEN** `concertino validate` is run against a config that previously passed or failed a given check
- **THEN** it prints the same ✓/!/✗ lines and returns the same exit code as before the settings screen was added

#### Scenario: concertino update still writes raw JSON without materializing defaults
- **WHEN** `concertino update <key=value>` is run
- **THEN** it continues to read, modify, and write only the raw on-disk config (no schema defaults materialized into the written file), exactly as before the settings screen was added

