# Files Modified

- `lib/ui/watch.js` — Strip exactly one trailing `'\n'` from `text` in `buildFrame()` before splitting into lines, so the resulting line count and written rows exclude the phantom empty trailing element produced by `String.split('\n')` on trailing-newline-terminated input.
- `test/watch.test.js` — Add regression test verifying that `buildFrame()` does not count or write a phantom trailing blank row for a trailing-newline-terminated input (router.render()-shaped), and that the line count reflects only the actual rendered content.
