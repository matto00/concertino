## ADDED Requirements

### Requirement: The dashboard can open a URL in the OS default browser
The dashboard TUI (`lib/ui/watch.js`) SHALL provide a mechanism to open a given URL in the
operating system's default browser via `xdg-open` (Linux — this tool's only supported platform),
invoked synchronously, without transitioning to any other screen mode.

#### Scenario: Opening a URL succeeds
- **WHEN** the dashboard is asked to open a well-formed URL and `xdg-open` is available and
  succeeds
- **THEN** the browser opens the URL and the dashboard's current screen remains on screen,
  unchanged

### Requirement: A failed browser-open surfaces a visible notice instead of crashing
The dashboard SHALL NOT crash or exit if the browser-open command is unavailable, exits non-zero,
or throws for any other reason; instead it SHALL surface a visible, human-readable notice
identifying the URL that could not be opened, using the same on-screen notice mechanism already
used for other recoverable action failures (e.g. a failed restart).

#### Scenario: xdg-open is missing
- **WHEN** the dashboard is asked to open a URL and `xdg-open` is not found on the system
- **THEN** the dashboard remains running and shows a visible notice that the URL could not be
  opened, rather than crashing or silently doing nothing

#### Scenario: xdg-open exits non-zero
- **WHEN** the dashboard is asked to open a URL and the browser-open command exits with a non-zero
  status
- **THEN** the dashboard remains running and shows a visible notice that the URL could not be
  opened
