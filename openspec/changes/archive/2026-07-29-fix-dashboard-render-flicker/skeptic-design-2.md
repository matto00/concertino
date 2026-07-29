## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/dashboard-render-loop/spec.md` in full (current, revised state).
- Read `skeptic-design-1.md` — the prior cold skeptic's two required
  revisions — as a *claim to verify*, not as ground truth.
- Read `lib/ui/watch.js`, `lib/ui/format.js`, and `lib/ui/session.js` in
  full, fresh, as ground truth.

**Round-1 CR #1 (padding not visible-width aware):** Confirmed resolved.
`design.md` Decision 1 (lines 42-88) now explicitly requires reusing
`format.js`'s `padTo`/`visibleLength`, states the ANSI-under-padding failure
mode by name, and rejects raw-`.length` padding as an alternative with
reasoning. `tasks.md` 1.2 and 5.1a mirror this instruction and add a
visible-width assertion test. `spec.md`'s "A coloured line is padded
correctly, not under-padded" scenario matches. Verified against code:
`format.js:299-302` exports `padTo`/`visibleLength` as claimed;
`format.js:284-291`'s `padTo` is genuinely visible-column-aware (truncates
via `visibleLength`, pads by visible width). Verified the underlying
premise (that outer-frame lines aren't already padded to `cols`) is still
true: `fleet.js:123`'s header line uses `f.bold`/`f.dim` and is only
conditionally truncated at `fleet.js:275` (`f.visibleLength(l) > cols ?
truncate : l`), never padded up to `cols`.

**Round-1 CR #2 (`quit()`'s `clear()` call unaddressed):** Confirmed
resolved. Ground truth: `watch.js:339` still calls `clear()` inside `quit()`
today (pre-change). `design.md` Decision 3 (lines 123-139) now explicitly
states the call "must be removed, not left in place," gives the full
revised `quit()` sequence, and rules out every alternative ordering with
reasoning. `tasks.md` 2.2 states the same in bold. `spec.md`'s "No
full-screen clear on shutdown" and "Alternate buffer exited on quit"
scenarios cover it. `tasks.md` 5.1 was also broadened to assert no
`\x1b[2J` across both the `draw()` path AND the `quit()` shutdown path,
closing the round-1 test-coverage gap.

**Other four ACs, re-verified fresh (not assumed carried over):**
- No blank frame → Decision 1 / spec Req 1 — sound.
- Scrollback preserved + attach round-trip → Decisions 3-4 / spec Req
  3-4, cross-checked against `session.js:137-139`'s
  `spawnSync(..., {stdio:'inherit'})` and the pre-existing `try/finally`
  in `doAttach()` (`watch.js:373-383`), which the design correctly extends
  rather than replaces.
- Shrinking-frame stale rows → Decision 2 / spec Req 2 — sound, and the
  `lastFrameLines` accounting note (flagged non-blocking in round 1) is
  still only an implementation-level detail, not a design contradiction.
- Resize reflow → Decision 5 / spec Req 5 — cross-checked that
  `process.stdout.columns`/`.rows` are read fresh per call
  (`watch.js:316-317`), matching the design's claim that no cached
  dimension state needs invalidating.

**tasks.md / spec.md internal consistency:** task numbering maps cleanly
onto the five decisions plus tests/verification gates; no contradictions
between design.md, tasks.md, and spec.md found. Confirmed via `grep` that
all three quit-triggering paths described in the design
(`fleet.js:311,336` returning `{type:'quit'}` for `q`/Ctrl-C via the
router, `watch.js:363-364`'s `stdin.on('end'/'close', quit)`) actually
exist as described. No `TODO`/`TBD`/deferred-decision placeholders
anywhere in the change directory.

### Verdict: CONFIRM

Both round-1 change requests are genuinely resolved in the current
artifacts (not just asserted) — the padding decision now names and
requires the correct existing utility, and the `quit()`/`clear()`
interaction is now explicit and consistent across design, tasks, and spec.
Re-verifying the other four ACs from scratch turned up no regressions
introduced by the revision, and design/tasks/spec remain internally
consistent.

### Non-blocking notes

- (Carried from round 1, still true) Decision 2's `lastFrameLines`
  tracking doesn't spell out whether the count includes the trailing
  `'\n'` `draw()` already appends after `router.render()`'s output — a
  plausible off-by-one source in the cursor-row math, left to
  implementation/code review rather than a design-level gap.
- Task 1.1's wording ("replace `clear()`'s `\x1b[2J\x1b[H` with a
  cursor-home-only write... used by the steady-state `draw()` path") is
  slightly underspecified on whether the *same* shared `clear()` function
  is repurposed for both call sites or whether `draw()` gets a distinct
  helper. This is resolved in practice by Decision 3/Task 2.2's explicit
  instruction to delete the call inside `quit()` entirely, so it does not
  block soundness — but the executor should not assume redefining
  `clear()`'s body alone is sufficient without also acting on Task 2.2.
