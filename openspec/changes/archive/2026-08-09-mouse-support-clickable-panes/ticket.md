# CON-112: Mouse support: clickable panes and text-entry fields

## Description

No mouse handling exists anywhere in the dashboard today — `lib/ui/frame.js` is a raw ANSI diffing renderer with no retained layout tree to hit-test against, and there is no SGR mouse-mode input parsing on the stdin side. Every interaction (row selection, panel focus, text entry) is keyboard-only.

## Proposed

Enable mouse-reporting mode (`\x1b[?1000h` plus `\x1b[?1006h` for SGR extended coordinates) on entering the dashboard's raw-mode input, parse click events off stdin alongside existing keypress parsing, and have each screen's render pass record enough of its own layout (pane/row bounding boxes) that a click coordinate can be mapped back to "which row/field was that" and dispatched through the same handlers the equivalent keypress already uses (never a second, parallel action path).

## Design decisions to escalate

* **Scope for a first pass.** This is the largest architectural item on the TUI roadmap — no existing screen tracks its own rendered bounding boxes today. Recommend prototyping on a single screen (the fleet view's row list, or one text-input prompt) before committing to a fleet-wide hit-test layer. Needs a decision on which screen goes first and what "done" looks like for a first pass vs. full rollout.
* Text-entry click behavior — does a click just focus the field (cursor still keyboard-driven), or does it also position the text cursor at the clicked character? The latter needs per-character width accounting through `format.js`'s ANSI-aware string handling.
* Terminal/tmux compatibility — mouse reporting has to coexist with tmux's own mouse mode (`tmux attach` sessions) without one swallowing the other's events; needs verification across the terminals this project already targets.

## Acceptance criteria

* At least one screen (scope decided per the escalation above) supports clicking to select/focus, dispatched through the same action handlers as the equivalent keyboard path.
* Mouse mode is enabled/disabled cleanly on dashboard entry/exit — no leaked terminal mouse-reporting state after `q` or a crash.
* Documented in `docs/dashboard.md`.
