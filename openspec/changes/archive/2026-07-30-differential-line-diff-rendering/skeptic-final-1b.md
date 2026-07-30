## Skeptic Report — final gate (round 1, second independent skeptic)

Commit reviewed: `985abb1` (merge of `6a473c3` onto `aca8385`). I did not read
`skeptic-final-1.md`; every conclusion below is derived from the code, the spec
delta, and commands I ran myself.

### What I verified (with evidence)

**1. Ground truth of the diff.** `git diff main...HEAD --stat` — production scope is
exactly one file, `lib/ui/watch.js` (+200/−?), plus `test/watch.test.js`,
`test/scripts/watch-smoke.test.sh`, and openspec artifacts. `git diff --name-only
main...HEAD -- lib/` returns `lib/ui/watch.js` only, so the ticket's scope note
("`lib/ui/router.js` and every `lib/ui/screens/*` must stay untouched") holds.

**2. The configured gate, re-run fresh.** `concertino.config.json` declares one gate,
`npm test` (`when: always`).

```
$ npm test ; echo EXIT=$?
EXIT=0
$ node --test | tail -6
ℹ tests 755
ℹ pass 755
ℹ fail 0
ℹ cancelled 0 / skipped 0 / todo 0
```
All shell gates in the `&&` chain reported `N passed, 0 failed`. (The two `FAIL`
strings in the log are test *names* in persist-evidence.test.sh, not failures —
checked against the same control on a clean copy.)

**3. Main drift is inert.** `main` has moved to `ad2c7ca`. `git diff --name-only
aca8385..ad2c7ca` touches `core/scripts/*`, `scripts/concertino/*`,
`lib/ui/ticket-text.js`, `test/ticket-text.test.js`,
`test/scripts/persist-evidence.test.sh` and openspec — no overlap with
`lib/ui/watch.js`, `test/watch.test.js`, or `test/scripts/watch-smoke.test.sh`.
Independently confirms the evaluator's claim.

**4. Real-terminal equivalence (the check that matters for a rendering change).**
Neither the unit tests (pure `buildFrame`) nor the smoke gate (stdout redirected to
a file, so `process.stdout.rows` is unset) ever puts these escape sequences through
a terminal emulator. I built a baseline checkout in scratch with `git show
aca8385:lib/ui/watch.js` and drove BOTH versions inside real `tmux` panes,
comparing `tmux capture-pane -p` output — a genuine emulator's rendered screen.

Round 1 (100×40, 2 tickets): `initial`, `tick2`, `after 2×j`, rows-only shrink
40→32, regrow 32→40, attach round-trip, post-attach — **7/7 byte-identical.**

Round 2 (100×20, 12 tickets): `tall`, `steady`, `scrolled (5×j)`, `l details`,
`esc back`, `N launch pad`, `esc back`, grow 20→45, shrink 45→20, cols-only 100→80
— **10/10 byte-identical.**

**5. The ticket's actual goal, measured in real bytes.** `tmux pipe-pane` capturing
every byte the pane received over 6 s of steady state:
```
baseline (main's full rewrite): steady_bytes=21308
this branch (diff writer):      steady_bytes=0
```
Raw-stream escape census on the branch: `\x1b[H` × 0, `\x1b[<row>;1H` × 180 — the
full-rewrite prefix never appears, every write is per-row placed. Baseline: `\x1b[H`
× 36.

**6. The over-tall fallback, exercised directly in a real terminal.** The fleet
screen self-caps to the row budget, so no fixture I could build reached the
fallback. I drove `buildFrame` from both versions against a live 40×10 pane through
a 5-frame sequence (16-line over-tall → same again → 8-line fits → one row changed →
3-line shrink). All 5 rendered screens **identical**; the over-tall frame correctly
showed `TALL-6..TALL-15` (the terminal's own scroll), and the next frame diffed
correctly against the truncated tail (92 bytes vs baseline's 330, same screen).
Byte sizes: new `[658,658,507,92,414]` vs old `[658,658,705,330,355]`.

**7. Cursor-rest scenarios, measured.** `tmux display-message -p '#{cursor_x},#{cursor_y}'`:
baseline `100,8` / `100,8` / `100,8` at (initial, after `j`, after an idle tick);
branch `100,8` / `100,8` / `100,8`. The park write lands the cursor exactly where the
full rewrite already did, and an unchanged tick does not move it.

**8. CON-26's requirement survives.** `openspec/specs/dashboard-render-loop/spec.md:108`
("A trailing newline ... does not produce an extra written row") is a *separate*
requirement, untouched by this delta, and `buildFrame` still opens with
`text.replace(/\n$/, '')`. Removing that strip kills 2 tests (mutation run below).

**9. Mutation testing — I ran my own, on a scratch copy, against the full gate.**

| mutation | `node --test test/watch.test.js` | `npm test` |
| --- | --- | --- |
| cursor-park write removed | 7 fail | — |
| overflow tail-truncation removed | 2 fail | — |
| overflow condition disabled | 2 fail | — |
| CON-26 trailing-newline strip removed | 2 fail | — |
| diff loop writes every row unconditionally | 5 fail | — |
| shrink-blanking removed | 2 fail | — |
| **resize invalidation → `prevFrameLines = []`** | **0 fail (40 pass)** | **exit 0** |
| **resize invalidation removed entirely** | **0 fail (40 pass)** | **exit 0** |
| **attach `prevFrameLines = []` removed** | **0 fail (40 pass)** | **exit 0** |

`buildFrame`'s internals are well guarded (6/6 killed). The two *wiring* lines this
change added are not guarded at all (3/3 survived). Both surviving mutations were
re-run and reproduced identically.

**10. Both surviving mutations are load-bearing — proven live, not argued.**

*Attach reset removed* (`watch.js:920`), real tmux pane, press the attach key:
```
correct branch: non-blank rows after attach round-trip = 6   (fleet renders)
mutant:         non-blank rows after attach round-trip = 0   (BLANK dashboard)
```
Reproduced twice. The dashboard stays blank indefinitely, because after
`\x1b[?1049h` clears the buffer the stale cache makes every row diff as unchanged.

*Resize invalidation removed* (`watch.js:827`), real tmux pane, 12 tickets, grow
20→45 then shrink 45→20. 9 of 10 captured states matched the correct branch; the
post-shrink state was corrupted — rows interleaved from two different frames, the
header and top border gone, and **two selection markers** on screen:
```
│     CON-204 ...        │       ▸ CON-206 ...
│     CON-205 ...        │     CON-204 ...
│     CON-203 ...        │     CON-207 ...
│   ▸ CON-206 ...        │     CON-205 ...
```
`npm test` exits 0 with that mutation in place.

**11. Are these specified behaviors?** Yes — both are MODIFIED requirements in this
change's own spec delta (`specs/dashboard-render-loop/spec.md`), each with a
dedicated scenario: *"The first redraw after returning from attach rewrites every
row"* and *"A rows-only resize still triggers a full rewrite, not a partial diff"*.
Neither scenario has a test. `tasks.md` 3.9 is the only test task in this area and
it exercises the wrong seam — it hands `buildFrame` a hand-built `null`-filled array
and checks `buildFrame`'s handling of it, never that the resize listener *produces*
one. There is no task at all covering 2.3 (the attach reset). Task 3.9 describes the
resize behavior as "the regression design.md Decision 3 documents in detail and must
not recur"; as delivered, it would recur silently.

**12. The tests to write are cheap and the harness already exists.**
`test/watch.test.js:766` and `:876` already drive the real `watch()` loop with an
`EventEmitter` fake stdin, a monkeypatched `process.stdout.write` collecting chunks
into `written`, a faked `session` whose `attach()` returns `{ status: 0 }`, and the
new `screenOf(written)` replayer. The resize listener is registered on the real
`process.stdout`, so `process.stdout.emit('resize')` from a test fires it.

**13. Iron Laws.** `verification-before-completion.md` read and applied — every claim
above is a command I ran in this session. `systematic-debugging.md` is not engaged:
this is a feature/perf change, not a bug fix, so no root-cause probe is owed. (The
cycle-1→2 stale-branch breakage was a merge defect, and the executor's fix ported
`main`'s CON-26 tests and added `screenOf()`; I confirmed the CON-26 tests have teeth
via the strip mutation, and that the two CON-6 scroll tests have teeth via the
evaluator's documented scroll mutation, which I did not need to re-run because its
seam is unrelated to my findings.)

### Verdict: REFUTE

The implementation itself is, on every check I could devise, correct — 22 real-terminal
screen states byte-identical to `main`'s writer, identical cursor rest position, the
over-tall fallback preserved exactly, and the headline goal delivered (21,308 bytes →
0 bytes per 6 s of steady state). I found no functional defect.

What I will not sign off is the coverage. This change modified two spec requirements,
and the two lines that implement those modifications can both be deleted with the
full gate still green — one of them turning the product's primary UI **completely
blank**, the other corrupting it into an interleaved double-render. That is not a
theoretical gap: the reason this ticket needed a second execution cycle at all is
that an auto-merge silently reverted a *tested* line (CON-26's strip) and the tests
caught it. These two lines have no such guard, and they are the most refactor-fragile
lines in the change — a single `prevFrameLines = []` "simplification" by a future
implementer is both plausible and catastrophic, and nothing would stop it.

### Change Requests

1. **Add a regression test for the resize cache invalidation wiring**
   (`lib/ui/watch.js:827`), not just for `buildFrame`'s handling of a sentinel array.
   Use the existing `watch()`-driving harness (`test/watch.test.js:766` is the
   template): render a first frame, clear `written`, fire `process.stdout.emit('resize')`
   with `process.stdout.rows`/`columns` stubbed to a *smaller row count and the same
   column count*, and assert the redraw wrote **every** row of the new frame (each with
   its own `\x1b[<row>;1H`) **and** blanked the trailing rows of the taller pre-resize
   frame. The test must fail if `prevFrameLines = prevFrameLines.map(() => null)` is
   changed to `prevFrameLines = []` *and* if it is removed entirely — today both
   variants pass `npm test` with exit 0. This is exactly the scenario the delta
   specifies as "A rows-only resize still triggers a full rewrite, not a partial diff".

2. **Add a regression test for the attach cache reset**
   (`lib/ui/watch.js:920`). Same harness — `session.attach` is already faked as
   `attach() { return { status: 0 }; }`. Send the attach key through `fakeStdin`,
   clear `written`, let one poll tick run, and assert the post-attach redraw repainted
   every row rather than writing nothing. Cover the throwing path too (a fake `attach`
   that throws), since the delta specifies the invalidation for both paths and the
   `attachAndRestore` `finally` is what delivers it. The test must fail when
   `prevFrameLines = [];` is deleted from the restore callback — today that deletion
   passes `npm test` with exit 0 and leaves the dashboard permanently blank after any
   attach.

### Non-blocking notes

- `test/watch.test.js:825` and `:944` — the two `plainFrame` locals are now dead
  (all four call sites moved to `screenOf`). The evaluator flagged these in
  `evaluation-2.md` and they are still present. Worth deleting so a future reader is
  not tempted back to the helper the CON-6 merge proved unsafe under the diff writer.
- `test/watch.test.js:325` — the third CON-26 test ("ignores a phantom trailing row
  when diffing") is vacuous, as the evaluator noted: a leaked phantom row lands in
  both `lines` and `prevLines` and compares equal, so `bytes === ''` either way. My
  strip mutation confirms it: removing the strip kills the other two CON-26 tests but
  not this one. Give it teeth with `assert.equal(first.lines.length, 2)`, or fix the
  rationale comment.
- The over-tall fallback re-writes the full frame every tick even when nothing
  changed (my step 1→2: 658 bytes twice for identical content). That matches the spec
  as written and is the rarest path, so it is not a defect — just noting it as the one
  place the ticket's "close to free" goal does not apply.
