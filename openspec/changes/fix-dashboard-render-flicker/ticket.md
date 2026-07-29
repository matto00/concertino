# CON-17: Every dashboard screen flickers on each render

**Priority:** High
**URL:** https://linear.app/helioapp/issue/CON-17/every-dashboard-screen-flickers-on-each-render

## Description

`lib/ui/watch.js` clears the whole screen with `\x1b[2J\x1b[H` and rewrites it from scratch on every poll — once per second. The terminal therefore shows a blank frame between the clear and the repaint, which reads as a flicker on every screen.

Reported from real use: *"every screen flickers on render, this has to be addressed."*

It is worse now than before the visual redesign, because bordered panes give the eye a stable structure to notice disappearing.

## Approaches, roughly in increasing order of effort

1. **Stop clearing.** Move the cursor home and overwrite, padding each line to the terminal width so stale content is covered rather than erased. Cheapest fix; removes the blank frame entirely. Needs care where the new frame is shorter than the old one.
2. **Alternate screen buffer** (`\x1b[?1049h` / `l`) on entry and exit. Standard for full-screen TUIs, and it also stops the dashboard from trampling the user's scrollback — which it currently does. Worth doing regardless of the flicker fix.
3. **Differential rendering.** Keep the previous frame, diff line by line, and only rewrite changed lines. Most work, best result, and it makes the 1 Hz poll essentially free.

(1) and (2) together are probably the right first move; (3) is a follow-up if the poll ever gets more expensive.

## Acceptance criteria

* No blank frame between repaints at the default 1 Hz poll.
* Entering the dashboard does not destroy the user's scrollback, and quitting restores the terminal as it was — including after `attach` hands the terminal to tmux and takes it back.
* A frame shorter than its predecessor leaves no stale rows behind.
* Terminal state is restored on every exit path, including `q`, Ctrl-C, EOF, and a throwing `attach` — there is already a `try/finally` around attach for exactly this reason.
* Resizing mid-run still reflows rather than corrupting.

## Notes

The renderer is pure and returns a string, so all of this belongs in `watch.js` and none of it should leak into the screens. That separation is what makes the change safe.

Test coverage is awkward — flicker is a timing artefact, not a string property. Assert on the escape sequences `watch.js` emits (no `\x1b[2J` in the steady-state path, alternate-buffer enter/exit paired) rather than trying to observe the flicker itself.
