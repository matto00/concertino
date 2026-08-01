- `lib/ui/screens/escalation.js` — `renderEscalation`'s content box grows to fill the terminal's
  available rows (`Math.max(naturalBoxHeight, budget - usedSoFar)`), reserving the same
  `rows - 1` trailing-newline row every other grow-to-fill screen already reserves; unbounded
  (`rows` absent/0) and tight-budget (below natural height) cases are unchanged (design.md
  Decision 2).
- `lib/ui/screens/launchplan.js` — `renderLaunchPlan`'s ticket-list box now grows to the same
  `ticketViewportRows` budget it already computes for scrolling, instead of sizing to the
  (possibly shorter) natural content height of the current batch; a batch too long for that
  budget still windows exactly as before (design.md Decision 3).
- `lib/ui/screens/docview.js` — `bodyBox`'s height grows to
  `Math.max(content.length, viewportRows) + BOX_BORDER_ROWS` whenever a finite `viewportRows` is
  given (both current callers — `renderDocView`/the evidence reader, and `ticketview.js` — are
  full-screen compositions that want this); stays at natural content height when `viewportRows`
  is `Infinity` (design.md Decision 4).
- `lib/ui/screens/ticketview.js` — root-cause fix discovered while implementing task 3.3, not in
  design.md's original task list: `computeViewportRows` never reserved `bodyBox`'s own two border
  rows (unlike `docview.js`'s own `DOC_CHROME_ROWS`), a latent pre-existing off-by-2 overflow that
  only manifested when a description needed windowing before this change, but would overflow on
  EVERY finite-`rows` render once `bodyBox` grows unconditionally. Added a local
  `BOX_BORDER_ROWS = 2` constant, mirroring `docview.js`'s pattern, and included it in the
  reserved `chrome`.
- `test/escalation.test.js` — grow-to-fill tests (generous budget grows to `rows - 1`, footer
  last; unbounded unaffected; tight budget unaffected/byte-identical; each of the
  stale/reply/reply-with-error/notice trailing-row variants still grows to the same budget).
- `test/launchplan.test.js` — grow-to-fill tests (small batch grows to fill; small batch with the
  already-active warning still grows; large batch still windows/scrolls unaffected; unbounded
  unaffected).
- `test/docview.test.js` — `bodyBox` grows to a finite `viewportRows` when content is shorter;
  unaffected when `viewportRows` is `Infinity`; unaffected when content exactly fills or exceeds
  the viewport (still windows, never grows past it); `renderDocView`'s own composition grows to
  fill the terminal, footer as the last line.
- `test/ticketview.test.js` — updated the pre-existing "renders identically whether or not rows is
  supplied" test (its assumption was invalidated by design — a finite `rows` is now expected to
  grow the box) to instead assert unbounded (`rows: 0`) is unaffected; added tests for growth with
  a finite budget, growth staying within the `rows - 1` budget across a range of realistic
  terminal heights, and a regression test for the `BOX_BORDER_ROWS` root-cause fix above.
