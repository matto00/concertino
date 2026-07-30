# dashboard-render-loop Specification

## Purpose
Defines the terminal-control contract for `lib/ui/watch.js`'s poll loop — no full-screen clear in steady state or on shutdown, paired alternate-screen-buffer entry/exit across every exit path (including a throwing `attach`), stale-row cleanup when a frame shrinks, and immediate reflow on resize — independent of what any individual screen renders.
## Requirements
### Requirement: The dashboard never fully clears the screen after startup
The dashboard (`lib/ui/watch.js`) SHALL NOT emit a full-screen clear
(`\x1b[2J`) anywhere in its steady-state or shutdown behavior, once the
alternate screen buffer has been entered — not on a regular poll redraw, and
not as part of its quit/shutdown routine. Each poll redraw SHALL home the
cursor and overwrite the previous frame's content, with every rendered line
padded, by *visible column width* (not raw string length — a line carrying
ANSI colour escapes SHALL still be padded to the correct visible width), to
the terminal's current column width, so that no character from the previous
frame remains visible without an intervening blank frame.

#### Scenario: No full-screen clear on a steady-state poll tick
- **WHEN** the dashboard redraws in response to its regular poll timer
- **THEN** the bytes written to the terminal do not include `\x1b[2J`

#### Scenario: No full-screen clear on shutdown
- **WHEN** the dashboard's shutdown routine (`quit()`) runs, regardless of
  which input triggered it
- **THEN** the bytes written to the terminal during shutdown do not include
  `\x1b[2J`

#### Scenario: Every redrawn line is padded to terminal width by visible columns
- **WHEN** the dashboard redraws and the current frame's rendered lines are
  narrower than `process.stdout.columns`
- **THEN** each line is padded with trailing spaces to the full *visible*
  column width before being written, so a shorter new line cannot leave
  stale characters from a longer previous line visible

#### Scenario: A coloured line is padded correctly, not under-padded
- **WHEN** a rendered line carries ANSI SGR colour escapes (e.g. from
  `lib/ui/format.js`'s `bold`/`dim`/`yellow`/etc.) and its raw string length
  therefore exceeds its visible column width
- **THEN** the line is padded based on its visible width, not its raw
  length, so it still reaches the full terminal column width on screen

### Requirement: A shrinking frame leaves no stale trailing rows
The dashboard SHALL blank out any extra trailing rows left over from the
previous, taller frame when the newly rendered frame has fewer lines than
the immediately preceding frame, so that no row of the previous frame
remains visible below the new frame's last line.

#### Scenario: Frame shrinks between two consecutive polls
- **WHEN** a redraw produces fewer lines than the previous redraw
- **THEN** every row from the end of the new frame through the end of the
  previous, taller frame is blanked (overwritten with spaces) in the same
  redraw

### Requirement: Alternate screen buffer is entered once and exited on every exit path
The dashboard SHALL enter the terminal's alternate screen buffer
(`\x1b[?1049h`) once, before its first redraw, and SHALL exit it
(`\x1b[?1049l`) exactly once on every path that ends the dashboard process,
including a normal quit keypress, Ctrl-C, piped stdin reaching EOF or close,
and any other path that reaches the dashboard's shutdown routine. Entry and
exit SHALL be paired: the dashboard SHALL NOT emit `\x1b[?1049h` more than
once per session, and SHALL NOT exit without a matching prior entry.

#### Scenario: Alternate buffer entered before the first frame
- **WHEN** the dashboard starts
- **THEN** `\x1b[?1049h` is written to the terminal before the first
  rendered frame is written, and is written exactly once for the session

#### Scenario: Alternate buffer exited on quit
- **WHEN** the dashboard's shutdown routine runs, regardless of which input
  triggered it (`q`, Ctrl-C, stdin `end`, stdin `close`)
- **THEN** `\x1b[?1049l` is written to the terminal exactly once as part of
  that shutdown

### Requirement: Attach suspends and restores the dashboard's alternate screen state around tmux
Handing the terminal to `tmux attach` (the `attach` action) SHALL exit the
dashboard's alternate screen buffer before control passes to tmux, and SHALL
re-enter the alternate screen buffer once control returns to the dashboard —
on both the normal return path and any path where the attach call throws.
This restoration SHALL use the same exception-safe mechanism already used to
restore raw mode around attach.

#### Scenario: Attach exits the alternate buffer before tmux takes the terminal
- **WHEN** the user attaches to a running ticket's tmux window
- **THEN** `\x1b[?1049l` is written before `tmux attach` is invoked

#### Scenario: Detaching from tmux restores the dashboard's alternate buffer
- **WHEN** the user detaches from tmux and control returns to the dashboard
- **THEN** `\x1b[?1049h` is written before the dashboard resumes polling,
  whether or not the attach call itself threw

### Requirement: Resizing mid-run reflows without corrupting the frame
The dashboard SHALL respond to a terminal resize (`SIGWINCH`) by redrawing
against the new dimensions rather than waiting for the next scheduled poll
tick, and this redraw SHALL apply the same width-padding and shrink-cleanup
behavior as a regular poll-tick redraw, so a resize can never leave stale
content from the pre-resize frame on screen.

#### Scenario: A resize triggers an immediate redraw
- **WHEN** the terminal is resized while the dashboard is running
- **THEN** the dashboard redraws using the new terminal dimensions without
  waiting for the next regularly scheduled poll tick

#### Scenario: Shrinking the terminal during a run does not corrupt the display
- **WHEN** the terminal is resized smaller mid-run
- **THEN** the resize-triggered redraw pads and blanks trailing rows exactly
  as a regular poll-tick redraw would, leaving no stale content from the
  larger, pre-resize frame

### Requirement: A trailing newline in the rendered text does not produce an extra written row
When the text handed to the frame builder ends in a trailing newline, the dashboard SHALL NOT count or write an extra blank row for the empty string that trailing newline produces when the text is split into lines — the written frame's row count and content SHALL reflect only the actual rendered lines.

#### Scenario: A frame built from newline-terminated text has no phantom trailing row
- **WHEN** the dashboard redraws from text that ends in `'\n'` (the normal case — `draw()` always appends one)
- **THEN** the bytes written to the terminal contain exactly the rendered content's rows, with no additional fully-blank row appended at the bottom

