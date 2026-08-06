# cli-config-path-resolution Specification

## Purpose
Defines the shared `resolveOut`/`resolveConfigPath` helpers in `lib/cli/shared.js` that every CLI command uses to resolve its `--out`/`--config` paths consistently, replacing ten independent hand-written copies of the same resolution logic.
## Requirements
### Requirement: Shared `--out` resolution helper
`lib/cli/shared.js` SHALL export a `resolveOut(args)` function that resolves the effective output/target directory from parsed CLI args, returning `path.resolve(args.out || '.')`.

#### Scenario: `--out` provided
- **WHEN** a CLI command is invoked with `--out <dir>`
- **THEN** `resolveOut(args)` returns the absolute path of `<dir>`

#### Scenario: `--out` omitted
- **WHEN** a CLI command is invoked without `--out`
- **THEN** `resolveOut(args)` returns the absolute path of the current working
  directory

### Requirement: Shared `--config` resolution helper
`lib/cli/shared.js` SHALL export a `resolveConfigPath(args, out)` function that resolves the effective config file path: `args.config`, absolutized, when provided; otherwise `<out>/concertino.config.json`.

#### Scenario: `--config` provided
- **WHEN** a CLI command is invoked with `--config <path>`
- **THEN** `resolveConfigPath(args, out)` returns the absolute path of
  `<path>`, independent of `out`

#### Scenario: `--config` omitted
- **WHEN** a CLI command is invoked without `--config`
- **THEN** `resolveConfigPath(args, out)` returns `<out>/concertino.config.json`

### Requirement: All ten duplicated call sites use the shared helpers
The `sync`, `diff`, `eject`, `update`, `gates`, `doctor`, `watch`, `validate`, `prune`, and `migrate` CLI commands SHALL resolve their `out` and config path via `resolveOut`/`resolveConfigPath` from `lib/cli/shared.js` rather than hand-written duplicate logic, with no change to the resulting values for any existing invocation.

#### Scenario: Behavior unchanged after extraction
- **WHEN** any of the ten commands is invoked with the same arguments before
  and after this change
- **THEN** the resolved `out` and config path are identical in both cases

