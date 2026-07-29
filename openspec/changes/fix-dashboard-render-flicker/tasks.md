## 1. Steady-state redraw: stop clearing, pad to width

- [x] 1.1 Replace `clear()`'s `\x1b[2J\x1b[H` with a cursor-home-only write (`\x1b[H`) used by the steady-state `draw()` path.
- [x] 1.2 Pad every line of the string `router.render()` returns to `process.stdout.columns` **visible columns** before writing it, by reusing `lib/ui/format.js`'s existing `padTo(line, cols)` (do NOT pad by raw `.length` — outer-frame lines carry ANSI SGR escapes from `f.bold`/`f.dim`/etc., and `padTo` is already the codebase's established visible-width-aware utility for this). Import `format.js` into `watch.js`; split the rendered string on `\n`, map each line through `padTo`, rejoin.
- [x] 1.3 Track the previous frame's line count in `watch.js`'s closure state (counted from the same split-on-`\n` array used for padding, so it agrees with 1.2 on whether the trailing newline `draw()` appends counts as a line); when the new frame has fewer lines, blank the leftover trailing rows (space-padded, explicit cursor-positioned) in the same write.

## 2. Alternate screen buffer

- [x] 2.1 Write `\x1b[?1049h` once, after `session.ensure()` and before the first `draw()` call.
- [x] 2.2 Write `\x1b[?1049l` exactly once from inside the existing `quit()` function, covering all three paths that already funnel through it (`q`/Ctrl-C via the router's `'quit'` action, `stdin.on('end', quit)`, `stdin.on('close', quit)`). **Remove `quit()`'s pre-existing `clear()` call (`\x1b[2J\x1b[H`) entirely** — it must not coexist with the new `\x1b[?1049l` write; leaving it in place would erase the user's just-restored primary-buffer content immediately after restoring it.

## 3. Attach suspends/restores the alternate buffer

- [x] 3.1 In `doAttach()`, write `\x1b[?1049l` before calling `session.attach(ticket)`.
- [x] 3.2 In the existing `try/finally` around `session.attach(ticket)`, write `\x1b[?1049h` in the `finally` block (alongside the existing raw-mode restore), so it fires on both the normal return and a throw.

## 4. Resize handling

- [x] 4.1 Add a `process.stdout.on('resize', ...)` listener that calls the same `draw()` used by the poll timer, so a `SIGWINCH` triggers an immediate redraw instead of waiting for the next scheduled tick.
- [x] 4.2 Confirm `draw()` already reads `process.stdout.columns`/`.rows` fresh on each call (no cached dimensions to invalidate) — no additional wiring needed beyond the listener itself.

## 5. Tests

- [x] 5.1 Add test coverage (e.g. `test/watch.test.js` or extend `test/scripts/watch-smoke.test.sh`) asserting `\x1b[2J` is never emitted anywhere in the dashboard's lifetime — both the steady-state `draw()` path AND `quit()`'s shutdown path (not just the former; a test that only covers `draw()` would not have caught `quit()`'s pre-existing `clear()` call surviving alongside the new alternate-buffer exit).
- [x] 5.1a Add a test that runs padding with a coloured (ANSI-wrapped) input line and asserts the padded output's *visible* width equals `cols` (using `format.js`'s own `visibleLength` to check, or an equivalent strip-then-measure) — a raw-`.length`-based regression would pass a naive plain-string test but fail this one.
- [x] 5.2 Add test coverage asserting `\x1b[?1049h`/`\x1b[?1049l` are paired: exactly one enter at startup, exactly one exit per exit path (quit, Ctrl-C/SIGINT-equivalent, stdin end, stdin close), and an enter/exit pair around a successful `attach` and around a throwing `attach`.
- [x] 5.3 Add test coverage asserting a shrinking frame's leftover trailing rows are blanked (no stale content left below the new frame's last line).
- [x] 5.4 Run the full test suite and existing `test/scripts/watch-smoke.test.sh` to confirm no regression in existing dashboard behavior.

## 6. Verification gates

- [x] 6.1 Run project lint/test gates per `AGENTS.md`/repo conventions and confirm they pass.
- [x] 6.2 Manually sanity-check (or document why not feasible in this environment) that `concertino watch` no longer visibly flickers and that quitting restores the terminal/scrollback correctly.
