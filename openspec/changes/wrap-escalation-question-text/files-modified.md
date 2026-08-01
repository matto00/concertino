- `lib/ui/screens/escalation.js` — replaced `f.truncate(currentQuestion, innerWidth)` for the
  question headline with `textwrap.wrap(currentQuestion, innerWidth)`, pushing one `boxContent`
  line per wrapped line (same pattern already used for `esc.context` a few lines below).
- `lib/ui/screens/fleet.js` — (1) added `const textwrap = require('../textwrap');`; (2) in
  `renderRun`, stopped composing `run.escalation.question + stale + keys` into a single
  `f.truncate(...)` call — now wraps only the question via
  `textwrap.wrap(question, opts.cols - 8)`, appends the `stale + keys` suffix to the wrapped
  block's last line only, then re-truncates that composed last line via
  `f.truncate(lastLine + suffix, opts.cols - 8)` as an unconditional final bound; (3) in
  `visibleWindow`'s `sectionHeight(s, w)`, special-cased `s.kind === 'needs-you'` to sum each
  run's actual `renderRun(run, { cols: innerCols }, false).length` (with `cols`/`innerCols`
  derived exactly as the real render pass does) instead of the flat `linesPerRow * shown`
  multiply, so the height estimate can never drift from what actually renders.
- `test/escalation.test.js` — added a test asserting a long question wraps across multiple
  lines (no ellipsis, no words dropped) and a test asserting a short question still renders on
  exactly one line, unchanged.
- `test/fleet.test.js` — added tests asserting: a long escalation question wraps onto
  additional lines instead of being ellipsis-clipped; the wrapped block's last line still
  carries the stale/options suffix and box borders/adjacent sections stay intact; a short
  question renders identically to before this change.
