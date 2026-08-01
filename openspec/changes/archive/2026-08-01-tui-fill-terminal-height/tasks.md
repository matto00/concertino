## 1. escalation.js — grow the content box (design.md Decision 2)

- [x] 1.1 Add the `budget = opts.rows > 0 ? opts.rows - 1 : 0` computation to
      `renderEscalation` (mirroring `fleet.js`'s identical convention).
- [x] 1.2 Compute `usedSoFar` as `out.length` at the point the box is about to
      be pushed, plus the known fixed row cost of everything that follows the
      box in this screen (the meta line, the "writes answer.json…" hint, the
      optional reply/notice blocks, the blank separators, and the footer line)
      — mirror `launchplan.js`'s existing `belowBoxRows` reservation pattern.
- [x] 1.3 Change `boxHeight` (currently `boxContent.length + 2`) to
      `Math.max(naturalBoxHeight, budget - usedSoFar)` when `budget > 0`,
      unchanged (`naturalBoxHeight`) otherwise.
- [x] 1.4 Verify the reply/notice/stale variants (which change what follows the
      box) still compute `usedSoFar` correctly for each variant — the reserved
      row count for "what follows" differs by state.

## 2. launchplan.js — grow the ticket-list box (design.md Decision 3)

- [x] 2.1 Change `boxHeight` (line 226, currently `boxContent.length + 2`) to
      `rows > 0 ? Math.max(boxContent.length, ticketViewportRows) + 2 :
      boxContent.length + 2`, reusing the `ticketViewportRows` already
      computed at line 221 — no new budget arithmetic needed.
- [x] 2.2 Confirm a long batch (exceeding `ticketViewportRows`) still windows
      exactly as before — `boxContent` itself is already clamped by
      `docview.windowBody`, so `Math.max` should be a no-op in that case; add
      a test asserting this explicitly.

## 3. docview.js — grow `bodyBox` when given a finite viewport (design.md Decision 4)

- [x] 3.1 Change `bodyBox`'s `height` computation (currently
      `content.length + BOX_BORDER_ROWS`) to grow to
      `Math.max(content.length, viewportRows) + BOX_BORDER_ROWS` when
      `Number.isFinite(viewportRows)`, and leave it as `content.length +
      BOX_BORDER_ROWS` when `viewportRows` is `Infinity` (unbounded — the
      absent/`0` `rows` case).
- [x] 3.2 Update `bodyBox`'s own comment block (currently describing the old
      "sized to the content itself" behavior) to describe the new grow
      behavior and why unconditional growth is safe today (only two callers,
      both full-screen — design.md's Decision 4 and its logged risk).
- [x] 3.3 Confirm `renderDocView` (evidence reader) and `ticketview.js` (full-
      screen ticket viewer) both now grow correctly, and that windowed/
      scrolled content (taller than the viewport) is unaffected.

      **Root-cause fix discovered during implementation (executor, not in
      design.md's original task list):** `ticketview.js`'s own
      `computeViewportRows` reserved its surrounding chrome rows (id/title,
      meta, blank separators, footer — `CHROME_ROWS_BASE`) but never reserved
      `bodyBox`'s own two border rows, unlike `docview.js`'s own
      `DOC_CHROME_ROWS = 4 + BOX_BORDER_ROWS`, which does. This was a latent,
      pre-existing off-by-2 overflow (confirmed via `git stash` against the
      pre-change source: a 60-line description at `rows: 20` already produced
      21 lines against a 19-line `rows - 1` budget, unrelated to this
      change) — previously only exercised when a description needed
      windowing (rare). Once `bodyBox` grows unconditionally to fill a finite
      viewport (Decision 4), the SAME miscount now overflows on every single
      `rows`-bounded render, not just the windowed case, directly
      threatening AC #2 ("without overflowing"). Fixed by adding a
      `BOX_BORDER_ROWS = 2` constant to `ticketview.js`, mirroring
      `docview.js`'s own pattern exactly, and including it in
      `computeViewportRows`'s reserved `chrome`. Regression test:
      `test/ticketview.test.js`'s "computeViewportRows reserves the box
      border rows, not just the surrounding chrome".

## 4. Spec deltas and evidence

- [x] 4.1 Confirm `openspec/changes/tui-fill-terminal-height/specs/
      dashboard-full-height-layout/spec.md` (new capability) and `specs/
      docview/spec.md` (modified capability) match the shipped behavior —
      adjust scenario wording only if implementation details in tasks 1-3
      diverge from what's currently drafted (they should not).

## 5. Tests

- [x] 5.1 `test/escalation.test.js`: add a `fleet.test.js`-style pair of
      tests — "grows to fill available height given a generous `rows`" and
      "unbounded rendering (`rows` absent/0) is unaffected" — asserting line
      count bounds and that the footer/hint line is still the frame's last
      line.
- [x] 5.2 `test/escalation.test.js`: add a "tight budget still shrinks/degrades
      as before" regression test using a `rows` value below the content's
      natural height.
- [x] 5.3 `test/launchplan.test.js`: add the same three-test shape (grows /
      unbounded-unaffected / long-batch-still-scrolls) for the ticket-list box.
- [x] 5.4 `test/docview.test.js`: add tests for `bodyBox` growing to
      `viewportRows` when content is shorter, staying unbounded/natural-height
      when `viewportRows` is `Infinity`, and continuing to window (not grow
      past) content taller than `viewportRows`.
- [x] 5.5 `test/ticketview.test.js`: add a test confirming the full-screen
      ticket viewer's box now grows to fill a generous `rows` budget.
- [x] 5.6 Run the full suite (`npm test`) and confirm no existing test (in
      particular `fleet.test.js`, `drilldown.test.js`, `launchpad.test.js`,
      the `dashboard-render-loop`-adjacent tests in `watch.test.js`) regresses.

## 6. Manual verification

- [x] 6.1 Live reproduction already done during planning (round-1 skeptic
      design-gate REFUTE — see `skeptic-design-1.md` — correctly rejected an
      earlier draft's false claim that no live terminal was available; tmux
      is present and this repo's own `test/scripts/watch-smoke.test.sh`
      already drives `concertino watch` against real tmux sessions). Measured
      against a 100×30 terminal via `tmux capture-pane`: `escalation.js`
      leaves 12 blank rows, `launchplan.js` leaves 11, `docview.js`/
      `ticketview.js` leaves 17 — see design.md's Context section, "Live
      reproduction" subsection, for the full transcript-derived numbers. This
      satisfies the ticket's AC #1.
- [x] 6.2 After implementing tasks 1-3, re-run the same three tmux
      reproductions (escalation, launchplan, ticketview) at the same 100×30
      size and confirm each now renders through row 29 (the `rows - 1`
      reserved-row convention), with the footer as the last non-blank row and
      no overflow/scroll artifact — i.e. the AC #2 fix is verified live, not
      just via unit tests.

      **Done.** A live tmux session (`tmux new-session -x 100 -y 30`) ran
      `bin/concertino watch --out=<workdir>` directly as the pane's own
      process (real `process.stdout.rows`/`.columns`, not a piped-stdin
      double) against a seeded escalation run and a seeded launch-pad ticket
      cache, driven with real `tmux send-keys` (Enter to open the
      escalation, `N`→Tab→Space→`L` to open the launch plan, Enter on a
      ticket to open the ticket viewer) and inspected with real
      `tmux capture-pane`. All three screens now render through row 29 with
      their own footer (`a approve   d deny   t reply   ↵ attach   esc back`;
      `↵ confirm & launch   c concurrency   m agent-merge   s speed   n hold
      esc cancel`; `esc back`) as the last non-blank line, and row 30 stays
      genuinely blank in every capture — matching the fleet/drilldown/
      launch-pad screens' own existing convention and the pre-fix repro's
      exact same 100×30 terminal from design.md's Context section.
