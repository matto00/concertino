## Context

`lib/ui/watch.js` runs a `setInterval(draw, 1000)` poll loop. Today `draw()`
calls `clear()` (`process.stdout.write('\x1b[2J\x1b[H')`) — erase the whole
screen, home the cursor — and then writes the freshly-rendered frame. Between
those two writes the terminal is blank, which is the flicker CON-17 reports.
Separately, the dashboard never switches to the alternate screen buffer, so
it scrolls into (and overwrites) the user's normal terminal history, and
`session.attach(ticket)` (`lib/ui/session.js`) hands the whole terminal to
`tmux attach` via `spawnSync(..., { stdio: 'inherit' })` and gets it back
when that call returns.

`router.render()` and every screen under `lib/ui/screens/*` are pure
functions that return a single string; they know nothing about clearing,
cursors, or screen buffers. That boundary is deliberate (see `watch.js`'s own
header comment) and this change preserves it completely — every line touched
lives in `watch.js`.

## Goals / Non-Goals

**Goals:**
- Eliminate the blank frame between poll ticks (ticket approach 1).
- Enter the alternate screen buffer on startup, leave it on every exit path,
  including a throwing `attach` (ticket approach 2).
- Never leave stale rows on screen when a frame is shorter than its
  predecessor.
- Reflow correctly on `SIGWINCH` instead of corrupting or waiting for the
  next poll tick.
- Keep `router.render()` and every screen pure and untouched.

**Non-Goals:**
- Differential/line-diff rendering (ticket approach 3). The ticket calls this
  a follow-up "if the poll ever gets more expensive"; 1 Hz full-frame writes
  are cheap once the blank-frame gap is gone, so there is no performance
  motivation to do it now, and it would touch far more surface for no
  behavioural requirement in this ticket.
- Any change to what a frame contains (colours, layout, borders) — that is
  `dashboard-visual-design`'s territory, not this change's.

## Decisions

### 1. Cursor-home + pad-to-width overwrite, not `\x1b[2J`

Replace `clear()`'s `\x1b[2J\x1b[H` with `\x1b[H` (cursor home only) before
the frame write, and pad every rendered line to `cols` **visible columns**
before writing it. This is exactly the ticket's approach 1: the old frame is
covered character-by-character in the same paint as the new one, so there is
no window where the terminal shows neither frame.

Padding has to happen on the string `router.render()` returns, in `watch.js`,
not inside `layout.js` — `layout.js` already pads bordered content to a box's
*internal* width for its own box-drawing reasons, but the outermost frame
(e.g. blank margin lines, header/footer lines outside any box, or a screen at
less than full terminal width) is not guaranteed to reach `cols` on every
line today, since nothing currently needs it to.

Critically, this padding **must be visible-width aware, not raw
`.length`-based**. Header/footer lines outside any `layout.js` box already
carry embedded ANSI SGR escape bytes (e.g. `fleet.js`'s
`f.bold('concertino') + f.dim(' · ' + project)`, or `f.yellow(...)` status
lines) — `line.length` counts those escape bytes as columns they do not
occupy, which would systematically under-pad exactly the coloured lines and
reintroduce stale-character bleed at the right edge on every frame that uses
colour. The codebase already solves this: `lib/ui/format.js` exports
`padTo(s, n)`, which truncates to `n` *visible* columns (via its own
`visibleLength`/`truncate`, which already account for ANSI escapes and
wide/zero-width code points) and then pads with spaces to that visible
width — this is the established pattern `layout.js` itself already uses for
box content. `watch.js` reuses `format.js`'s `padTo` directly: split the
rendered string on `\n`, run each line through `padTo(line, cols)`, rejoin.
No new padding logic is written in `watch.js` — it is a consumer of the
existing utility, not a second implementation of it.

**Alternative considered:** pad inside `layout.js`. Rejected — it would leak
a terminal-writing concern (padding exists only to defeat a stale
overwrite) into the pure renderer, which is exactly the separation the
ticket's own "Notes" section calls out as what keeps this change safe.
`format.js`'s `padTo` is not itself a terminal-writing concern (it is a pure
string function, already used by the pure `layout.js`), so reusing it from
`watch.js` does not reintroduce that leak.

**Alternative considered:** pad by raw `.length`. Rejected — verified against
`lib/ui/format.js`'s own header comment (`format.js:142-149`) and confirmed
by inspecting `fleet.js`'s header/footer construction: outer-frame lines
routinely carry SGR escapes, so raw-length padding under-pads coloured lines
specifically, defeating the fix for exactly the lines most likely to be
visually prominent (status/header text).

### 2. Track previous frame height; blank any leftover trailing rows

Padding handles stale characters *within* a row, not stale *rows* below a
shorter frame — if frame N has 40 lines and frame N+1 has 30, lines 31-40
from frame N are never touched by writing only 30 lines. Track
`lastFrameLines` (the line count of the previous write, counted consistently
— i.e. the same split-on-`\n` array used for padding in Decision 1, not a
separate count that could disagree on whether the trailing `'\n'` `draw()`
appends after `router.render()`'s output contributes an extra line) in
`watch.js`'s closure state; when the new frame has fewer lines, after
writing it, emit `cols`-width blank lines for the difference (each preceded
by an explicit cursor position — `\x1b[<row>;1H` — rather than relying on
line-feed sequencing, so this is correct regardless of what the last content
line's own newline behaviour is).

**Alternative considered:** `\x1b[J` (erase from cursor to end of screen)
issued once, right after the last content line, instead of padding trailing
rows by hand. Rejected: `\x1b[J` is exactly the same class of "erase, don't
overwrite" operation as `\x1b[2J`, just scoped to the tail instead of the
whole screen — it reintroduces a blank window for exactly the rows it
touches, which for a frame that shrinks by only a line or two (a common
case: an escalation notice or drilldown notice appearing/disappearing) is
most of the visible change on that tick. Explicit blank-line overwrite has no
such gap.

### 3. Alternate screen buffer entered once, exited on every path

Write `\x1b[?1049h` once, immediately after `session.ensure()` and before the
first `draw()`, and `\x1b[?1049l` exactly once per dashboard lifetime, from
inside the existing single `quit()` function — the one place `watch.js`
already funnels every non-attach exit through (`q`/Ctrl-C via `router`'s
`'quit'` action, `stdin.on('end', quit)`, `stdin.on('close', quit)`). No new
exit path is introduced; this reuses the existing seam.

**`quit()`'s existing `clear()` call must be removed, not left in place.**
`quit()` today calls `clear()` (`\x1b[2J\x1b[H`) as its last screen-writing
step before resolving. Once `\x1b[?1049l` is added, that pre-existing
`clear()` call must be deleted from `quit()` entirely — the two must not
coexist. Reasoning: exiting the alternate buffer already restores whatever
the primary buffer held before the dashboard started (that is what makes it
"restore the terminal as it was" — the ticket's own phrasing); the ordering
that would otherwise seem plausible, `\x1b[?1049l` followed by the old
`\x1b[2J\x1b[H`, would erase the user's own just-restored primary-buffer
content immediately after restoring it, silently defeating the entire point
of Decision 3. There is also no ordering where keeping `clear()` is correct:
issuing it *before* `\x1b[?1049l` clears a buffer that is about to be
discarded anyway (harmless but pointless), and *after* is actively harmful
as above — so the only sound outcome is deletion. The full revised `quit()`
sequence is: stop the poll timer, restore raw mode, write `\x1b[?1049l`
(replacing the old `clear()` call at that exact call site), print any
queue-remaining notice, resolve.

For a throwing `attach`: the existing `try/finally` in `doAttach()` already
exists "for exactly this reason" per its own comment (restoring raw mode).
Extend the same `finally` to restore the alternate-buffer state — see
Decision 4.

**Alternative considered:** enter/exit the alternate buffer around every
`draw()` call instead of once per session. Rejected — `\x1b[?1049h` on an
already-alternate buffer is a no-op on every terminal tested but there is no
standard guaranteeing it, and doing it once matches how every other
full-screen TUI (vim, less, htop) uses the pair: entry marks "I am now
managing the whole screen," not "here is one frame."

### 4. `attach` must suspend and restore the alternate buffer around tmux

`session.attach()` hands the terminal to `tmux attach` via
`stdio: 'inherit'`. tmux itself manages the terminal's screen-buffer state
for the pane it takes over (this is exactly how tmux implements its own
scrollback/copy-mode over ssh — it does not expect to inherit an
already-alternate-buffer terminal from its parent, and layering a second
`?1049h` outside tmux's own would leave the *dashboard's* saved primary
screen holding what should have been the *user's* pre-dashboard content,
corrupting the restore on both `attach`'s return and the dashboard's own
final exit). So `doAttach()` must exit the alternate buffer
(`\x1b[?1049l`) before calling `session.attach()`, and re-enter it
(`\x1b[?1049h`) in the same `finally` that already restores raw mode — on
both the success path and the exception path, matching the existing
comment: *"If attach throws we must still hand the terminal back."*

This is the direct implementation of the ticket's explicit acceptance
criterion: *"including after `attach` hands the terminal to tmux and takes
it back."*

**Sequencing within `doAttach()`:**
```
exit alternate buffer  (\x1b[?1049l)
running = false
stdin raw mode off, pause
try { session.attach(ticket) }
finally {
  enter alternate buffer  (\x1b[?1049h)
  stdin raw mode on, resume
  running = true
}
```
The order of "leave alt buffer" relative to raw-mode-off does not matter functionally (tmux does not read stdin in raw-vs-cooked-sensitive ways during the handoff), but doing it first keeps the "give tmux a clean primary-buffer terminal" step visually and logically first in the function, matching intent.

### 5. Resize: track dimensions, redraw on `SIGWINCH` immediately

Add a `process.stdout.on('resize', ...)` listener (Node re-emits this on
`SIGWINCH`) that calls the same `draw()` used by the poll timer, rather than
waiting up to 1000 ms for the next scheduled tick. Because `draw()` already
reads `process.stdout.columns`/`.rows` fresh on every call (see Decision 1 —
padding uses `cols` read at write time, not cached), no separate dimension
tracking is needed beyond what padding already requires; the resize listener
just triggers an out-of-band `draw()` call. This also naturally fixes stale
trailing rows post-shrink (Decision 2 already handles a frame that is
shorter than its predecessor, which is exactly what a window getting shorter
produces).

`clearInterval`/re-arming the poll timer is not needed — the resize listener
adds one extra `draw()` call between two regularly-scheduled ones; `draw()`
is idempotent and cheap (this is exactly the property the 1 Hz poll already
relies on).

**Risk considered:** a burst of resize events (dragging a terminal window
edge fires many `SIGWINCH`s per second) could make `draw()` run much faster
than 1 Hz. `draw()`'s cost is dominated by `session.listWindows()` (a tmux
subprocess call) and string formatting — cheap enough (used to run at 1 Hz
already) that no debounce is added; if this proves measurably expensive in
practice it is a follow-up, not a blocker for this ticket's acceptance
criteria ("resizing mid-run still reflows rather than corrupting").

## Risks / Trade-offs

- **[Risk]** A terminal that does not support `\x1b[?1049h/l` (rare, but
  some minimal terminals) would see the sequence as unrecognized bytes,
  typically silently ignored by real terminal emulators → **Mitigation**:
  this is the same escape pair every full-screen TUI already assumes
  supported (vim, tmux itself, less -X); no additional feature-detection is
  in scope, consistent with how the rest of `watch.js` already assumes ANSI
  cursor/SGR support unconditionally.
- **[Risk]** Forgetting to pair enter/exit on some exit path silently leaves
  a user's terminal stuck on the alternate buffer after the dashboard exits
  → **Mitigation**: exactly one exit function (`quit()`) and exactly one
  attach-wrapping function (`doAttach()`'s `finally`) own the pair; the test
  suite added by this change asserts they are textually paired rather than
  relying on manual review.
- **[Trade-off]** Blanking trailing rows by hand (Decision 2) instead of
  `\x1b[J` is a few more bytes emitted per shrinking frame → accepted; the
  byte cost is irrelevant at 1 Hz and the correctness gain (no blank window)
  is exactly what this ticket is about.
- **[Risk]** An implementer could add the new `\x1b[?1049l`/`\x1b[?1049h`
  writes without removing `quit()`'s pre-existing `clear()` call, or could
  pad by raw `.length` instead of `format.js`'s visible-width `padTo` — both
  would compile, look plausible, and pass a naive non-TTY test, while
  silently reintroducing the bug this change exists to fix (see Decisions 1
  and 3 above, and the accompanying task/spec items) → **Mitigation**: both
  are called out explicitly as required, code-grounded steps in Decisions 1
  and 3 (not left implicit), and Tasks 1.2/2.2/5.1 name the exact call sites
  and utilities involved so the checklist itself catches an implementation
  that skips either step.

## Migration Plan

No data migration. This is a behavioural change confined to one file
(`lib/ui/watch.js`) with no persisted state, config schema, or external
interface change. Rollback is a plain revert.

## Open Questions

None — the ticket's three approaches and acceptance criteria fully determine
the design; the one deliberate scope decision (deferring approach 3,
differential rendering) is justified in Non-Goals above.
