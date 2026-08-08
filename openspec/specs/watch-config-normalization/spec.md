# watch-config-normalization Specification

## Purpose
Defines `cmdWatch`'s (`lib/cli/watch.js`) responsibility to normalise a parsed `concertino.config.json` via `lib/config.js`'s `withDefaults` before constructing the dashboard, while preserving the existing guarantee that a missing or malformed config never prevents `concertino watch` from starting.
## Requirements
### Requirement: `cmdWatch` normalises a parsed config before constructing the dashboard
When `lib/cli/watch.js`'s `cmdWatch` successfully `JSON.parse`s `concertino.config.json`, it SHALL run the parsed object through `lib/config.js`'s `withDefaults` before passing it to `watch({ root, config })`, so the dashboard receives the same defaults and alias resolution (e.g. `ticketProvider.kind: "manual"` → `"local"`) as the `sync`/`diff`/`eject`/`migrate` CLI paths.

#### Scenario: A config using the deprecated `manual` ticketProvider.kind is normalised before reaching watch()
- **WHEN** `concertino watch` is invoked against a project whose `concertino.config.json` has `ticketProvider.kind: "manual"` and a `project` object
- **THEN** the `config` object `watch()` receives has `ticketProvider.kind === "local"`

#### Scenario: A config's other withDefaults() defaults are applied before reaching watch()
- **WHEN** `concertino watch` is invoked against a project whose `concertino.config.json` omits `worktree.base`
- **THEN** the `config` object `watch()` receives has `worktree.base === ".concertino/worktrees"`

### Requirement: A missing or malformed config does not prevent `concertino watch` from starting
`cmdWatch` SHALL NOT let the absence of `concertino.config.json`, a JSON parse failure, or a `withDefaults` normalisation failure (e.g. a parsed config missing the `project`/`ticketProvider` objects `withDefaults` requires) become a fatal/uncaught error. In each such case it SHALL still construct and start the dashboard.

#### Scenario: No config file at all
- **WHEN** `concertino watch` is invoked against a project with no `concertino.config.json`
- **THEN** the dashboard still starts, receiving `config: {}`

#### Scenario: Config file is not valid JSON
- **WHEN** `concertino watch` is invoked against a project whose `concertino.config.json` fails to parse as JSON
- **THEN** the dashboard still starts, receiving `config: {}`

#### Scenario: Config file is valid JSON but missing keys withDefaults requires
- **WHEN** `concertino watch` is invoked against a project whose `concertino.config.json` parses successfully but omits `project` and/or `ticketProvider`, causing `withDefaults` to throw
- **THEN** the dashboard still starts, receiving the raw, un-normalised parsed object as `config` — the same object `cmdWatch` would have handed over before this normalisation was added

