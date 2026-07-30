## MODIFIED Requirements

### Requirement: The dashboard never fully clears the screen after startup
The dashboard (`lib/ui/watch.js`) SHALL NOT emit a full-screen clear
(`\x1b[2J`) anywhere in its steady-state or shutdown behavior, once the
alternate screen buffer has been entered — not on a regular poll redraw, and
not as part of its quit/shutdown routine. Each poll redraw SHALL compare the
newly rendered frame's lines against the immediately previous frame's lines,
row by row, and SHALL write only the rows whose content differs from the
previous frame (including every row of the very first frame of a session,
which has no previous row to compare against) — each such row positioned via
its own cursor placement (`\x1b[<row>;1H`) immediately before that row's
content, rather than homing the cursor once and rewriting the whole frame. A
row whose content is unchanged from the previous frame SHALL NOT be
rewritten, with exactly one exception: the frame's own last row, which SHALL
also be written — positioned and padded exactly as any other written row —
whenever the redraw writes anything at all, regardless of whether the last
row's own content changed, so that the terminal cursor always comes to rest
at the same fixed position after any writing tick (see the cursor-rest
scenarios below). Every row that IS written, whether because its content
changed, because it belongs to the first frame of a session, or because it
is the frame's last row written for cursor-rest purposes, SHALL be padded,
by *visible column width* (not raw string length — a line carrying ANSI
colour escapes SHALL still be padded to the correct visible width), to the
terminal's current column width, so that no character from the previous
frame remains visible in that row without an intervening blank frame.

#### Scenario: No full-screen clear on a steady-state poll tick
- **WHEN** the dashboard redraws in response to its regular poll timer
- **THEN** the bytes written to the terminal do not include `\x1b[2J`

#### Scenario: No full-screen clear on shutdown
- **WHEN** the dashboard's shutdown routine (`quit()`) runs, regardless of
  which input triggered it
- **THEN** the bytes written to the terminal during shutdown do not include
  `\x1b[2J`

#### Scenario: A row whose content changed is written, padded to terminal width by visible columns
- **WHEN** a row's newly rendered content differs from that row's content in
  the previous frame, and the new row is narrower than
  `process.stdout.columns`
- **THEN** that row is written, positioned via its own cursor placement, and
  padded with trailing spaces to the full *visible* column width, so a
  shorter new row cannot leave stale characters from that row's previous,
  longer content visible

#### Scenario: A coloured line is padded correctly, not under-padded
- **WHEN** a row being written carries ANSI SGR colour escapes (e.g. from
  `lib/ui/format.js`'s `bold`/`dim`/`yellow`/etc.) and its raw string length
  therefore exceeds its visible column width
- **THEN** the row is padded based on its visible width, not its raw length,
  so it still reaches the full terminal column width on screen

#### Scenario: An unchanged row between two consecutive polls is not rewritten
- **WHEN** a redraw's row content, after padding, is identical to that same
  row's content in the immediately previous frame, and that row is not the
  frame's last row
- **THEN** no bytes are written for that row in this redraw — neither its
  content nor a cursor placement targeting it

#### Scenario: A single changed row is rewritten without touching any other row except the frame's last row
- **WHEN** exactly one row's content differs between two consecutive polls,
  every other row is unchanged, and the changed row is not the frame's last
  row
- **THEN** the bytes written for that redraw consist of that one row's
  cursor placement and padded content, followed by the frame's last row's
  own cursor placement and padded content (written for cursor-rest purposes
  per the scenario below), with nothing written for any other row

#### Scenario: An entirely unchanged frame writes nothing
- **WHEN** every row's content, after padding, is identical to the
  immediately previous frame's, and the frame has not shrunk
- **THEN** the redraw writes no bytes to the terminal at all

#### Scenario: A frame taller than the terminal falls back to a full rewrite
- **WHEN** the newly rendered frame has more lines than the terminal's
  current row count (`process.stdout.rows`)
- **THEN** the redraw does not use per-row diffing or absolute cursor
  placement for that frame — it writes the full frame via cursor-home and
  newline flow, exactly as every redraw did before this capability, so the
  terminal's own scroll behavior (and therefore which content remains
  visible when a frame is taller than the terminal) is unchanged

#### Scenario: The cursor is parked at the frame's last row after any tick that wrote something
- **WHEN** a poll redraw writes at least one row via the diff path (whether
  because a single row changed, several did, or the whole frame was
  invalidated after an attach or resize)
- **THEN** the last bytes written for that redraw position the cursor at the
  frame's last row and write that row's own padded content, so the cursor
  comes to rest at the same fixed position — the end of the frame — that a
  full-frame rewrite already left it at, regardless of which row(s) actually
  changed

#### Scenario: An entirely unchanged tick leaves the cursor exactly where it was
- **WHEN** a poll redraw writes no bytes at all because nothing changed
  since the previous frame
- **THEN** the terminal cursor is not moved by this redraw — it remains
  wherever the previous redraw that did write something left it

### Requirement: Attach suspends and restores the dashboard's alternate screen state around tmux
Handing the terminal to `tmux attach` (the `attach` action) SHALL exit the
dashboard's alternate screen buffer before control passes to tmux, and SHALL
re-enter the alternate screen buffer once control returns to the dashboard —
on both the normal return path and any path where the attach call throws.
This restoration SHALL use the same exception-safe mechanism already used to
restore raw mode around attach. Because re-entering the alternate screen
buffer clears it, and tmux has fully owned the terminal while attached, the
dashboard's row-diff cache SHALL be invalidated as part of this same
restoration — on both the normal return path and the throwing path — so
that the first redraw after control returns to the dashboard is a full
rewrite of every row, not a partial diff against content that is no longer
on screen.

#### Scenario: Attach exits the alternate buffer before tmux takes the terminal
- **WHEN** the user attaches to a running ticket's tmux window
- **THEN** `\x1b[?1049l` is written before `tmux attach` is invoked

#### Scenario: Detaching from tmux restores the dashboard's alternate buffer
- **WHEN** the user detaches from tmux and control returns to the dashboard
- **THEN** `\x1b[?1049h` is written before the dashboard resumes polling,
  whether or not the attach call itself threw

#### Scenario: The first redraw after returning from attach rewrites every row
- **WHEN** the dashboard's first poll redraw runs after control has returned
  from a `tmux attach` (whether the attach call returned normally or threw)
- **THEN** that redraw writes every row of the frame, not only rows whose
  content differs from whatever was on screen before the attach

### Requirement: Resizing mid-run reflows without corrupting the frame
The dashboard SHALL respond to a terminal resize (`SIGWINCH`) by redrawing
against the new dimensions rather than waiting for the next scheduled poll
tick, and this redraw SHALL apply the same width-padding and shrink-cleanup
behavior as a regular poll-tick redraw, so a resize can never leave stale
content from the pre-resize frame on screen. Because a resize can change the
terminal's row count without changing its column count — leaving a row's
padded content byte-identical to its pre-resize content even though the
terminal itself has just changed shape — the dashboard's row-diff cache's
CONTENT SHALL be invalidated whenever a resize is handled, regardless of
which dimension changed, so the resize-triggered redraw is always a full
rewrite of every row rather than a partial diff that could skip a row on the
strength of unchanged content alone. This invalidation SHALL preserve the
previous frame's own line count (unlike the cache reset used around `tmux
attach`, where the alternate screen buffer is genuinely cleared and no
previous length is meaningful) — a resize does not clear the terminal, so
the shrink-cleanup behavior this same requirement mandates still needs to
know how many trailing rows the pre-resize frame had, in case the
post-resize frame is shorter.

#### Scenario: A resize triggers an immediate redraw
- **WHEN** the terminal is resized while the dashboard is running
- **THEN** the dashboard redraws using the new terminal dimensions without
  waiting for the next regularly scheduled poll tick

#### Scenario: Shrinking the terminal during a run does not corrupt the display
- **WHEN** the terminal is resized smaller mid-run
- **THEN** the resize-triggered redraw pads and blanks trailing rows exactly
  as a regular poll-tick redraw would, leaving no stale content from the
  larger, pre-resize frame

#### Scenario: A rows-only resize still triggers a full rewrite, not a partial diff
- **WHEN** the terminal is resized such that its column count is unchanged
  but its row count changes (e.g. a tmux pane height change)
- **THEN** the resize-triggered redraw writes every row of the frame, not
  only rows whose padded content differs from the pre-resize frame
