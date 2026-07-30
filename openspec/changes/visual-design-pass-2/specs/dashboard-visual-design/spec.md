## MODIFIED Requirements

### Requirement: Status colour is consistent across screens

A shared colour vocabulary (`STATUS_COLOUR` in `lib/ui/format.js`) SHALL govern the colour used for a given semantic status (needs-you, running, failed, done, gate pass, gate fail) everywhere that status is rendered, so the same status reads with the same colour on every screen it appears on. No element SHALL be coloured for decoration alone — every colour used SHALL correspond to an entry in `ROLE_COLOUR` or `STATUS_COLOUR`. `running` SHALL render with a visually distinct, active-reading treatment from `done`; `done` SHALL remain `dim` (settled/receding). This distinction SHALL be visible at the level of an individual fleet row (not solely in a section title or heading) — a screen where `running` only ever recolours a heading word, with every row unchanged, does not satisfy this requirement.

#### Scenario: Failed status is the same colour everywhere
- **WHEN** a run's status is `failed`
- **THEN** the fleet view's FAILED section heading and the drill-down's
  header both render that status with the same colour

#### Scenario: Running reads as active, done reads as settled, at the row level
- **WHEN** the fleet view renders one `running` run and one `done` run under
  `isTTY` true
- **THEN** each run's own row (not only a shared section heading) carries a
  colour distinguishing the two — concretely, each row's progress bar is
  coloured via `STATUS_COLOUR[run.status]` — and the `done` run's row-level
  colour is the `dim` SGR code

#### Scenario: Running reads the same colour on the launch pad as on the fleet view
- **WHEN** the launch pad's tickets pane renders a selected ticket whose
  inline status is `▲ running`
- **THEN** that status text is coloured via `STATUS_COLOUR.running`, the
  same shared vocabulary entry the fleet view's row-level bar and the
  drill-down header use — not an independent, hardcoded colour

### Requirement: Selection and focus are visually distinct states

A selected row within the currently focused pane SHALL render more prominently than a selected row within an unfocused pane on the same screen, via bold text, the pane's accent colour, and/or a background fill; the latter SHALL remain visible (not identical to an unselected row) but SHALL NOT use the same emphasis as a selection in the focused pane.

#### Scenario: Selected row recedes in an unfocused pane
- **WHEN** the epics pane holds the previously-selected epic but keyboard
  focus has moved to the tickets pane
- **THEN** the epic row's selection marker is still present but rendered
  with less emphasis (e.g. dimmed) than the selected row in the tickets pane

## ADDED Requirements

### Requirement: Colour capability widens with an honest fallback

`lib/ui/format.js` SHALL detect, once at require time alongside its existing `isTTY` check, whether the terminal supports an extended (256-colour) palette, using `$TERM` and `$COLORTERM`. When detected, semantic colour functions (`red`, `green`, `yellow`, `blue`, `magenta`, `cyan`) SHALL emit the corresponding 256-colour SGR sequence (`38;5;N`); when not detected but `isTTY` is true, they SHALL continue to emit the existing 3-bit SGR codes unchanged; when `isTTY` is false, they SHALL continue to emit no escape at all. Callers use the same function names and signatures regardless of tier — capability dispatch is internal to `format.js`, not pushed to call sites.

#### Scenario: A 256-colour-capable terminal gets the wider palette
- **WHEN** `isTTY` is true and `$TERM`/`$COLORTERM` indicate 256-colour support
- **THEN** `f.cyan('x')` emits a `38;5;N` SGR sequence rather than the 3-bit `36` code

#### Scenario: A plain terminal still gets the existing 3-bit palette
- **WHEN** `isTTY` is true and neither `$TERM` nor `$COLORTERM` indicate 256-colour support
- **THEN** `f.cyan('x')` emits the same `\x1b[36m` sequence it did before this change

#### Scenario: A non-TTY stream still emits nothing
- **WHEN** `isTTY` is false, regardless of `$TERM`/`$COLORTERM`
- **THEN** every colour function returns its input unchanged, exactly as before this change

### Requirement: A background-fill primitive is available for focused-pane row selection

`lib/ui/format.js` SHALL export a `bgFill` function, gated by the same `isTTY` rule as every other colour function, that applies a background fill: a 256-colour dark background paired with an explicit foreground (`48;5;236;38;5;253`) when the extended palette is detected — so the pair remains legible regardless of the terminal's own theme — and reverse video (SGR `7`) as the 3-bit fallback so the primitive remains meaningful, and already theme-independent, even on a basic-tier terminal. `lib/ui/layout.js`'s `box()` SHALL own the application of this fill via an optional `fillRow` (0-based content-row index) option, applying it only after its own truncate/pad pipeline has produced that row's final fixed-width content — never to a string that will subsequently be truncated by `box()` itself — so the fill spans the row's full width (including its padding columns). `bgFill` SHALL remain effective across any embedded SGR reset within the content it wraps, re-opening its own fill immediately after every such reset, so row content that carries its own inner colour (e.g. a status word's colour, a dim priority marker) does not truncate the fill early and no invariant is required of the content passed to it.

On the launch pad, the currently-selected row in the pane that currently holds keyboard focus (`lp.pane`) SHALL use this fill in place of the bold emphasis it previously used for that state; the selected row in the pane that does not hold focus is unaffected by this requirement and continues to render dimmed, as before.

#### Scenario: The launch pad's focused-pane selected row is filled, not merely bold
- **WHEN** the launch pad renders under `isTTY` true and the epics pane has
  focus (`lp.pane === 'epics'`)
- **THEN** the selected epic's row is rendered via `box()`'s `fillRow`,
  carrying a `bgFill` background SGR (256-colour fill or reverse video,
  depending on detected capability), and spans the row's full width

#### Scenario: The fill survives an embedded reset in the row's own content
- **WHEN** the launch pad's tickets pane has focus and the selected ticket's
  row carries its own inner colour-and-reset — either its status column
  (`▲ running`, coloured via `STATUS_COLOUR.running`) or an unknown-priority
  marker (`?`, coloured via `f.dim`)
- **THEN** the background fill is active across every column of that row,
  including the columns after the embedded reset — it does not stop short
  at the embedded reset the way a fill with no nesting-safety would

#### Scenario: A filled row's fill closes before the border, and survives further re-truncation
- **WHEN** a filled row's content is wider than the pane's inner width and
  is truncated by `box()`'s own pipeline before the fill is applied, and
  **WHEN** the resulting boxed line is truncated again further downstream
  (e.g. `launchpad.js`'s post-box `f.truncate` when the terminal is too
  narrow to fit both panes at full width)
- **THEN** in the first case the rendered row's fill closes immediately
  before the right border character, with no background left active past
  it; in the second case, if the downstream cut lands inside the fill's
  open span, a closing reset is re-appended at the cut point, and in
  neither case does the background bleed into the border or beyond it

#### Scenario: Background fill degrades to reverse video on a basic-tier terminal
- **WHEN** `isTTY` is true but the extended palette is not detected
- **THEN** `f.bgFill('x')` emits SGR `7` (reverse video) rather than a
  `48;5;N` sequence

#### Scenario: Background fill emits nothing on a non-TTY stream
- **WHEN** `isTTY` is false
- **THEN** `f.bgFill('x')` returns its input unchanged

### Requirement: Unfocused pane borders are dimmed, not colourless

`lib/ui/layout.js`'s `borderColour(false)` SHALL return `f.dim` rather than the identity function, so an unfocused pane's border visually recedes relative to a focused pane's border and relative to content. This is additive to, and never a replacement for, the existing structural (border-character) focus distinction — an unfocused pane's border characters remain the plain set (`┌─┐`/`│`) regardless of colour tier or `isTTY`.

#### Scenario: An unfocused border is dimmed under isTTY
- **WHEN** a pane is rendered with `focused: false` under `isTTY` true
- **THEN** its border characters carry the `dim` SGR code, not an unstyled
  (colourless) string

#### Scenario: A colourless terminal still shows no border colour at all
- **WHEN** a pane is rendered with `focused: false` under `isTTY` false
- **THEN** its border characters carry no escape sequence, exactly as before
  this change — `f.dim` still no-ops under `!isTTY`
