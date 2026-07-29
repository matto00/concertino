## Why

`lib/ui/watch.js` clears the whole screen (`\x1b[2J\x1b[H`) and rewrites it from scratch on every 1 Hz poll, so there is a visible blank frame between the clear and the repaint on every single tick. This reads as flicker on every dashboard screen, is worse since the bordered-pane redesign (CON-12) gave the eye a stable structure to notice disappearing, and it also tramples the user's terminal scrollback since the dashboard never uses the alternate screen buffer. This needs fixing now — it was reported directly from real use as something that "has to be addressed."

## What Changes

- Replace the full-screen clear (`\x1b[2J\x1b[H`) in the steady-state poll loop with cursor-home + overwrite, padding every line to the terminal width so stale content is covered rather than erased through a blank gap.
- Pad (or blank) out any trailing rows left over when the new frame is shorter than the previous one, so a shrinking frame never leaves stale rows on screen.
- Enter the alternate screen buffer (`\x1b[?1049h`) once on dashboard startup and leave it (`\x1b[?1049l`) once on every exit path — normal quit (`q`), Ctrl-C, piped EOF/close, and a throwing `attach` — reusing the existing `try/finally` around `session.attach()` for the last case, and the existing single `quit()` function for the first three.
- Suspend the alternate-screen state around `attach`: tmux needs the raw primary/alternate screen handling for the pane it takes over, so `attach` must not leave the dashboard's own alternate-screen buffer active underneath it, and must restore it correctly when tmux hands the terminal back (including if `session.attach()` throws).
- Track the terminal's row/col dimensions so a `SIGWINCH` mid-run triggers a redraw against the new size, rather than only reacting to a resize on the next scheduled poll tick — with the padding/overwrite discipline above, a resize must not corrupt the frame either.
- No changes to any screen module (`lib/ui/screens/*`) or to `lib/ui/router.js` — the renderer stays pure and returns a string exactly as it does today; every change here is confined to how `watch.js` writes that string to the terminal.

## Capabilities

### New Capabilities
- `dashboard-render-loop`: the terminal-control contract for `lib/ui/watch.js`'s poll loop — no full-screen clear in steady state, alternate-screen buffer entry/exit paired on every exit path (including a throwing `attach`), stale-row cleanup when a frame shrinks, and resize handling — independent of what any individual screen renders.

### Modified Capabilities
(none — `dashboard-visual-design` governs what a frame contains; this change only governs how that frame reaches the terminal, which is a new capability)

## Impact

- **Code:** `lib/ui/watch.js` only (the `clear()` helper, the `draw()` steady-state write, the `quit()`/`doAttach()` exit paths, and the poll/resize wiring). No changes to `lib/ui/router.js`, `lib/ui/reducer.js`, or any `lib/ui/screens/*` module — they remain pure string-returning functions.
- **Tests:** new `test/scripts` or `test/*.test.js` coverage asserting on the escape sequences `watch.js` emits (no `\x1b[2J` in the steady-state path; `\x1b[?1049h`/`\x1b[?1049l` paired across every exit path) rather than trying to observe the flicker itself, per the ticket's own note that flicker is a timing artefact, not a string property.
- **Users:** anyone running `concertino watch` — no more blank-frame flicker at the default 1 Hz poll, and the dashboard no longer destroys terminal scrollback on entry or leaves the terminal in the wrong screen buffer on exit.
