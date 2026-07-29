## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All five ticket ACs addressed explicitly and each maps to a spec requirement/scenario and a design decision: no blank frame (Decision 1: `\x1b[H` + `padTo`-based overwrite), scrollback preserved + attach round-trip (Decisions 3-4: alt-screen enter/exit + suspend-restore around `session.attach`), shrinking frame leaves no stale rows (Decision 2: trailing-row blanking), terminal restored on every exit path incl. throwing `attach` (Decision 3 `quit()`, Decision 4 `attachAndRestore`'s `finally`), resize reflow (Decision 5: `resize` listener calling the same `draw()`).
- No AC silently reinterpreted — verified each spec scenario in `specs/dashboard-render-loop/spec.md` against the actual code and tests, not just the design doc's claims.
- All 20 items in `tasks.md` are marked done and each corresponds to a concrete, verifiable code/test change (checked line-by-line against the diff).
- No scope creep: diff touches only `lib/ui/watch.js`, `test/watch.test.js`, `test/scripts/watch-smoke.test.sh`, and the planning/openspec artifacts. `git diff main...HEAD --stat -- lib/ui/router.js lib/ui/screens/` is empty — the explicit non-goal (renderer stays pure, no leakage into router/screens) holds.
- No regressions: full `node --test` suite (434 tests) and the full `npm test` chain including `test/scripts/watch-smoke.test.sh` (52 checks) all pass.
- No API/schema surface — N/A, this is a terminal-control-only change.
- Planning artifacts (`files-modified.md`, `design.md`) accurately reflect the final implementation; `openspec validate fix-dashboard-render-flicker --strict` passes.

### Phase 2: Code Review — PASS
Issues: none blocking. One non-blocking observation below.

- No canonical standards file is configured for this repo (confirmed no `AGENTS.md`, no lint config); reviewed against the design doc's own explicit requirements instead, which are effectively the mechanical rules for this change.
- **Trap 1 (visible-width-aware padding) — verified real, not just claimed.** `buildFrame` (`lib/ui/watch.js:59-77`) pads via `format.js`'s `padTo`, not raw `.length`. Confirmed `format.js:284-291`'s `padTo` is genuinely visible-column-aware (built on `visibleLength`/`truncate`, which strip/zero-width ANSI SGR escapes before measuring). Ran a direct check against a real ANSI-coloured line (`'\x1b[33mhi\x1b[0m'`, raw `.length` 13, visible width 2): `buildFrame` pads it to exactly `visibleLength(line) === cols`, and the padded output is byte-identical to calling `format.js`'s own `padTo` directly (`test/watch.test.js:37-46`, and re-verified independently via a manual `node -e` check during this review). No second padding implementation was written — `watch.js` is a pure consumer of the existing utility, matching design.md Decision 1 exactly.
- **Trap 2 (`quit()`'s old `clear()` removed; double-quit fix real) — verified real, not just claimed.** `grep -n "function clear\|\\x1b\[2J"` against `lib/ui/watch.js` finds zero executable occurrences of the old `clear()` function or a literal `\x1b[2J` — only comments explaining its removal. `quit()` (`watch.js:414-449`) writes `ALT_SCREEN_EXIT` (`\x1b[?1049l`) exactly once and no longer calls `clear()`. The double-quit fix is real: `quit()` starts with `if (quitting) return;` (`watch.js:421`) before setting `quitting = true`, and both `stdin.on('end', quit)` and `stdin.on('close', quit)` are wired (`watch.js:457-458`) — confirmed end-to-end against the real running dashboard via `test/scripts/watch-smoke.test.sh`'s "immediate EOF" case, which asserts `\x1b[?1049l` appears **exactly once** in that session's real captured bytes (this is the scenario that drives both `'end'` and `'close'`), and this assertion passes.
- No leakage into `lib/ui/router.js` or `lib/ui/screens/*` — confirmed via `git diff --stat`, empty.
- Alternate-buffer suspend/restore around `doAttach()`: exits before `session.attach()`, re-enters inside `attachAndRestore`'s `finally` on both the success path and a throw — verified by direct unit test (`attachAndRestore runs restore() even when fn() throws, and rethrows`) and by the smoke test's real-tmux attach-attempt case (2 enters / 2 exits across the session, since tmux fails fast against a non-tty and the pair still fires).
- Shrinking frame blanks trailing rows via explicit `\x1b[<row>;1H` + spaces per leftover row, not `\x1b[J` (matches design.md Decision 2's rejection of erase-based approaches) — unit-tested and the row/column math checked directly.
- Resize triggers an immediate redraw via `process.stdout.on('resize', ...)` calling the same `draw()`, gated on `running` for the same reason the poll timer is (correctly avoids drawing into a terminal tmux currently owns mid-attach).
- DRY: no duplicate padding/clearing logic; existing `padTo`, the existing single `quit()` seam, and the existing `try/finally` around `attach` are all reused rather than reimplemented, exactly as design.md requires.
- Readable/modular: `buildFrame` and `attachAndRestore` are extracted as small, pure, well-commented, independently testable units; escape sequences are named constants (`CURSOR_HOME`, `ALT_SCREEN_ENTER`, `ALT_SCREEN_EXIT`) rather than inlined magic strings.
- Error handling: `attachAndRestore` correctly rethrows after running `restore()`, matching the ticket's own stated reason for the pre-existing `try/finally`.
- Tests meaningful: unit tests exercise the exact failure modes the design's own risk section calls out (raw-length padding regression, missing trailing-row blank, un-paired alt-buffer enter/exit, attach-throws-without-restore) — each would catch a real regression, not just smoke-test presence. Smoke tests assert on real byte counts from a real running dashboard across every real exit path (q, echo+newline, EOF, attach-attempt), satisfying the ticket's own test-strategy note to assert on escape sequences rather than observing flicker directly.
- No dead code: old `clear()` fully removed; no leftover TODO/FIXME.
- No over-engineering: the two extracted helpers are minimal and directly motivated by testability, not premature abstraction.

**Non-blocking observation:** `draw()` passes `rendered` (which already has a trailing `'\n'` appended, `watch.js:~378`) into `buildFrame`, which `split('\n')`s it — producing a phantom final empty-string line that `padTo` turns into a full `cols`-width row of literal spaces, written to the terminal on every frame. Verified directly:
```
buildFrame("line1\nline2\n", 10, 0) → lineCount 3, bytes end in "line2     \n          " (a fully blank third row)
```
This is self-consistent (both the padding and the `lastFrameLines` count come from the same split array, exactly as design.md Decision 2 requires) and does not violate any spec scenario or cause stale-content leakage — if anything it makes the phantom row's contents explicit blanks rather than an untouched cursor position. It also consumes the same amount of vertical terminal space the pre-change code already consumed via its own trailing `'\n'`, so it is not a new regression. It is, however, one row of avoidable byte-writing on every single frame and a slightly non-obvious artifact of the calling convention; worth trimming (e.g. `rendered.replace(/\n$/, '')` before calling `buildFrame`, or having `buildFrame` drop a single trailing empty segment) in a follow-up, but it is not a defect against any stated acceptance criterion.

### Phase 3: UI Review — N/A
No UI review configured for this project (per task instructions); dev-server steps skipped.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `lib/ui/watch.js`: consider trimming the trailing `'\n'` from `rendered` before passing it to `buildFrame` (or having `buildFrame` ignore a single trailing empty split segment), to avoid writing one full `cols`-width blank row on every frame that exists only as an artifact of the string-building convention (`draw()` appends `'\n'` after `router.render()`'s output). Not a spec violation — self-consistent and no worse than pre-change behavior — but avoidable byte-writing and a slightly non-obvious artifact for a future reader.
