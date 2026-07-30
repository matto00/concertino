## Why

`lib/ui/watch.js`'s `draw()` appends a trailing `'\n'` to `router.render(...)`'s output before handing it to `buildFrame()`. `buildFrame()` splits on `'\n'`, so that trailing newline produces one extra empty trailing element, which gets padded to terminal width and written as a real row — a pointless fully-blank row at the bottom of every rendered frame. Noted as a non-blocking cosmetic follow-up during CON-17's review.

## What Changes

- `buildFrame()` (or its caller) excludes the trailing empty element produced by the appended `'\n'` from both the line count and the written rows.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dashboard-render-loop`: document that a redrawn frame's line count/written rows reflect only the rendered content, excluding any trailing empty line produced by a trailing newline in the input string.

## Impact

- `lib/ui/watch.js` (`buildFrame()`/`draw()`)
- `test/watch.test.js` (new assertion)
