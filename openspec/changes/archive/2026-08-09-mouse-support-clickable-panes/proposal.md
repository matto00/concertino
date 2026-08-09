## Why

Every dashboard interaction today is keyboard-only — `lib/ui/frame.js` has no retained layout tree to hit-test against, and there is no SGR mouse-mode input parsing on the stdin side. A user attached over a terminal that supports mouse reporting has no way to click a row to select it. This change adds a first, deliberately narrow, mouse-click capability, scoped per an explicit human decision (recorded below) to avoid committing to a fleet-wide hit-test layer before validating the pattern on one screen.

## What Changes

- Enable SGR mouse-reporting mode (`\x1b[?1000h` + `\x1b[?1006h`) when the dashboard enters raw-mode input, and cleanly disable it (`\x1b[?1000l` + `\x1b[?1006l`) on every exit path (`q`, Ctrl-C, crash/uncaught-exception, suspend-for-attach) — mirroring the existing textually-paired guarantee `ALT_SCREEN_ENTER`/`ALT_SCREEN_EXIT` already establish in `lib/ui/frame.js`.
- Parse SGR mouse click sequences (`\x1b[<Cb;Cx;CyM` / `...m`) off stdin, alongside the existing `splitKeys` keypress parsing, recognizing a left-button press event.
- Scope decision (escalated to and resolved by the ticket owner): first pass targets the **fleet view's row list only** (`lib/ui/screens/fleet/`) — not any text-entry field. A click on a run row selects that row, dispatched through the same `jump` action (`lib/ui/controllers/fleet.js`'s existing absolute-target selection, shared with CON-39's digit-jump) the equivalent keyboard path already uses — never a second, parallel selection path.
- The fleet renderer's row-rendering pass (`lib/ui/screens/fleet/rows.js` / `render.js`) records each rendered run row's terminal-row bounding box for the current frame, so a click's `(row, col)` can be mapped back to a `runs[]` index.
- Text-entry click-to-position-cursor is explicitly **out of scope** for this pass (decided: click would only focus, never reposition the text cursor, if/when text-entry click support is added) — recorded here for a future follow-up, not implemented now.
- tmux mouse-mode interaction (verifying `\x1b[?1000h`/`\x1b[?1006h` survive a `tmux attach` pass-through without tmux swallowing the events) is explicitly deferred to a follow-up ticket, per the scope decision — this pass targets the common case (no active tmux mouse-mode conflict) and documents the deferral rather than blocking on cross-terminal verification now.
- Documents the new mouse-click behavior, its current single-screen scope, and the tmux-compatibility caveat in `docs/dashboard.md`.

## Capabilities

### New Capabilities

- `fleet-row-mouse-select`: SGR mouse-reporting lifecycle (enable on raw-mode entry, disable on every exit path) and click-to-select-row behavior on the fleet view's run list, dispatched through the existing keyboard selection action.

### Modified Capabilities

(none — no existing capability's requirements change; this adds a new capability alongside them)

## Impact

- `lib/ui/watch.js`: raw-mode entry/exit sites (mouse-reporting enable/disable, paired with the existing `setRawMode`/alt-screen lifecycle), stdin `data` handler (parse mouse sequences alongside `splitKeys`).
- `lib/ui/frame.js`: new named mouse-mode escape-sequence constants and a mouse-sequence parser, following the existing `ALT_SCREEN_ENTER`/`CURSOR_HIDE`-style named-constant precedent.
- `lib/ui/screens/fleet/render.js`, `lib/ui/screens/fleet/rows.js`: record each rendered row's terminal-row bounding box for the current frame.
- `lib/ui/router.js`: no interface change — mouse-derived actions flow through the same `handleKey`-produced action objects screens already return.
- `lib/ui/controllers/fleet.js`: no new action type — a click resolves to the existing `jump` action.
- `docs/dashboard.md`: document the new click-to-select behavior, its current fleet-row-only scope, and the tmux-compatibility deferral.
- No external dependencies added.
