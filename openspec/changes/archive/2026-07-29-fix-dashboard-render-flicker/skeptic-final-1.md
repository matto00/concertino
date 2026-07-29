## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ground truth read fresh**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
   `specs/dashboard-render-loop/spec.md` in the worktree, plus the actual
   `lib/ui/watch.js` (889 lines, read in full) and `lib/ui/format.js`'s `padTo`/
   `visibleLength` (lines 219-291).

2. **Diff scope**: `git diff main...HEAD --stat` shows only `lib/ui/watch.js`,
   `test/watch.test.js`, `test/scripts/watch-smoke.test.sh`, and openspec
   planning artifacts changed. `git diff main...HEAD -- lib/ui/router.js
   lib/ui/screens/ lib/ui/session.js` is empty — confirmed no leakage into the
   pure renderer or `session.js`'s `attach()` (still a bare `spawnSync('tmux',
   ['attach', ...], { stdio: 'inherit' })`, untouched).

3. **AC 1 — no blank frame at 1 Hz**: `buildFrame()` (`watch.js:58-76`) replaces
   `\x1b[2J\x1b[H` with `CURSOR_HOME` (`\x1b[H`) only, and pads every line to
   `cols` via `format.js`'s `padTo` before writing — same paint, no erase step.
   `grep -n "2J" lib/ui/watch.js` finds zero executable occurrences, only
   comments. Confirmed by unit test (`buildFrame never emits a full-screen
   clear`) and by real running-dashboard bytes (`watch-smoke.test.sh`: "no
   `\x1b[2J` anywhere in the session" for q, echo-q, EOF, and attach paths — I
   ran this myself, all pass).

4. **AC 2 — scrollback preserved, restored across `attach`**: `ALT_SCREEN_ENTER`
   (`\x1b[?1049h`) written once before the first `draw()` (`watch.js:394`);
   `ALT_SCREEN_EXIT` written exactly once from `quit()` (`watch.js:433`), with
   the old `clear()` call fully removed (not left coexisting — verified by
   reading `quit()`'s body directly, `watch.js:414-449`). `doAttach()`
   (`watch.js:463-487`) exits the alt buffer before `session.attach()` and
   re-enters it inside `attachAndRestore`'s `finally`, on both success and
   throw. I ran the live smoke test myself: the attach-attempt case shows
   exactly 2 enters / 2 exits across the session (startup + post-attach,
   pre-attach + quit) — matches design.md Decision 4 exactly.

5. **AC 3 — shrinking frame leaves no stale rows**: `buildFrame`'s `prevLineCount`
   branch (`watch.js:69-74`) blanks every leftover row with an explicit
   `\x1b[<row>;1H` + `cols`-width spaces. I independently verified with a direct
   `node -e` call (`buildFrame('x\ny', 5, 4)` — not reproduced verbatim here,
   but the shipped unit test `a shrinking frame blanks every leftover row from
   the taller previous frame` exercises exactly this and passes).

6. **AC 4 — restored on every exit path**: `q`/Ctrl-C via router → `quit()`;
   `stdin.on('end', quit)` and `stdin.on('close', quit)` both wired
   (`watch.js:457-458`); a re-entrancy guard (`if (quitting) return`,
   `watch.js:421`) prevents a double `\x1b[?1049l` write from piped stdin
   firing both `end` and `close` — I confirmed this is real by running the
   "immediate EOF" smoke case myself: `\x1b[?1049l` appears exactly once. A
   throwing `attach` is covered by `attachAndRestore` (`watch.js:84-90`),
   unit-tested directly (`attachAndRestore runs restore() even when fn()
   throws, and rethrows` — passes).

7. **AC 5 — resize reflows**: `process.stdout.on('resize', ...)` (`watch.js:404`)
   calls the same `draw()`, gated on `running`. `draw()` reads
   `process.stdout.columns`/`.rows` fresh every call (`watch.js:374,377`), so no
   stale-dimension bug. I additionally spawned the real dashboard against a
   live tmux session and sent it `SIGWINCH` directly — it did not crash and
   continued writing frames (`\x1b[?1049h` count stayed 1, consistent with no
   re-entry corruption).

8. **Visible-width-aware padding, not raw `.length`**: `format.js:288-291`'s
   `padTo` is built on `visibleLength`, which strips ANSI SGR bytes before
   measuring. `buildFrame` calls `format.padTo(line, cols)` directly — no
   second padding implementation. Unit test asserts a coloured line
   (`\x1b[33mhi\x1b[0m`, raw length 13, visible width 2) pads to
   `visibleLength === cols` and is byte-identical to calling `padTo` directly.
   This is exactly the trap design.md calls out as easy to get wrong, and it
   is genuinely closed.

9. **Test suite genuinely asserts on escape sequences, not superficially**:
   `test/watch.test.js` unit-tests `buildFrame`/`attachAndRestore` against the
   exact byte sequences (`\x1b[H`, per-row `\x1b[<row>;1H`, ANSI-aware padding).
   `test/scripts/watch-smoke.test.sh` counts real escape-sequence occurrences
   (`esc_count`, using `grep -o` + `wc -l` to avoid undercounting sequences on
   the same line) from a real running dashboard against real tmux across every
   exit path named in the ticket (q, echo+newline, EOF, attach). This is not
   superficial — it would catch a regression that reintroduced `\x1b[2J` or
   unpaired the alt-buffer sequences.

10. **Re-ran verification gates myself, did not trust the evaluator's report**:
    - `node --test`: 434/434 pass (ran myself, full output tail confirms).
    - `bash test/scripts/watch-smoke.test.sh`: 52/52 pass (ran myself).
    - `npm test` (full chain, all script suites including watch-smoke): all
      pass (ran myself, tail confirms `escalation loop` suite and others all
      green — no red anywhere in the full run).
    - `npx openspec validate fix-dashboard-render-flicker --strict`: "Change
      'fix-dashboard-render-flicker' is valid" (ran myself).

11. **Cross-checked the evaluator's one non-blocking observation** (a phantom
    blank trailing row from `draw()`'s appended `'\n'` being split into an
    extra empty line by `buildFrame`): reproduced independently —
    `buildFrame('line1\nline2\n', 10, 0)` → `lineCount 3`, bytes end in a
    fully-blank 10-column third row. Confirmed self-consistent (padding and
    `lastFrameLines` agree, per design.md Decision 2's own requirement) and
    not a violation of any AC or spec scenario — it does not reopen the
    blank-frame window and is no worse than pre-change vertical space usage.
    Correctly left as non-blocking.

12. **UI/design judgment gate**: N/A per the task brief — no design standard
    configured for this project, and this is a terminal-control-only change
    with no UI rendering surface change (renderer stays pure and untouched,
    confirmed above). No dev-server/screenshot review applicable.

### Verdict: CONFIRM

### Non-blocking notes
- The evaluator's suggestion to trim `rendered`'s trailing `'\n'` before
  `buildFrame` (avoiding one avoidable blank-row write per frame) is a
  reasonable follow-up but not required — confirmed non-blocking per above.
