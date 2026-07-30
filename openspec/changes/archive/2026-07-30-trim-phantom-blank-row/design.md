## Context

`buildFrame(text, cols, prevLineCount)` (`lib/ui/watch.js:111`) does `text.split('\n').map(...)`. Its caller, `draw()`, builds `text` as `(bannerText ? bannerText + '\n' : '') + screenText + '\n'` — always trailing-newline-terminated. `"a\nb\n".split('\n')` is `["a", "b", ""]`: the trailing empty string is an artifact of `String.split`, not a real content line.

## Goals / Non-Goals

**Goals:**
- The written frame's row count matches the actual rendered content, with no extra blank row from the trailing newline.

**Non-Goals:**
- Changing `router.render()` or any screen module's own output (they don't control the trailing newline; `draw()` appends it).
- Changing the shrink-cleanup behavior for a frame that legitimately shrinks between polls (CON-17's own concern) — this only removes the one artifact row that was never real content.

## Decisions

- Strip exactly one trailing `'\n'` from `text` before splitting in `buildFrame()` (e.g. `text.replace(/\n$/, '')`), rather than changing `draw()`'s construction of `text` — keeps the fix localized to the one function that already owns line-splitting/counting, and preserves `draw()`'s existing, readable trailing-newline convention for building `text`.

## Risks / Trade-offs

- None of note — this only removes a row that was never real rendered content; every existing shrink-cleanup and padding behavior for genuine content rows is unchanged.
