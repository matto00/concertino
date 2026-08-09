## 1. Regression test

- [x] 1.1 Add a regression test in `test/ticket-provider.test.js` that calls
      `kindFor`/`moduleFor` with `kind` values of `constructor`, `toString`,
      `hasOwnProperty`, and `__proto__`, asserting each is treated as an
      unknown kind (not resolved to an inherited `Object.prototype` member).
- [x] 1.2 Run the full test suite and confirm it passes.
