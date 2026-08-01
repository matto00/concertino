## 1. Escalation answer screen headline (`lib/ui/screens/escalation.js`)

- [x] 1.1 Replace `boxContent.push(f.truncate(currentQuestion, innerWidth));`
      (around line 146) with `textwrap.wrap(currentQuestion, innerWidth)`,
      pushing one `boxContent` line per wrapped line — the same pattern
      already used for `esc.context` a few lines below.
- [x] 1.2 Confirm `textwrap` is already imported in this file (it is, for the
      context field); no new import needed.
- [x] 1.3 Confirm no other code in this file assumes the question occupies
      exactly one `boxContent` entry (e.g. an index-based lookup) — `pane()`/
      `naturalBoxHeight = boxContent.length + 2` already size from the array's
      actual length, so this should be a drop-in change.

## 2. Fleet NEEDS YOU row (`lib/ui/screens/fleet.js`)

- [x] 2.1 Add `const textwrap = require('../textwrap');` near this file's
      other top-of-file `require`s (it currently has none — only
      `escalation.js` imports it today; design gate round 1 non-blocking
      note).
- [x] 2.2 In `renderRun` (around line 288), stop composing
      `run.escalation.question + stale + keys` into one `f.truncate(...)`
      call. Compute `const suffix = stale + keys;`, wrap only
      `run.escalation.question` via `textwrap.wrap(question, opts.cols - 8)`,
      then append `suffix` onto the wrapped block's last line only, then
      **re-truncate that composed last line** via
      `f.truncate(lastLine + suffix, opts.cols - 8)` before pushing it — do
      NOT reserve `suffix`'s width before wrapping (that approach was tried
      and REFUTEd at design-gate round 2: `textwrap.wrap`'s internal
      `Math.max(10, width)` floor silently ignores a reservation that drops
      the wrap width below 10, which is an ordinary case at this file's own
      40-column terminal floor, not a contrived one — see design.md's
      Decision for the full round-1/round-2 history and why the
      re-truncate-after-appending approach is the one that actually holds).
      Push every other wrapped line (all but the last) as-is (indented
      `'      '`, coloured `f.yellow`, matching today's single line's
      styling) — only the last line needs the append + re-truncate step.
      For a question that already fits combined with the suffix (today's
      common case), the composed last line is already within budget, so
      `f.truncate` is a no-op and rendering is unchanged.
- [x] 2.3 In `visibleWindow`'s `sectionHeight(s, w)` (around line 849-867),
      special-case `s.kind === 'needs-you'`: instead of
      `s.linesPerRow * w.shown`, sum each run in `s.group`'s actual rendered
      line count via `renderRun(run, { cols: innerCols }, false).length`,
      where `cols = Math.max(40, (opts && opts.cols) || 80)` (the same
      fallback `buildSections`/`renderFleet` already use for every other
      `cols` read in this file — design gate round 1, Change Request 1:
      `opts.cols` is optional on `visibleWindow`, and at least one existing
      test caller, `test/fleet.test.js:2148`, omits it; a bare
      `opts.cols - 4` would silently compute `NaN` and defeat both
      `f.truncate`'s and `textwrap.wrap`'s guards for any future caller with
      a non-empty needs-you group and no `cols`) and
      `innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS)` — **pass
      `innerCols`, not the raw `cols`, to `renderRun`**, matching the real
      render pass at `fleet.js:1126` (`renderRun(s.group[k], { cols:
      innerCols }, ...)`) exactly. Passing the un-reduced `cols` here would
      estimate against a 4-column-wider budget than the real render pass
      uses — reintroducing the same class of estimate-vs-real-render drift
      as Change Request 1, just via a different cause (design-gate round 3
      caught this exact mismatch). Leave the `kind === 'running'` (and every
      other kind's) path on the existing `linesPerRow` fast multiply — only
      NEEDS YOU rows can carry a wrapped, multi-line question.
- [x] 2.4 Double check `opts`/`BOX_BORDER_PADDING_COLS` are in scope where
      `sectionHeight` is defined (both already are, per design.md) — no new
      parameter threading required.

## 3. Verification

- [x] 3.1 Add or extend a unit test (wherever `fleet.js`/`escalation.js`
      already have coverage, e.g. `test/ui/`) with a synthetic escalation
      question long enough to overflow an 80-column terminal, asserting: (a)
      it renders across multiple lines instead of ending in `…`, (b) box
      borders in the rendered frame remain intact (no misaligned border
      characters), and (c) other sections/rows are not corrupted or
      overlapped.
- [x] 3.2 Add or extend a test asserting a short question (fits on one line)
      renders identically to before this change on both screens.
- [x] 3.3 Run the project's existing test suite for the UI package and
      confirm no regressions.
- [x] 3.4 Manually sanity-check (or script) rendering fleet.js's NEEDS YOU
      section and escalation.js's headline at a narrow width (e.g. 80 cols)
      with a long synthetic question, confirming the acceptance criteria
      visually.
