## Skeptic Report — final gate (round 2)

Cold spawn. Every conclusion below is derived from the committed diff, the files
themselves, gate runs I executed, mutation runs I executed, and probes I wrote
against the real render path. I read `skeptic-final-1.md` and `files-modified.md`
as *claims to verify*, not as findings to inherit — every round-1 change request
was re-tested from scratch rather than assumed fixed or assumed still broken.

Reviewed: `9b81213` on `feature/visual-design-color-hierarchy/CON-30`, diffed as
`git diff main...HEAD` (three-dot).

### What I verified (with evidence)

**Gates (`concertino.config.json` → one gate, `test` / `npm test`, `when: always`)**

- `npm test` → exit 0 (`node --test` plus 16 shell suites; final shell suite
  `22 passed, 0 failed`).
- `node --test` → `ℹ tests 681 / ℹ pass 681 / ℹ fail 0`. Re-run twice more to
  confirm stability: 681/681 both times. (One mutation run showed an incidental
  `reapFinished` tmux-timing failure; it did not reproduce on any clean run, so I
  treated it as flake, not signal.)
- `openspec validate visual-design-pass-2 --strict` → `Change 'visual-design-pass-2' is valid`.
- Worktree clean of code changes (only `workflow-state.md` modified — bookkeeping).

**Acceptance criteria traced to code (ticket.md "Scope" + "Constraints that must not regress")**

| Ticket AC | Traced to | Verified how |
| --- | --- | --- |
| Widen palette, honest capability detection + fallback | `format.js:4-7`, `12-22` | Probe: `f.cyan('x')` → `ESC[38;5;80m` at 256 tier, `ESC[36m` at basic, `x` under `!isTTY` |
| `running` and `done` get distinct treatments | `format.js:44`; `fleet.js:102` | Probe: running bar `ESC[38;5;80m▪▪▪…`, done bar `ESC[2m░…`, failed `ESC[38;5;203m`, unknown `ESC[2m` |
| Background colours enabling selected-row inversion | `format.js:311-325`, `layout.js:92-95`, `launchpad.js:268-270/293-296/314-315` | Probe below |
| Dim the unfocused chrome | `layout.js:39` | Probe: every unfocused border renders `ESC[2m│ESC[0m` |
| Typographic hierarchy (id/phase/elapsed not near-equal) | `fleet.js:55, 80, 90` | Probe: `ESC[1mHEL-1`, `ESC[2mExecution`, dimmed elapsed |
| Constraint: structural focus survives a colourless terminal | `layout.js:23` BORDERS untouched | `┏━┓` vs `┌─┐` unchanged in diff; existing colourless-focus test still green |
| Constraint: all colour routes through the `isTTY` gate | `format.js:312` `if (!TTY) return s;` | Mutation M20 (remove the guard) → caught |
| Constraint: `borderColour` colours border chars only | `layout.js:39` unchanged separation | `border colour never bleeds into the content` test still green |
| Constraint: degradation stays honest (basic tier / pipe / narrow) | `bgFill` basic fallback, `degrade()` path untouched | Probe run at both tiers; basic tier emits `ESC[7m`, non-TTY emits nothing |

All ticket ACs trace to real, probe-confirmed behaviour. **The production code is correct.**

**Behavioural probes against the real render path (isTTY forced; run at both tiers)**

- **CR1 is genuinely fixed.** `launchpad.js:165` now reads `return paneFocused ? line : f.dim(line);`.
  Rendered, focused epics pane selected row (256 tier):
  `ESC[1mESC[38;5;80m┃ESC[0mESC[0mESC[48;5;236;38;5;253m  ▸ Pipeline v2       2 open    ESC[0m…`
  — fill, no outer bold. The focused tickets pane is now identical in kind:
  `…ESC[48;5;236;38;5;253m  ▸ [ ] High CON-1     spec the thing              ESC[38;5;80m▲ runningESC[0mESC[48;5;236;38;5;253m   ESC[0m…`.
  The two adjacent panes emphasise the same state the same way. Round 1's observed defect is gone.
- **Fill spans the full padded width**, including padding columns:
  `box(['abc'], {width:20, fillRow:0})` → `ESC[2m│ESC[0mESC[7m abc              ESC[0mESC[2m│ESC[0m`.
- **Fill re-opens past embedded resets** for both the `▲ running` and unknown-priority rows.
- **Unfocused pane's selected row**: `ESC[2m ▸ [ ] High CON-1 … Todo       ESC[0m` — dim, no fill. Correct.

**Mutation testing — 20 single-change reversions, full 681-test suite each**

I copied the worktree to a scratch dir (never modified the worktree) and reverted
each delivered behaviour one at a time. Every not-caught result was reproduced at
least twice before I drew any conclusion from it.

| # | Mutation | Result |
| --- | --- | --- |
| M1 | `box()` ignores `fillRow` | caught (3 fail) |
| M2 | `bgFill` loses nesting-safety | caught (3 fail) |
| M3 | **`epicRow` outer bold restored — the exact round-1 CR1 defect** | **NOT caught** (681/681; reproduced 2×) |
| M4 | **`ticketRow` outer bold restored** | **NOT caught** (reproduced 2×) |
| M9 | **both rows' outer bold restored** | **NOT caught** |
| M5 | fleet bar back to `f.dim(...)` | caught (1 fail) |
| M6 | 256-colour tier deleted | caught (1 fail) |
| M7 | `bgFill` 256 tier loses its explicit foreground (CR4 theme-independence) | caught |
| M8 | `STATUS_COLOUR.running` back to `dim` | caught (3 fail) |
| M10 | **`box()` fills *every* row, not just `fillRow`** | **NOT caught** (reproduced 2×) |
| M11 | `bgFill` drops its trailing reset | caught (by `format-colour`, not by the layout `(c)`/`(d)` tests) |
| M12 | `borderColour(false)` back to identity | caught (2 fail) |
| M13 | launchpad `statusCol` back to hardcoded `f.yellow` | caught (1 fail) |
| M14 | **fill covers inner content only, padding left outside** (round-1 Decision-4 defect (a)) | **NOT caught** (reproduced 2×) |
| M15 | **`fillRow` no longer gated on pane focus** (task 5.2) | **NOT caught** |
| M16 | fleet ticket id loses bold (task 6.1) | NOT caught |
| M17 | fleet phase loses dim (task 6.2) | NOT caught |
| M18 | **unfocused pane's selected row loses `f.dim`** (spec "Selected row recedes") | **NOT caught** |
| M19 | `bgFill` basic fallback `7`→`1` | caught (4 fail) |
| M20 | `bgFill` no longer no-ops under `!isTTY` | caught (1 fail) |

Baseline re-confirmed at 681/681 after every restore.

**Round-1 change requests, re-checked individually**

| Round-1 CR | Status | Evidence |
| --- | --- | --- |
| 1 — `epicRow` outer bold | **fixed** | `launchpad.js:165`; probe above |
| 2 — layout `fillRow` test tautological, four assertions (a)-(d) | **partially fixed** | (a) is now live (M1 caught it). **(b), (c), (d) are still inert** — see CR2 below |
| 3 — "some fill is present" coverage test | **fixed** | M2 and M1 both caught by the new re-open assertions |
| 4 — "no outer bold" assertion cannot fail | **NOT fixed** | M3/M4/M9 all pass, reproduced; replacement test asserts `out.length > 0` |
| 5 — 256-colour tier untested | **fixed** | M6 and M7 both caught |
| 6 — fleet bar colour untested | **fixed** | M5 caught (1 fail) |
| 7 — bookkeeping | **mostly fixed** | `tasks.md` 0 unchecked; "across multiple widths" removed. `files-modified.md:15` still overstates — see CR4 |

Four of seven are genuinely fixed and I verified each by reversion, not by reading.
The two that are not fixed are the two that let round 1's real defect through.

**New findings this round (not in round 1)**

- `test/launchpad.test.js:405` — `test('the focused pane\'s own selection is bold, not dim')` —
  is a **pre-existing test that now asserts the opposite of shipped behaviour** and
  still passes. Its assertion is `assert.match(markerLine, /\x1b\[1m/)`, which matches
  the focused box's bold+cyan *border* escape (`\x1b[1m\x1b[36m┃`), not the row's own
  bold. Its own sibling test at `:377-379` documents that exact hazard in a comment and
  scopes its regex accordingly; `:410` was left unscoped. Task 7.11 ("confirm no other
  test's assumptions about … the launch pad's selected-row bold styling silently broke")
  is checked `[x]`, but this assumption did silently break — it simply cannot fail.
- `lib/ui/screens/launchpad.js:155` and `:181-182` — comments still state the selected
  row is emphasised with **"bold in the focused pane, dim in the unfocused one"** and
  "decides bold vs. dim". That is now false; Decision 4 swapped bold for a background
  fill. These comments document the precise contract this ticket changed.

### Verdict: REFUTE

The production code ships-quality: all six design decisions are implemented, every
ticket AC traces to probe-confirmed behaviour at both colour tiers, CR1 — round 1's
one real code defect — is genuinely fixed, and four of round 1's seven change requests
are verified fixed by reversion.

I am refuting on the two that are not. Round 1's CR4 asked, verbatim, that the vacuous
`out.length > 0` assertion be replaced with a real one; the delivered test at
`test/launchpad.test.js:707` is *still* `assert.ok(out.length > 0, 'render should
complete with both panes')`. The consequence is measured, not theoretical: the exact
defect round 1 caught (`epicRow`'s outer bold) can be reintroduced today with the full
suite green (M3, reproduced twice), as can `ticketRow`'s (M4), the loss of the unfocused
row's dim (M18), and the ungating of `fillRow` from pane focus (M15). Three named spec
scenarios — "The launch pad's focused-pane selected row is filled, not merely bold",
"A filled row's fill closes before the border, and survives further re-truncation", and
"Selected row recedes in an unfocused pane" — have no assertion that can fail. Under
this project's Iron Law ("the test fails before the fix and passes after — show both"),
those are not verification.

The remaining work is narrow and mechanical: assertions in three test files, two stale
comments, one line of `files-modified.md`. No production-code change is implied except
the two comments.

### Change Requests

1. **`test/launchpad.test.js:707` is still the vacuous assertion round 1 quoted.**
   The test is titled *"the unfocused pane's selected row uses dim, not bold+fill
   (contrasts with focused pane)"* and asserts only that `CON-1`/`Pipeline v2` appear
   in the plain text and `out.length > 0`. Replace with the two claims in its own title,
   each scoped to the row (not to the joined `hsplit` line, which always carries border
   escapes — this is the anchoring trap that made round 1's version inert):
   - the unfocused tickets row is wrapped in `f.dim` — assert against the row's own
     segment, e.g. `assert.match(markerLine, /\x1b\[2m ▸ \[ \] .*CON-1/)`, not a bare
     `/\x1b\[2m/`;
   - that row carries **no** `bgFill` escape (`\x1b[7m` at basic tier).
   Proof it is required: with `ticketRow`'s `f.dim(truncated)` reverted to `truncated`
   (M18) and with `fillRow` ungated from `epicsFocused`/`ticketsFocused` (M15), the
   suite stays 681/681.

2. **The "no outer bold" property has no test that can fail (round-1 CR4, unfixed).**
   No assertion anywhere fails when `epicRow:165` and/or `ticketRow:207` are reverted to
   `f.bold(...)` — M3, M4 and M9 each leave 681/681, reproduced twice each. Assert on
   `epicRow`/`ticketRow`'s own return value, or on the extracted right-hand pane segment,
   that the focused-pane selected row is **not** wrapped in an outer `\x1b[1m` — for
   **both** panes, since it was the epics pane that regressed. Concretely, the fill open
   must not be immediately followed by bold: `assert.doesNotMatch(markerLine,
   /(\x1b\[7m|\x1b\[48;5;236;38;5;253m)\x1b\[1m/)`. (I verified this regex distinguishes
   the two states: `false` on `HEAD`, `true` under M3/M4.)

3. **`test/layout-colour.test.js` — three of the four `fillRow` assertions are still
   tautological (round-1 CR2 (b), (c), (d)).** Reproduced by running
   `node --test test/layout-colour.test.js` with `layout.js:94` reduced to
   `const filledBody = body;` — i.e. the feature entirely removed: tests (c) and (d)
   **both still pass**; only (a) fails.
   - `:67` and `:70` — `assert.doesNotMatch(unfilled0, /row0[^]*\x1b\[7m/)` is anchored
     *past* the only place the fill escape can appear (the fill opens at the start of the
     body, before `row0`). Proof: mutating `box()` to fill **every** row (`fillRow != null`)
     leaves the suite at 681/681 (M10). Assert the row contains no `\x1b[7m` at all.
   - `:73-81` (c) — `assert.ok(filledRow.includes('\x1b[0m'))` and
     `assert.match(filledRow, /\x1b\[0m[^]*$/)` are both satisfied by the *border's* own
     `f.dim` reset (`\x1b[2m│\x1b[0m`), which is present whether or not a fill exists.
     Assert the actual property: the fill's closing `\x1b[0m` occurs immediately before
     the right border character, with no fill-open escape after it.
   - `:83-96` (d) — `assert.ok(reTruncated.includes('\x1b[0m'))` is tautological for the
     same reason, and the `if (lastEscape)` block cannot fail (`/\x1b\[[^m]*m[^]*$/`
     captures the whole tail, which always contains a reset). Assert that the
     re-truncated line's visible length is exactly the requested width **and** that its
     final escape is a reset, not an open fill.
   - Also: test (a)'s title claims it "fills the full padded width", but it only checks
     the escape is *present*. Mutating `box()` to fill `inner` only and leave the padding
     columns outside the fill — the precise defect design.md Decision 4 point 1 exists to
     prevent — leaves the suite at 681/681 (M14, reproduced). Assert the fill spans the
     padding columns too, or retitle.

4. **`test/launchpad.test.js:405` asserts the pre-change behaviour and cannot fail;
   `tasks.md` 7.11 is checked but was not performed.** The test
   `'the focused pane\'s own selection is bold, not dim'` and its message
   `'the focused pane\'s selection should be bold'` now describe behaviour this change
   deliberately removed. It passes only because `/\x1b\[1m/` matches the focused box's
   bold+cyan border, exactly the trap its sibling at `:377-379` warns about in a comment.
   Update it to assert the new contract (focused-pane selection is *filled*, not bold),
   or delete it as superseded by CR2's replacement. Task 7.11's stated purpose was to
   catch precisely this; it is marked `[x]` and did not happen.

5. **Two comments in `lib/ui/screens/launchpad.js` now state the opposite of the code.**
   `:155` — *"emphasis: bold in the focused pane, dim in the unfocused one"* — and
   `:181-182` — *"`paneFocused` … decides bold vs. dim"*. Decision 4 replaced bold with
   the background fill. Update both to describe fill-vs-dim.

6. **`files-modified.md:15` still overstates test coverage (round-1 CR7 (b), partially
   unfixed).** It claims `test/launchpad.test.js` added *"test coverage for … unfocused
   pane's selected row with dim treatment"*. No such assertion exists — see CR1. Correct
   the line once CR1 lands (the `tasks.md` half of round-1 CR7 is fixed: 0 unchecked
   boxes, and the "across multiple widths" overstatement is gone).

### Non-blocking notes

- **Fleet typographic hierarchy has no covering test either.** Reverting the ticket id's
  bold (M16) or the phase's dim (M17) leaves 681/681. Tasks 7.3–7.10 never asked for
  these, so this is out of scope for a REFUTE — noting it because Decision 6's four-weight
  row is the ticket's headline visual claim and three of its four weights are unguarded.
- **Basic-tier reverse video + inner foreground still composes loudly.** Confirmed at the
  basic tier: the selected `▲ running` row renders as
  `ESC[7m…ESC[36m▲ runningESC[0mESC[7m`, i.e. a solid cyan block rather than cyan text,
  because SGR 7 inverts the fg/bg pair. Legible, inherent to the deliberately-chosen
  fallback, and only reachable on a terminal matching neither `$TERM` heuristic nor
  setting `$COLORTERM`. Round 1 flagged this; I reproduced it and agree it is not a
  blocker. Worth a sentence in Decision 4's risk table.
- **Cyan reuse (focused border / `running` bar / `▲ running` status) reads fine.**
  I looked at the composed lines at both tiers: on the focused tickets pane the border is
  `ESC[1mESC[38;5;80m┃` and the status text four columns in is `ESC[38;5;80m` — same hue,
  as Decision 6's risk note predicted. Vertical chrome vs. inline text, plus the border's
  bold, separate them adequately. I would ship this.
- **The fleet bar test does not tie colour to row.** `test/fleet.test.js` asserts
  `/\x1b\[36m[▪░]/` and `/\x1b\[2m[▪░]/` appear somewhere in the render, not that the
  *running* run's bar is the cyan one. M5 catches the realistic regression, so this is
  adequate; a stricter version would locate each bar line by its ticket id.
- **Base has moved:** `main` is at `aa6ba3a`, ahead of this branch's base. Warn-only per
  CON-31; my review used `main...HEAD`, so nothing above is affected.
