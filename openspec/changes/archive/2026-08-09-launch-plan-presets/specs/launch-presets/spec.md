## ADDED Requirements

### Requirement: Presets persist on disk across dashboard restarts
The dashboard SHALL persist named batch-level presets to `.concertino/cache/presets.json`, containing an array of records each with `id`, `name`, `harness`, `speed`, `provider`, `agentMerge`, `createdAt`, `updatedAt`. Reads of a missing file, malformed JSON, a non-array `presets` field, or an individual entry failing shape validation SHALL degrade to treating only the invalid part as absent (a malformed single entry is dropped; the rest of the list still loads) rather than failing the whole read. Writes SHALL go through a temp file and rename, matching `lib/ui/queue-cache.js`'s existing write contract.

#### Scenario: Presets survive a dashboard restart
- **WHEN** one or more presets have been saved and the dashboard process is restarted
- **THEN** every previously-saved preset is available on the PRESETS screen and to the launch plan's `w` key, unchanged

#### Scenario: A malformed presets.json degrades to an empty list, not an error
- **WHEN** `.concertino/cache/presets.json` is missing, contains invalid JSON, or its `presets` field is not an array
- **THEN** the dashboard treats this as zero saved presets rather than showing an error or crashing

### Requirement: A dedicated PRESETS screen, reached from the settings screen, manages presets
The settings screen SHALL bind the `p` key to open a new PRESETS screen (`mode = 'presets'`), registered in `router.js`'s `SCREENS` map and `controllers/index.js`'s `CONTROLLERS` array following the same `{ render, handleKey }` seam every other screen uses. All preset lifecycle actions — create, rename, delete — happen on this screen; the launch plan itself offers no create/rename/delete affordance for presets.

#### Scenario: Pressing p from the settings screen opens PRESETS
- **WHEN** the operator is on the settings screen with no field-edit prompt or chooser open and presses `p`
- **THEN** the app transitions to `mode = 'presets'` and renders the list of saved presets (or an empty-state message when none exist)

#### Scenario: Escape returns to the settings screen without saving
- **WHEN** the operator is on the PRESETS screen, has staged unsaved changes (a new/renamed/deleted/edited preset), and presses Escape with no prompt or delete-confirmation open
- **THEN** the app discards every staged change and returns to `mode = 'settings'` without writing to `presets.json`

### Requirement: A new preset is created with named defaults and edited via the launch plan's own field-cycling keys
The PRESETS screen SHALL bind `n` to create a new preset: prompting for a name (a single-line text prompt, seeded empty), then appending a row seeded with `speed: 'default'`, `provider: null`, `agentMerge` from `agentMerge.enabled` in the project config, and `harness` from the project's first configured harness (or `null` if none is configured). On the row cursor's currently-selected preset, `h` SHALL cycle `harness` through `null` plus the project's configured harnesses (canonical ids), `s` SHALL cycle `speed` through `default`/`fast`/`slow`, `p` SHALL cycle `provider` through the values `harnessCmd.providerChoices()` returns for that row's current harness (bound only when `providers.ollama` is configured), and `m` SHALL toggle `agentMerge`.

#### Scenario: Creating a preset seeds it with project defaults
- **WHEN** the operator presses `n` on the PRESETS screen and submits a non-empty name
- **THEN** a new preset row is appended with `speed: 'default'`, `provider: null`, `agentMerge` matching the project's configured default, and `harness` matching the project's first configured harness (or none), and the row cursor moves to it

#### Scenario: Cycling a preset's harness
- **WHEN** the row cursor is on a preset and the operator presses `h`
- **THEN** that preset's staged `harness` value advances to the next value in `null` plus the project's configured harnesses, wrapping after the last

#### Scenario: Cycling a preset's speed
- **WHEN** the row cursor is on a preset and the operator presses `s`
- **THEN** that preset's staged `speed` value advances through `default` → `fast` → `slow`, wrapping

#### Scenario: Cycling a preset's provider only when configured
- **WHEN** `providers.ollama` is not configured for the project
- **THEN** pressing `p` on the PRESETS screen has no effect on the selected preset's `provider` value

#### Scenario: Toggling a preset's agent-merge setting
- **WHEN** the row cursor is on a preset and the operator presses `m`
- **THEN** that preset's staged `agentMerge` value flips

### Requirement: Presets can be renamed and deleted on the PRESETS screen
The PRESETS screen SHALL bind `r` to rename the row-cursor-selected preset (a text prompt seeded with its current name) and `d` to open a y/anything-else delete confirmation for it, mirroring the fleet screen's `markDoneConfirm`/`clearQueueConfirm` confirmation shape. Deleting removes the preset from the staged list; nothing is written to disk until `S` (save).

#### Scenario: Renaming a preset
- **WHEN** the operator presses `r` on a selected preset and submits a new non-empty name
- **THEN** that preset's staged `name` is updated to the submitted value, and its `id` is unchanged

#### Scenario: Deleting a preset requires confirmation
- **WHEN** the operator presses `d` on a selected preset
- **THEN** a confirmation prompt appears, and the preset is removed from the staged list only if the operator then presses `y`; any other key cancels the deletion with the preset list unchanged

### Requirement: Saving the PRESETS screen validates before writing to disk
The PRESETS screen SHALL bind `S` to validate the full staged preset list — every preset has a non-empty `name`; every `name` is unique (case-sensitive) among the staged list — and, only if valid, write it to `presets.json` via the temp-file-and-rename contract. On a validation failure, the specific error(s) SHALL be shown inline and nothing SHALL be written; the screen SHALL remain open with the invalid state still staged.

#### Scenario: Saving with a valid staged list writes to disk
- **WHEN** the operator presses `S` and every staged preset has a non-empty, unique name
- **THEN** `presets.json` is written with the staged list and the operator remains on the PRESETS screen (or returns to settings, per the screen's own confirmed navigation) with no error shown

#### Scenario: Saving with a duplicate name is rejected
- **WHEN** two or more staged presets share the same name and the operator presses `S`
- **THEN** `presets.json` is not written, and an inline error names the duplicate

### Requirement: The launch plan applies a saved preset to the current batch with the `w` key
The launch plan SHALL bind `w` to apply the next saved preset (cycling through the presets available when the plan was opened, wrapping after the last) to the current batch: setting `harness` (only when the preset's `harness` is non-null and present among the batch's configured harnesses), `agentMerge` (only when agent-merge is editable for this batch), `speed` (always), and `provider` (only when the batch's own per-row overrides are editable AND a provider is configured for the project — the identical two-part condition `plan.perRowEditable && plan.providerConfigured` the existing `p`/cycle-provider key already requires — and the preset's provider value is reachable from the resulting harness) — each dimension the preset does not specify, or cannot reach, is left unchanged. After applying, the launch command and the resolved-models preview SHALL be rebuilt exactly as they already are after cycling any one of `h`/`s`/`p`/`m` individually. `w` SHALL be unbound, and its footer hint omitted, when no presets exist.

#### Scenario: Applying a preset sets every reachable dimension at once
- **WHEN** the operator presses `w` on the launch plan and at least one preset is saved
- **THEN** the batch's harness, speed, provider, and agent-merge setting are all updated to match the applied preset wherever each is reachable for this project/batch, and the launch command / models preview reflect the change immediately

#### Scenario: An unreachable dimension is left unchanged, not errored
- **WHEN** an applied preset names a harness the current batch's `harnesses` list does not include, or a provider that is not configured for the project, or a provider while the batch is running under a `dashboard.launchCommand` override (`plan.perRowEditable` is false)
- **THEN** that specific dimension is left at its prior value and every other reachable dimension is still applied

#### Scenario: w is unavailable with no saved presets
- **WHEN** no presets have been saved
- **THEN** the launch plan does not bind `w` to any action, and its footer does not hint at a `w` key

#### Scenario: Repeated presses cycle through every saved preset
- **WHEN** more than one preset is saved and the operator presses `w` repeatedly
- **THEN** each press applies the next preset in order, wrapping back to the first after the last

### Requirement: The launch plan shows which preset is currently applied
The launch plan SHALL render a `preset` row alongside its existing `harness`/`agent-merge`/`speed`/`provider` rows, showing the name of the most recently applied preset (or an explanatory placeholder when none has been applied, or when none exist to apply) — visible before anything launches, matching the pre-flight visibility every other batch-level knob on this screen already has.

#### Scenario: The preset row names the applied preset
- **WHEN** the operator has applied a preset via `w`
- **THEN** the launch plan's `preset` row shows that preset's name

#### Scenario: The preset row explains unavailability when none are saved
- **WHEN** no presets have been saved
- **THEN** the launch plan's `preset` row indicates none are saved rather than being omitted
