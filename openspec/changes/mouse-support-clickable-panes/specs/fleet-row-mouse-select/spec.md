## ADDED Requirements

### Requirement: Mouse-reporting lifecycle is textually paired
The dashboard SHALL enable SGR mouse-reporting mode (`\x1b[?1000h` + `\x1b[?1006h`) whenever it enables raw-mode stdin input, and SHALL disable it (`\x1b[?1000l` + `\x1b[?1006l`) on every path that disables raw-mode input, including normal quit, an uncaught error, and suspending the terminal for a tmux attach. No terminal mouse-reporting state SHALL remain enabled after the dashboard process has released the terminal.

#### Scenario: Mouse mode enabled on startup
- **WHEN** the dashboard enters raw-mode input on startup
- **THEN** it writes the SGR mouse-reporting enable sequence before accepting the first key

#### Scenario: Mouse mode disabled on quit
- **WHEN** the user quits the dashboard (`q` or Ctrl-C)
- **THEN** the dashboard writes the SGR mouse-reporting disable sequence before the process exits

#### Scenario: Mouse mode disabled on crash
- **WHEN** an uncaught exception terminates the dashboard (there was no crash-handling path before this change; this scenario requires a new top-level exception handler)
- **THEN** the dashboard writes the SGR mouse-reporting disable sequence, along with the rest of its terminal-restore sequence (raw mode off, alternate-screen exit, cursor shown), before the process exits, and the underlying error is still surfaced (re-thrown or printed) rather than silently swallowed

#### Scenario: Mouse mode suspended and restored around tmux attach
- **WHEN** the dashboard suspends its own terminal ownership to attach a tmux session, and later regains control
- **THEN** it disables mouse reporting before handing off the terminal, and re-enables it after regaining control

### Requirement: Left-click on a fleet run row selects that row
The fleet view SHALL recognize a left-button-press SGR mouse click whose terminal row maps to a currently-rendered run row, and SHALL dispatch the same absolute-selection action the equivalent keyboard digit-jump already uses, selecting that run without opening any further screen.

#### Scenario: Click selects the clicked row
- **WHEN** the user left-clicks a terminal row that the current fleet-view frame rendered as run row N
- **THEN** the dashboard selects run row N, exactly as if the equivalent digit-jump keyboard action had been used

#### Scenario: Click outside any rendered row is a no-op
- **WHEN** the user left-clicks a terminal row that is not part of the current frame's rendered run-row list (header, banner, QUEUED/QUICK START sections, metrics, or blank space)
- **THEN** the dashboard's selection state is unchanged and no action is dispatched

#### Scenario: Unrecognized mouse sequence falls through to keypress handling
- **WHEN** stdin delivers a byte sequence that does not match the recognized left-button-press SGR click pattern
- **THEN** the dashboard treats it as an ordinary key event through the existing keypress path, dispatching no click action
