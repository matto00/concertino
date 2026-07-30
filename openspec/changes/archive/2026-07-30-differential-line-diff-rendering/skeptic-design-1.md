## Skeptic Report — design gate (round 1)

Cold review. Every conclusion below is derived from the artifacts and from the
actual code in this worktree, not from any other agent's narrative.

### What I verified (with evidence)

**Artifacts read in full**
- `openspec/changes/differential-line-diff-rendering/ticket.md`,
  `proposal.md`, `design.md`, `tasks.md`,
  `specs/dashboard-render-loop/spec.md`, `workflow-state.md`
  (`SKEPTIC_CYCLE: 0` → this is round 1).

**Ground truth read (not taken on trust)**
- `lib/ui/watch.js` in full (1239 lines) — current `buildFrame` at :111-129
  (`let bytes = CURSOR_HOME + lines.join('\n')`, shrink loop at :122-127,
  returns `{ bytes, lineCount }`), its call site in `draw()` at :540-546,
  `lastFrameLines` declaration at :226-229, `CURSOR_HOME` constant at :93 and
  its export at :1237, `doAttach()` at :648-672.
- `lib/ui/format.js:296-303` — `padTo(s, n)` = `truncate(s, n)` then pad to `n`
  **visible** columns. Confirms every padded line has visible width exactly
  `n`, which makes design.md Decision 3's cols-resize argument a *guarantee*,
  not the "essentially never compare equal" hedge it is written as.
- `test/watch.test.js:1-100` — the existing `buildFrame` suite: imports
  `CURSOR_HOME` (:10), asserts `bytes.startsWith(CURSOR_HOME)` (:27), and
  slices `CURSOR_HOME.length` off the front in three tests (:32, :47, :57);
  growth test asserts *no* `\x1b[\d+;1H` at all (:82).
- `grep -rn CURSOR_HOME` across the repo → only `lib/ui/watch.js` (:93, :113,
  :1237) and `test/watch.test.js` (:10, :27, :32, :47, :57). No shell/doctor
  consumer.
- `lib/ui/screens/fleet.js:277-291` — vertical budget is `rows - 1` with the
  explicit comment "One row is reserved for the newline the writer appends:
  filling the last terminal row and then emitting \n scrolls the screen by
  one" — i.e. today's frame writer is *newline-flow*, and the cap exists
  because newline flow scrolls. `fleet.js:286-288` documents a deliberate
  overflow: "NEEDS YOU is never trimmed. If it alone overflows the terminal we
  lose the header, which is the right thing to lose."
- `grep -n rows lib/ui/screens/*.js lib/ui/banner.js` → only `fleet.js` and
  `launchpad.js` bound their output vertically. `drilldown.js`,
  `escalation.js`, `launchplan.js`, `ticketview.js` never read `opts.rows`.
- Executed proof that a frame can far exceed the terminal height:
  ```
  $ node -e "... ticketview.render(st, { cols: 80, rows: 24 }) ..."
  frame lines with rows=24 -> 131
  ```
- `concertino.config.json` → `ui.enabled: false`, gates = `npm test`. No UI
  judgment applies at this gate; nothing to screenshot.
- `grep -rni "attach|1049|alternate|process.stdout.rows|taller than|scroll"`
  over all four planning artifacts → **three incidental mentions only**
  (`proposal.md:25`, `design.md:11`, `tasks.md:26`), all of the form "attach /
  resize behavior is unchanged". No decision, no task, no scenario anywhere
  analyses either.

**What holds up**
- Scope discipline is correct: tasks touch only `lib/ui/watch.js` and
  `test/watch.test.js`; `router.js` and `screens/*` are untouched, as the
  ticket's scope note requires.
- Decision 1 (array instead of count) and Decision 2 (strict per-line `!==` on
  already-padded content, reusing `padTo`) are sound and correctly grounded in
  the real code.
- Decision 4 (shrink rows have nothing to diff against, so blank
  unconditionally) matches the existing loop at `watch.js:122-127` exactly.
- Risk 3 (breaking `buildFrame` signature, one production call site) is
  accurate — verified: `draw()` at :544 is the only one.
- The spec delta's `### Requirement:` heading matches the existing requirement
  heading in `openspec/specs/dashboard-render-loop/spec.md:6` verbatim, and it
  carries the two `\x1b[2J` scenarios and the coloured-padding scenario
  forward. Delta format is valid.

### Verdict: REFUTE

The core of the change (row-granular diff, array-not-count state) is sound.
What blocks it is that the design switches the frame writer from **relative
newline flow** to **absolute row addressing**, and its whole correctness rests
on an invariant it never states or defends: *`prevFrameLines` describes exactly
what the terminal is displaying at rows 1..N.* I found two paths in this
codebase that break that invariant today, one of which is a near-certain,
user-visible regression, and a three-way contradiction between the proposal,
the design, and the spec delta about a third.

### Change Requests

1. **Detaching from tmux will leave the dashboard mostly blank — nothing
   invalidates the diff cache when the alternate screen is re-entered.**
   `doAttach()` writes `ALT_SCREEN_EXIT` before handing the terminal to tmux
   (`lib/ui/watch.js:653`) and writes `ALT_SCREEN_ENTER` again in the restore
   callback (`lib/ui/watch.js:667`). `\x1b[?1049h` *clears* the alternate
   screen buffer on entry (xterm ctlseqs, 1049: "switch to the Alternate
   Screen Buffer, clearing it first") — and tmux has owned the terminal in
   between regardless. So immediately after a detach the screen is blank while
   `prevFrameLines` still holds the entire pre-attach frame. The next `draw()`
   would write only the rows whose *content* changed (the clock, an idle
   timer), leaving the header, every box border, every section title and every
   unchanged run row blank until each happens to change on its own. Today's
   `CURSOR_HOME + lines.join('\n')` repaints all of it, which is why attach
   works now.
   Required: add a decision + task that invalidates the frame cache whenever
   the terminal contents are no longer ours — concretely, reset
   `prevFrameLines = []` (or set a `forceFullRedraw` flag `draw()` consumes)
   inside `doAttach()`'s `attachAndRestore` restore callback, on **both** the
   normal and throwing paths. Then either add a scenario to the spec delta
   ("the first redraw after returning from attach rewrites every row") or add a
   `MODIFIED` entry for the existing "Attach suspends and restores the
   dashboard's alternate screen state around tmux" requirement. `proposal.md:25`
   currently asserts the attach requirement is "untouched by this ticket's
   scope" — that assertion is false as written and must be corrected.

2. **A frame taller than the terminal is unhandled: `\x1b[<row>;1H` clamps
   where newline flow scrolled, and it poisons `prevFrameLines` permanently.**
   Evidence that over-tall frames are reachable and in some cases *intended*:
   `ticketview.render(..., { rows: 24 })` returns **131 lines** (executed
   above); `drilldown.js`, `escalation.js`, `launchplan.js` and
   `ticketview.js` never read `opts.rows` at all; and `fleet.js:286-288`
   deliberately overflows for an un-trimmable NEEDS YOU section, relying on the
   scroll ("we lose the header, which is the right thing to lose").
   `fleet.js:280-283`'s own comment names newline-flow scrolling as the
   mechanism the budget is sized against. With absolute addressing, rows beyond
   `process.stdout.rows` clamp onto the bottom row: the visible result changes
   (overflow piles onto the last row instead of scrolling), *and*
   `prevFrameLines` records content for rows the terminal never displayed at
   those positions, so every later diff skips repainting them — the corruption
   is sticky, not transient.
   Required: design.md must take an explicit decision here (e.g. clamp
   `lines` to `process.stdout.rows` before diffing; or detect
   `lines.length > rows` and fall back to a full newline-flow rewrite for that
   frame), add the corresponding task, add it to Risks / Trade-offs, and add a
   spec scenario for the over-tall case. Note that a scroll also invalidates
   `prevFrameLines` for *every* row, so whatever is chosen must reset the cache
   in that case.

3. **Post-resize behavior: proposal, design and spec delta say three different
   things, and the design's argument only covers a width change.**
   - `proposal.md:8` — the full-frame cursor-home path "is kept for the very
     first frame of a session and is otherwise replaced by the diff path".
   - `proposal.md:19` — "the first frame of a session **and a frame following a
     resize** still do a full rewrite."
   - `design.md` Decision 3 — "**No special-casing** for the first frame of a
     session or a post-resize frame."
   - The spec delta mentions the first frame but says **nothing** about resize,
     so it does not encode what `proposal.md:19` claims it encodes.
   Substantively: I verified `padTo` (`lib/ui/format.js:300-303`) makes every
   padded line exactly `cols` visible columns wide, so a **cols** change does
   force every row to differ — that half of Decision 3 is actually stronger
   than the design claims. But a **rows-only** resize (dragging the bottom
   edge, a tmux pane split/resize) leaves `cols` identical, so unchanged rows
   produce byte-identical padded strings and the diff writes nothing for them —
   while the terminal has just been resized and, in the alternate screen, is
   not guaranteed to have kept that content in place. The existing spec
   requirement "Resizing mid-run reflows without corrupting the frame" is
   satisfied today only because a poll-tick redraw is a full repaint; after
   this change its scenario ("pads and blanks trailing rows exactly as a
   regular poll-tick redraw would, leaving no stale content from the larger,
   pre-resize frame") no longer follows.
   Required: pick one answer, make all three artifacts agree, and address
   rows-only resize specifically — the cleanest option is to have the
   `process.stdout.on('resize')` listener (`watch.js:589`) invalidate the frame
   cache exactly as request 1 does for attach, which also disposes of the
   height-change case for free. If resize does force a full rewrite, the spec
   delta must say so (either in the modified requirement's text or as a
   `MODIFIED` entry for the resize requirement). Also restate Decision 3's
   cols argument as the guarantee it is (`padTo` yields exactly `cols` visible
   columns) rather than "will essentially never compare equal".

4. **`proposal.md:10` is self-contradictory and contradicts design Decision 1.**
   As written: "`lastFrameLines` becomes `lastFrameLines` (a count) plus the
   previous frame's own line array (`lastFrameLines` growing into 'previous
   rendered lines', or an additional variable)". It names the same variable as
   both sides of the change, then offers two mutually exclusive options —
   exactly the "keep the count *and* add an array" shape design.md Decision 1
   explicitly rejects as "redundant state that can drift". Likewise
   `proposal.md:8`'s "the cursor-home path is *kept* for the very first frame"
   contradicts Decision 3 and task 1.4 (which removes the `CURSOR_HOME`
   usage). Rewrite `proposal.md:8` and `:10` to match the design's actual
   decisions (single `prevFrameLines: string[]`, no first-frame branch).

5. **Task 3.1 materially understates the test rewrite, and task 1.4 leaves the
   `CURSOR_HOME` export undecided.**
   Task 3.1 says the existing tests "need to pass an array (not a number) as
   the third argument and read `.lines` (not `.lineCount`)". That is not
   sufficient: `test/watch.test.js:27` asserts
   `frame.bytes.startsWith(CURSOR_HOME)`, and :32, :47 and :57 all do
   `frame.bytes.slice(CURSOR_HOME.length)` to reach the padded content. The new
   prefix is `\x1b[1;1H` (7 bytes), not `\x1b[H` (3 bytes), so all four are
   semantic rewrites, not signature adjustments — spell out the new expected
   prefix in the task so the executor does not "fix" them by adjusting the
   slice offset and calling it done. Separately, task 1.4's conditional
   ("keep the constant only if still referenced elsewhere, otherwise drop it")
   is ambiguous for a symbol that is a **public export**
   (`lib/ui/watch.js:1237`) imported by `test/watch.test.js:10`: decide
   explicitly whether the export stays, and say what happens to the
   greppability guarantee `watch.js:86-92` documents for these named
   constants.

6. **Task 4.2 has no acceptance signal an executor can actually produce.**
   "Manually sanity-check (or via a scripted harness) that a real poll tick
   where nothing changed produces no visible flicker" is unverifiable under
   `verification-before-completion.md` — there is no command whose output
   settles it, and "resize/attach/quit behavior is unaffected" is precisely
   what requests 1-3 show is *not* free. Replace it with a concrete check:
   either extend `test/scripts/watch-smoke.test.sh` (which already counts
   escape-sequence occurrences via its `esc_count` helper) with an assertion
   over a real steady-state tick, or state explicitly that tasks 3.2/3.3 are
   the acceptance signal for "an unchanged tick writes nothing" and drop the
   manual step.

### Non-blocking notes

- Decision 5 calls `process.stdout.write('')` "a documented no-op on a Node
  writable stream". Node documents that a zero-length write is permitted, not
  that it is a no-op. Cheapest and clearest is to guard it at the call site —
  task 2.2 currently specifies an unconditional
  `process.stdout.write(frame.bytes)`; `if (frame.bytes) process.stdout.write(...)`
  makes "an unchanged frame touches stdout not at all" literally true and
  costs nothing.
- No task updates the prose that will become factually wrong. `watch.js:97-110`
  (`buildFrame`'s header: "Cursor-home + pad-to-width overwrite"),
  `watch.js:540-543` (the `draw()` call-site comment) and `watch.js:226-229`
  (the `lastFrameLines` comment) all describe the old mechanism. Task 2.3 only
  checks for stale *identifiers*. This codebase's comments carry real design
  rationale, so consider making the comment rewrite explicit.
- `design.md` Non-Goals correctly rules out sub-row diffing with a good reason;
  no objection there. Same for the "no generic diff utility" call.
