# CON-26: Trim phantom trailing blank row in dashboard's per-poll redraw

## Description

Follow-up from CON-17 ("Every dashboard screen flickers on each render"), noted independently by both the evaluator and the final skeptic during that ticket's review as a non-blocking observation, not required for CON-17's acceptance criteria.

In `lib/ui/watch.js`, `draw()` calls `router.render(...)` and appends a trailing `'\n'` to the result before passing it into the frame builder (`buildFrame`, added by CON-17) that pads/writes each line and tracks the previous frame's line count for shrink cleanup.

Because the string passed to `buildFrame` ends in `'\n'`, splitting on `'\n'` produces one extra empty trailing element after the last real content line. That empty element is treated as a real row: it gets padded to the terminal's column width and written, producing one harmless but pointless fully-blank row at the bottom of every rendered frame — a "phantom" row that isn't part of the actual rendered content.

## Acceptance Criteria

- `draw()`/`buildFrame()` in `lib/ui/watch.js` do not count or write a trailing empty row that only exists because of the appended `'\n'`. The frame written to the terminal contains exactly the rendered content's rows, with no extra blank row appended.
- Self-contained to `lib/ui/watch.js` (the `draw()`/`buildFrame()` call site) — no changes to `lib/ui/router.js` or any `lib/ui/screens/*` module.
- `test/watch.test.js`'s regression coverage asserts the line count / written rows for a `router.render()`-shaped input (with its trailing newline) does not include an extra blank row beyond the actual content.
