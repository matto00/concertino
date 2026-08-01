## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `proposal.md`, `design.md`, `tasks.md`, `ticket.md` under
  `openspec/changes/wrap-escalation-question-text/`, plus prior
  `skeptic-design-1.md`/`skeptic-design-2.md` (treated as claims, re-derived
  independently below).

- **Round 1/round 2 gap (re-truncate-after-appending) — confirmed closed,**
  verified directly against the real source, not the design's narrative:
  - `lib/ui/textwrap.js:13-14`: `wrap()`'s internal floor is
    `const w = Math.max(10, width)`. The new design no longer reserves the
    suffix's width before calling `wrap()` — it wraps the bare question
    against the untouched `opts.cols - 8`. Since `renderRun`'s `opts.cols` is
    always the render pass's `innerCols` (`fleet.js:1126`:
    `renderRun(s.group[k], { cols: innerCols, avgDoneMs }, ...)`, and
    `innerCols = Math.max(0, Math.max(40, o.cols||80) - BOX_BORDER_PADDING_COLS)`,
    i.e. `>= 36`), `opts.cols - 8 >= 28` — always well clear of the width-10
    floor. Round 2's failure mode (reservation subtracting the wrap width
    below 10) cannot recur because there is no longer a reservation subtracted
    from the wrap width at all.
  - `lib/ui/format.js:259-293` (`truncate(s, n)`): read the full function.
    Confirmed it is an **unconditional bound** for any input: `n <= 0` returns
    `''`; `visibleLength(str) <= n` returns `str` unchanged (a true no-op,
    matching the design's "short questions render byte-for-byte as before"
    claim); otherwise it clips to `n - 1` visible columns and appends a
    1-column ellipsis, so the result's visible width is always `<= n`
    regardless of the input's actual length. This directly substantiates
    design.md's central claim: `f.truncate(lastLine + suffix, opts.cols - 8)`
    really is a hard final bound independent of whatever width `wrap()`
    produced upstream. The gap that sank rounds 1 and 2 is closed.
  - Confirmed both call sites this design touches
    (`lib/ui/screens/fleet.js:288`/`renderRun`,
    `lib/ui/screens/escalation.js:146`) still match the "current baseline"
    description in design.md/ticket.md (`f.truncate(question+stale+keys, ...)`
    and `f.truncate(currentQuestion, innerWidth)` respectively), and that
    `textwrap` is already imported in `escalation.js` (task 1.2's claim) but
    not in `fleet.js` (task 2.1's claim) — both correct.

- **New contradiction found in tasks.md 2.3 vs. design.md's own code block**
  for the same fix (this is the actionable finding of this round — see Change
  Request below).

### Verdict: REFUTE

### Change Requests

1. **`tasks.md` task 2.3 contradicts `design.md`'s own prescription for the
   same fix, and would reintroduce an estimate-vs-real-render drift bug if
   implemented as literally written.**

   - `design.md` lines 125-139 computes, for `sectionHeight`'s `needs-you`
     special case:
     ```js
     const cols = Math.max(40, (opts && opts.cols) || 80);
     const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
     ```
     and explicitly requires passing `renderRun(run, { cols: innerCols }, false).length`
     — stating this must "reuse the *already-inner* `cols` value consistently,
     not the raw section/box width, so the estimate and the real render pass
     are computing off the exact same number," matching the real render
     pass's own call at `fleet.js:1126`:
     `renderRun(s.group[k], { cols: innerCols, avgDoneMs }, ...)`.
   - `tasks.md` task 2.3, however, instructs: sum line counts via
     `renderRun(run, { cols }, false).length`, where
     `cols = Math.max(40, (opts && opts.cols) || 80)` — i.e. it defines only
     the **raw box-width** variable and passes *that* directly as `renderRun`'s
     `cols` field. It never computes or mentions `innerCols`, and never
     subtracts `BOX_BORDER_PADDING_COLS` (4) before passing to `renderRun`.
   - Concretely: `renderRun` internally wraps the escalation question against
     `opts.cols - 8`. If `sectionHeight`'s estimate passes the raw box width
     (per tasks.md 2.3) while the real render pass at `fleet.js:1126` passes
     `innerCols` (`boxCols - 4`), the estimate wraps against a budget 4
     columns *wider* than what actually renders. A question whose true
     wrapped-line count differs between a `cols - 8` and a `cols - 12` budget
     (an ordinary case, not a contrived one — this 4-column gap is present on
     every call, not just an edge case) makes `sectionHeight()` under-count
     NEEDS YOU's real height, under-trims the sections below it, and can
     overflow the frame — precisely the "corrupting... other rows" failure
     the ticket's acceptance criteria calls out ("Row/box layout accommodates
     the extra line(s) without corrupting the box borders or other rows"),
     and precisely the class of drift this same Decision item's closing
     sentence says reusing `renderRun` "guarantees... can never drift from
     what actually renders."
   - Required revision: rewrite tasks.md 2.3 to match design.md's own code
     block verbatim — compute `innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS)`
     and pass `renderRun(run, { cols: innerCols }, false).length`, not
     `renderRun(run, { cols }, false).length`.

### Non-blocking notes

- Confirmed `opts` and `BOX_BORDER_PADDING_COLS` are genuinely in scope where
  `sectionHeight` is defined (it's a closure inside `visibleWindow(runs, opts)`,
  and `BOX_BORDER_PADDING_COLS` is a module-level `const` at `fleet.js:38`) —
  task 2.4's claim is correct and needs no revision.
