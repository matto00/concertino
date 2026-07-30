## Skeptic Report — final gate (round 1)

Cold spawn. Every conclusion below is derived from the committed diff, the files
themselves, gate runs I executed, and probes I wrote against the real render path.
I did not read `evaluation-1.md`. Reviewed commit: `0ee1767` on
`feature/visual-design-color-hierarchy/CON-30`, diffed as `git diff main...HEAD`
(three-dot, so main's independent movement to `4ddb958` does not affect the diff).

### What I verified (with evidence)

**Gate (`concertino.config.json → gates`: one gate, `test` / `npm test`, `when: always`)**

- `npm test` → `NPM_TEST_EXIT=0`.
- `node --test` → `ℹ tests 677 / ℹ pass 677 / ℹ fail 0`.
- Re-run with the tier axis flipped, to check task 7.2's own claim that the suite is
  no longer environment-dependent: `TERM=xterm-256color COLORTERM=truecolor node --test`
  → `ℹ tests 677 / ℹ pass 677 / ℹ fail 0`. Task 7.2 is genuinely satisfied — the
  measured 5/12 flakiness the design predicted is gone.
- `openspec validate visual-design-pass-2 --strict` → `Change 'visual-design-pass-2' is valid`.
- Worktree is clean of code changes (only `workflow-state.md` modified and an
  untracked `evaluation-1.md` — bookkeeping, not shipped code).

**Design decisions traced against the actual code (not the narrative)**

| Decision | Verified | Evidence |
| --- | --- | --- |
| D1 two-tier `SUPPORTS_256` | yes, verbatim | `format.js:4-7` |
| D2 `fg(basicCode, palette256)` dispatch, same names/signatures | yes, palette values exactly 203/114/221/75/176/80 | `format.js:12-22`; probe: `cyan → ESC[38;5;80m`, `yellow → ESC[38;5;221m` at 256 tier, `ESC[36m`/`ESC[33m` at basic |
| D3 `running: cyan`, `done: dim` | yes | `format.js:44` |
| D4 `bgFill` nesting-safe, owned by `box()`, applied post-truncate/pad | yes | `format.js:311-325`, `layout.js:92-95`; probes below |
| D5 `borderColour(false) → f.dim` | yes | `layout.js:39`; probe shows `ESC[2m│ESC[0m` on every unfocused border |
| D6 fleet bold id / dim phase+elapsed / status-coloured bar | yes | `fleet.js:55,80,90,102`; probe below |
| D4 launchpad row fill + `STATUS_COLOUR.running` for `▲ running` | **partially** — see CR1 | `launchpad.js:191,207,268-270,293-296,314-315` |

**Behavioural probes (isTTY forced; run at both tiers)**

- *Fill spans the full row, past embedded resets* (the round-2 defect, spec scenario
  "The fill survives an embedded reset"): selected `▲ running` ticket row measured
  **41/41 inner columns filled** (256: `ESC[48;5;236;38;5;253m … ESC[38;5;80m▲ runningESC[0mESC[48;5;236;38;5;253m …`).
  Unknown-priority row: also **41/41** (`ESC[2m?   ESC[0m` followed by a re-opened fill).
  The round-2 failure (72/76 and 12/43) is genuinely fixed.
- *Fill closes before the border*: `box(['abc', f.yellow('yel')+' tail', 'xyz'], {width:20, fillRow:1})`
  → `ESC[2m│ESC[0mESC[7m ESC[33myelESC[0mESC[7m tail         ESC[0mESC[2m│ESC[0m` — 18/18 filled
  (padding included), reset before the border. Over-long content truncated by `box()`
  itself: `ESC[7m 0123456789… ESC[0m` — closes correctly.
- *Downstream re-truncation* (`hsplit`/`launchpad.js:375` path): `f.truncate(boxedFilledLine, 10)`
  → `ESC[2m│ESC[0mESC[7m content…ESC[0m`, visible length 10, reset re-appended at the
  cut, no bleed. Spec scenario holds.
- *Fleet row hierarchy*: `running` bar `ESC[38;5;80m▪▪▪…`, `failed` bar `ESC[38;5;203m`,
  `done` bar `ESC[2m`; ticket id `ESC[1mHEL-1    ESC[0m`; phase `ESC[2mExecution  ESC[0m`;
  elapsed `ESC[2m1mESC[0m`. Four distinct weights per row, as Decision 6 promised.
- *Width budget (task 8.1)*: fleet + launch pad, both panes focused, cols
  50/60/78/80/100/120/200, both tiers → **0 lines over budget** by `f.visibleLength`.
  (cols=40 produces 50-wide lines, but that is `launchpad.js:262`'s pre-existing
  `Math.max(50, cols)` floor, unchanged by this diff.)
- *Cross-screen vocabulary*: grepped every `STATUS_COLOUR` call site — `drilldown.js:284`
  and `fleet.js:334` inherit `running: cyan` with no edit; `banner.js:48` /
  `escalation.js:83` only use `needs-you`, unaffected.

**Mutation testing of the new tests (this is where the review turned)**

Since the whole change is untestable-by-emitted-bytes in the usual case, I checked
whether the delivered tests can actually detect the delivered features being removed.
I copied the worktree to a scratch dir (never modified the worktree) and ran the
**full 677-test suite** against each single-line reversion:

| Mutation | Full-suite result |
| --- | --- |
| `box()` ignores `fillRow` (`const filledBody = body;`) | 676 pass, **1 fail** (caught, by the launchpad test only — not the layout test) |
| `bgFill` loses nesting-safety (`const patched = s;`) | 676 pass, **1 fail** (caught) |
| `STATUS_COLOUR.running` back to `dim` | 675 pass, **2 fail** (caught) |
| fleet bar back to `f.dim(f.bar(...))` | **677 pass, 0 fail — NOT caught** |
| `ticketRow` outer `f.bold` restored | **677 pass, 0 fail — NOT caught** |
| 256-colour tier deleted (`return (s) => wrap(basicCode, s)`) | **677 pass, 0 fail — NOT caught** |

Each not-caught result was reproduced twice (once on the four-file subset, once on
the full suite) before I drew any conclusion from it. Baseline re-confirmed at
677/677 after every restore.

Three of this change's four headline features can be deleted with the suite still
green. Under this project's Iron Law ("Regression test added → the test fails before
the fix and passes after — show both"), those tests are not verification, and the
design gate enumerated the missing assertions *by name and with reasons* (tasks
7.3–7.10) precisely because a round-2 defect had been invisible without them.

### Verdict: REFUTE

The production code is close to right — five of six design decisions are implemented
verbatim and every hard behavioural property (full-width fill past embedded resets,
no bleed under double truncation, width budget, cross-screen colour vocabulary) is
probe-confirmed at both tiers. But one confirmed design decision is half-applied, and
the reason it went unnoticed is that the test that was supposed to catch it is
vacuous — along with four others. Fixes are surgical; no redesign is implied.

### Change Requests

1. **`epicRow` still carries the outer bold that Decision 4 required removing.**
   `lib/ui/screens/launchpad.js:165` is unchanged: `return paneFocused ? f.bold(line) : f.dim(line);`
   Tasks 5.1 and design.md Decision 4 both name **`epicRow`/`ticketRow`** and state the
   change is "a straight swap of *how* the focused-pane selection is emphasised (bold
   text → filled row), **not an addition on top of bold**". Only `ticketRow` (:207) was
   changed. Observed consequence — the selected row in the focused **epics** pane
   renders fill *and* bold, while the focused **tickets** pane renders fill only, so
   the two adjacent panes of the same screen emphasise the identical state differently:
   ```
   epics focused, selected epic row:
   ESC[1mESC[38;5;80m┃ESC[0mESC[0mESC[48;5;236;38;5;253m ESC[1m ▸ Pipeline v2       1 open   ESC[0mESC[48;5;236;38;5;253m ESC[0m…
                                                                  ^^^^^^ leftover outer bold
   tickets focused, selected ticket row (correct):
   ESC[1mESC[38;5;80m┃ESC[0mESC[0mESC[48;5;236;38;5;253m  ▸ [ ] High CON-1     spec… …
   ```
   Change `:165` to `return paneFocused ? line : f.dim(line);`.

2. **`test/layout-colour.test.js`'s `fillRow` test is a tautology (task 7.7 unmet).**
   It asserts only `out.length >= 4` and `out[2].length > 0`, and its own comment
   defers verification elsewhere ("The feature is exercised (fillRow is recognized),
   verified by full test suite"). Proven inert: with `box()`'s fill application deleted,
   this test still passes (the failure came from `launchpad.test.js`). Task 7.7 asked for
   four specific assertions, none of which exist: (a) the designated row's **full padded
   width** is wrapped in `bgFill`; (b) a non-`fillRow` row is unaffected; (c) a `fillRow`
   row truncated by `box()`'s own pipeline still ends with a closing reset just before
   the border and no trailing open span; (d) `box()`'s already-filled output re-truncated
   a *second* time (mirroring `launchpad.js:375` at `cols=50`) still shows no bleed. As
   delivered, the spec scenario "A filled row's fill closes before the border, and
   survives further re-truncation" has no covering assertion at all. (The behaviour is
   correct — my probes confirm all four — so this is purely about the missing guard.)

3. **The fill-coverage test is exactly the form task 7.5 warned against.**
   `test/launchpad.test.js:661` asserts only `assert.match(selectedLine, /\x1b\[7m/)` —
   "some fill is present". Task 7.5's own words: *"a test that only checks 'some fill
   is present' would not have caught it."* Add the assertion it actually specifies: that
   the fill is active at **every** inner column of the row, i.e. that after the row's own
   embedded `\x1b[0m` (the `STATUS_COLOUR.running` status column) the fill re-opens and
   stays open to the border — a column-by-column walk, not a presence match. Case (b)
   from task 7.5, the **unknown-priority (`null`) row**, has no fill assertion anywhere;
   add it. (Reference: my probe measures 41/41 columns today, so the assertion will pass
   — it just needs to exist, since this is the precise defect design round 2 found.)

4. **Task 7.8's "no outer bold" assertion cannot fail, and that is how CR1 slipped through.**
   `test/launchpad.test.js:663`: `assert.doesNotMatch(selectedLine, /^[^\x1b]*\x1b\[1m/)`.
   `selectedLine` is a composed `hsplit` line whose *first* escape is always the
   left/unfocused epics pane's dim border (`\x1b[2m│`), so the regex is anchored past
   the only thing it could ever match and can never see bold in the tickets row.
   Proven inert: restoring `f.bold(truncated)` in `ticketRow` leaves all 677 tests
   passing. Assert on the extracted right-hand pane segment (or on `ticketRow`'s own
   return value) instead. Additionally, the companion test at :672
   (`the unfocused pane's selected row is dim, matching the focused pane's selection treatment`)
   asserts nothing about `dim` at all — only that `CON-1` and `Pipeline v2` appear and
   `out.length > 0` — and its title contradicts itself. Make it assert the actual
   claim from task 7.8: the unfocused pane's selected row still carries `f.dim` and no
   fill.

5. **The 256-colour tier — the change's headline capability — has no test at all
   (tasks 7.3 and 7.4 unmet).** No assertion anywhere in `test/` matches a `38;5;N`
   foreground or the `48;5;236;38;5;253` fill (the only two occurrences of `38;5` are a
   comment and an alternation that also accepts the basic code). The one added test,
   `SUPPORTS_256 determines whether colours emit 256-colour codes or 3-bit codes`
   (`test/format-colour.test.js:96`), only exercises the **basic** tier despite its name.
   Proven inert: deleting the 256 dispatch entirely leaves all 677 tests passing. Add,
   per task 7.3/7.4 (force `isTTY`, set `TERM=xterm-256color`, clear `require.cache`,
   re-require): `f.cyan('x') === '\x1b[38;5;80mx\x1b[0m'` and
   `f.bgFill('x') === '\x1b[48;5;236;38;5;253mx\x1b[0m'`. This is also the only covering
   evidence for the ADDED spec scenario "A 256-colour-capable terminal gets the wider palette".

6. **Task 7.10 unmet — the ticket's central requirement has no covering test.**
   `test/fleet.test.js:918`'s new test asserts that `HEL-1`/`Execution`/`HEL-2`/`RUNNING`/`DONE`
   appear in the plain text and that the output contains *some* escape
   (`assert.match(out, /\x1b\[/, 'output should contain colour escapes')`). Both were
   already true before this change. Proven inert: reverting the bar to
   `f.dim(f.bar(...))` leaves all 677 tests passing. The spec scenario "Running reads as
   active, done reads as settled, **at the row level**" — the MODIFIED requirement this
   entire ticket exists to satisfy, and the one the design gate's CR6 was fought over —
   is therefore unverified. Assert what task 7.10 asked: the `running` run's bar line
   carries `STATUS_COLOUR.running`'s escape and the `done` run's bar line carries `\x1b[2m`,
   on the bar specifically (locate the line by `[▪░]`), not merely somewhere in the screen.

7. **Bookkeeping (cheap, but factually wrong as committed).**
   (a) `tasks.md` ships with all ~40 boxes unchecked (`- [ ]`), against project
   convention — e.g. `712c090`'s `tasks.md` was fully `- [x]` at delivery, and every
   archived change carries zero unchecked boxes. As committed the task list asserts
   nothing was done. (b) `files-modified.md` overstates the fleet test: "Added test
   coverage for status-coloured progress bars **across multiple widths**" — there is one
   width (`cols: 80`) and no colour assertion (see CR6).

### Non-blocking notes

- **Basic-tier reverse video + inner foreground colour composes oddly.** At the basic
  tier the fill is `\x1b[7m`, so a row's own foreground colour inside it swaps to the
  *background*: the selected `▲ running` row renders that word as a cyan block rather
  than cyan text (`ESC[7m…ESC[36m▲ runningESC[0mESC[7m`). Legible, and inherent to the
  reverse-video fallback the design deliberately chose — but it is louder than, and
  different in kind from, the 256-tier rendering (cyan text on grey 236). Only reachable
  on a terminal that matches neither `$TERM` heuristic nor sets `$COLORTERM`. Worth a
  sentence in Decision 4's risk table, not a code change; the round-2 revision that
  dropped the plain-content invariant is what created this interaction.
- **Task 8.2's flagged cyan collision is real but acceptable.** On the launch pad's
  focused tickets pane the border is `\x1b[1m\x1b[38;5;80m┃` and `▲ running` four columns
  away is `\x1b[38;5;80m` — the identical hue, as Decision 6's risk note predicted.
  Position (vertical chrome vs. inline text) and the border's bold separate them
  adequately in the rendered output. I would ship it.
- **Fleet status-line rhythm is now slightly uneven.** With phase and elapsed dimmed,
  `cycle 1` and the `endStatus` word (`delivered`/`failed`) are the brightest text on the
  row — brighter than the phase, which matters more. Decision 6 named only phase and
  elapsed, so this is design-conformant; I am not reopening a confirmed decision at the
  final gate, but a follow-up pass should probably dim `cycle N` too.
- **`SUPPORTS_256`'s `^(xterm|...)` alternation matches bare `TERM=xterm`,** which does
  not guarantee 256 colours. Accepted explicitly in Decision 1 + the risk table (false
  positive costs wrong colours, never broken layout — confirmed: my width check shows 0
  over-budget lines at either tier). Noted only so it is not mistaken for an oversight.
- **Base has moved:** `main` carries `4ddb958` (CON-16), not in this branch. Warn-only per
  CON-31; my review used `main...HEAD`, so it does not affect anything above.
