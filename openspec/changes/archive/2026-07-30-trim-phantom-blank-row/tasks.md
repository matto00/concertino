## 1. Implementation

- [x] 1.1 In `lib/ui/watch.js`'s `buildFrame()`, strip exactly one trailing `'\n'` from `text` before splitting into lines, so the resulting line count/written rows exclude the phantom empty trailing element.

## 2. Tests

- [x] 2.1 Add an assertion to `test/watch.test.js` covering a `router.render()`-shaped, trailing-newline-terminated input: the written row count / content must not include an extra blank row beyond the actual rendered content.
