## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/dashboard-render-loop/spec.md` in full.
- Read `lib/ui/watch.js` in full (ground truth for `clear()`, `draw()`,
  `quit()`, `doAttach()`, the poll timer, and stdin exit wiring).
- Read `lib/ui/session.js` in full (ground truth for `attach()`'s
  `spawnSync(..., { stdio: 'inherit' })`).
- Read `lib/ui/format.js` and `lib/ui/layout.js` in full to check the
  design's padding mechanism against how frames are actually rendered.
- Confirmed via `grep` that no file in the change directory (`design.md`,
  `tasks.md`, `specs/.../spec.md`) mentions `format.js`, `visibleLength`,
  or `padTo` at all.
- Confirmed via `grep` on `lib/ui/screens/fleet.js` that top-level
  header/footer lines (outside `layout.js`'s `box()`) are wrapped in
  `f.bold`/`f.dim`/`f.yellow`/`f.red` — i.e. carry raw ANSI SGR escape
  bytes (`\x1b[<code>m ... \x1b[0m`) — at exactly the "outer frame" level
  Decision 1 says needs `watch.js`-side padding, since `layout.js`'s own
  padding only covers a box's *internal* width.
- Design's factual claims about current behavior checked against the code
  and found accurate: `clear()` is `\x1b[2J\x1b[H` (watch.js:32-34); `draw()`
  calls `clear()` then writes the frame (watch.js:311-319); `process.stdout
  .columns`/`.rows` are read fresh at each `draw()` call, not cached
  (watch.js:316-317); the `try/finally` around `session.attach()` in
  `doAttach()` already exists and matches the design's stated sequencing
  (watch.js:369-383); all three non-attach exit paths funnel through the
  single `quit()` function (watch.js:334-364, 758-772).
- Traced all five ticket ACs to design decisions and to spec.md
  requirements/scenarios: coverage is complete and the mapping is
  consistent (steady-state clear → Decision 1/Req 1; scrollback+attach
  restore → Decisions 3-4/Req 3-4; shrinking frame → Decision 2/Req 2;
  resize → Decision 5/Req 5).
- Checked the scope decision to defer differential rendering (approach 3):
  the ticket itself says "(1) and (2) together are probably the right
  first move; (3) is a follow-up if the poll ever gets more expensive,"
  and design.md's Non-Goals mirrors this reasoning almost verbatim. This
  scope call is sound and faithful to the ticket's own guidance.
- Checked tasks.md against design.md: no contradictions found in the
  sections that are addressed; task numbering maps cleanly onto the
  design's five decisions plus tests plus verification gates.

### Verdict: REFUTE

The overall shape of the design (cursor-home + pad, trailing-row
blanking, alternate-buffer entry/exit through the existing `quit()`/
`doAttach()` seams, resize-triggered redraw) is the right shape and the
scope decision to defer differential rendering is well justified. But two
concrete, code-grounded gaps mean the design as written would not
actually satisfy its own acceptance criteria if implemented literally as
specified.

### Change Requests

1. **Decision 1's padding mechanism is not ANSI/visible-width aware, and the
   codebase already contains, and relies on, a width-aware alternative that
   this design ignores.** Decision 1 says: "split the rendered string on
   `\n`, pad each line to `cols` with spaces, rejoin" — this reads as
   padding by raw string length (`cols - line.length`). But the very
   "outer frame" lines Decision 1 says need this padding (header/footer
   lines outside any `layout.js` box — e.g. `fleet.js`'s `f.bold('concertino')
   + f.dim(' · ' + project) + ...` at fleet.js:123, or `f.yellow(...)` status
   lines) already carry embedded ANSI SGR escape bytes from `format.js`'s
   `wrap()`. `format.js` itself documents exactly why raw `.length` is
   wrong for this (`lib/ui/format.js:142-149`, the `visibleLength`/
   `charWidth`/`padTo` block) — colour escapes inflate `.length` without
   occupying a column, and CJK/wide/zero-width code points diverge from
   `.length` the other way. Padding a coloured line to `cols` using
   `line.length` will systematically under-pad it (the escape bytes
   already "use up" budget that never occupies a terminal column), leaving
   the right edge of exactly the header/footer/status lines that use
   colour under-covered — reintroducing the "stale characters from a
   longer previous frame" failure this decision exists to prevent, and
   directly violating spec.md's own "Every redrawn line is padded to
   terminal width" scenario. This will not be caught by the design's own
   suggested test strategy either: `format.js`'s `wrap()` is gated on
   `process.stdout.isTTY` (format.js:3-4) and no-ops under non-TTY test
   harnesses, so an escape-sequence-assertion test run non-interactively
   would see plain, unescaped lines and pass even though the bug is real
   under an actual TTY. **Required revision:** Decision 1 must specify
   padding by *visible* column width — reuse `lib/ui/format.js`'s
   `visibleLength()`/`padTo()` (already the codebase's established pattern
   for exactly this problem, per `layout.js`'s own use of `f.padTo`) rather
   than introducing a second, incorrect, ad hoc padding scheme in
   `watch.js`.

2. **The existing `clear()` call inside `quit()` (watch.js:339) is never
   addressed, and its interaction with the new alternate-buffer-exit write
   is left completely unspecified.** `quit()` today calls `clear()`
   (`\x1b[2J\x1b[H`) as part of its shutdown (watch.js:334-364). Decision 1/
   Task 1.1 only says the cursor-home-only replacement is "used by the
   steady-state `draw()` path"; Decision 3/Task 2.2 says to write
   `\x1b[?1049l` "from inside the existing `quit()` function" but says
   nothing about the pre-existing `clear()` call already inside that same
   function, its ordering relative to the new `\x1b[?1049l` write, or
   whether it should be removed. This is not a cosmetic gap: if an
   implementer adds `\x1b[?1049l` without touching the existing `clear()`
   call, and that call executes *after* the alternate-buffer exit, `quit()`
   would issue a full-screen erase against the user's now-restored primary
   buffer — i.e. wipe exactly the scrollback/content the alternate-buffer
   switch was introduced to protect — directly contradicting the ticket's
   AC "quitting restores the terminal as it was" and spec.md's "Alternate
   buffer exited on quit" scenario, which only asserts `\x1b[?1049l` is
   written but says nothing about what else `quit()` may still emit
   after it. This is exactly the kind of ambiguity a competent
   implementer could resolve wrong ("keep the existing clear() call,
   just also add the new escape somewhere in the function") without any
   test in tasks.md 5.1-5.3 catching it (5.1 only checks the steady-state
   `draw()` path never emits `\x1b[2J`, not `quit()`). **Required
   revision:** design.md must explicitly state what happens to the
   existing `clear()` call inside `quit()` — most likely, remove it
   entirely (exiting the alternate buffer alone restores the prior
   primary-buffer content; no explicit erase is needed or wanted once
   `\x1b[?1049l` is emitted) — and tasks.md/spec.md should extend their
   "no `\x1b[2J`" assertion to cover the full shutdown path, not just the
   steady-state redraw.

### Non-blocking notes

- Decision 2's `lastFrameLines` tracking doesn't say whether the count
  includes the trailing `'\n'` `draw()` already appends after
  `router.render()`'s output (watch.js:319). This is a plausible source of
  an off-by-one in the cursor-row math for trailing-row blanking, but it's
  a level of detail reasonable to leave to implementation/code review
  rather than a design-level contradiction — flagging so the executor
  double-checks it against a real shrinking-frame test case.
