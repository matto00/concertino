## Context

`lib/ui/textwrap.js` exports a `wrap(text, width)` utility already used by
`lib/ui/screens/escalation.js:160` to render the escalation `context` field across
multiple lines. Two other call sites still use `f.truncate(text, width)` (ellipsis-clip,
single line) for the escalation *question* instead:

- `lib/ui/screens/fleet.js:288` (`renderRun`; ticket.md/design.md's original `fleet.js:196`
  reference was stale — the function is unambiguous either way) — the NEEDS YOU row, which
  composes `run.escalation.question + stale + keys` and truncates the whole composed string
  to `opts.cols - 8`.
- `lib/ui/screens/escalation.js:146` — the escalation answer screen's headline.

This is a small, localized rendering fix: no new dependency, no architectural change, no
data model change. Design doc included per the ticket's explicit acceptance criteria around
box-layout correctness (multi-line row insertion must not corrupt borders).

## Goals / Non-Goals

**Goals:**
- Replace ellipsis-truncation of the escalation question with `textwrap.wrap()` word-wrap
  at both call sites, matching the context field's existing behavior.
- On the fleet page, accommodate the wrapped question's extra line(s) in the NEEDS YOU /
  RUNNING row's height/box-layout bookkeeping so borders and adjacent rows are not
  corrupted.
- Leave short (single-line) questions rendered identically to today.

**Non-Goals:**
- Not touching the context field's rendering (already correct).
- Not changing wrapping behavior for any other field (stale marker, keys hint, ticket id,
  etc.) beyond what's needed to keep the row layout correct once the question spans
  multiple lines.
- Not introducing a new wrapping utility — reuse `textwrap.wrap()` as-is.

## Decisions

- **Reuse `textwrap.wrap()` verbatim, no new utility.** It's already proven correct for the
  context field at `escalation.js:160`; introducing a second wrapping implementation would
  invite exactly the kind of drift this ticket is fixing.
- **`escalation.js:146` (headline):** replace `f.truncate(currentQuestion, innerWidth)` with
  `textwrap.wrap(currentQuestion, innerWidth)`, joining the returned lines with `\n` (or
  pushing them as separate lines into whatever line-array the headline renderer already
  builds), matching how the context block at line 160 consumes `wrap()`'s return value.
- **`fleet.js:288` (`renderRun`, NEEDS YOU row):** separate the question from the trailing
  `stale` marker and `keys` hint before wrapping. Wrap only `run.escalation.question` via
  `textwrap.wrap(question, opts.cols - 8)` (the same budget the combined string uses today —
  no reservation of the suffix's width up front), then append `suffix = stale + keys` onto
  the wrapped block's last line, then **re-truncate that composed last line back down to
  `opts.cols - 8`** via `f.truncate(lastLine + suffix, opts.cols - 8)` before pushing it.
  Every other wrapped line (all but the last) is pushed as-is, already `<= opts.cols - 8` by
  construction of `wrap()` itself.

  This design went through two prior attempts the design gate's skeptic caught, both worth
  recording so a future reader doesn't reintroduce them:
  - *Round 1, Change Request 2:* the very first draft appended the suffix to the wrapped
    last line with no bound at all — could overflow the border whenever question + suffix
    together exceeded budget even though the question alone fit.
  - *Round 2, Change Request 1:* the fix attempted next reserved the suffix's width before
    wrapping (`wrap(question, opts.cols - 8 - suffixWidth)`), reasoning the last line could
    then never exceed budget once the suffix was appended back. This is unsound because
    `textwrap.wrap()` itself clamps its width argument (`lib/ui/textwrap.js:14`:
    `const w = Math.max(10, width)`) — whenever the reserved width fell below 10 (an
    ordinary, non-contrived case: a 40-column-floor terminal with a two-option escalation
    plus a stale marker reserves a *negative* width), `wrap()` silently wrapped against 10
    instead of the (smaller) reservation, so the "last line + suffix `<=` budget" equality
    the design relied on did not actually hold — reproduced concretely in the round-2
    report (`skeptic-design-2.md`): a 33-column composed last line against a 28-column
    budget.

  The re-truncate-after-appending approach adopted here sidesteps both failures at once,
  and needs no assumption about what width `wrap()` actually honors internally: whatever
  `wrap()` produces for the last line, `f.truncate(lastLine + suffix, opts.cols - 8)` is a
  hard, unconditional final bound — the composed line literally cannot exceed
  `opts.cols - 8` after this step, regardless of how wide `lastLine` or `suffix` turned out
  to be. It also incidentally covers the round-2 report's non-blocking note (an unusually
  long single unbroken "word" in the question, which `wrap()`'s own word-only line-breaking
  can emit wider than the requested width on its own): that, too, is caught by the same
  final `f.truncate` call, since it bounds the composed line's actual rendered width rather
  than trusting any upstream computation about what width *should* have been produced.
  For the common case — question and suffix already fit together within `opts.cols - 8`,
  today's baseline — `wrap()` returns the question as a single, unbroken line (nothing
  needed clipping), appending the suffix produces exactly today's composed string, and
  `f.truncate` on a string already within budget is a no-op (matches
  `f.truncate`'s own short-circuit for input already `<= n`) — so short questions render
  byte-for-byte as before, satisfying the "short questions... unaffected" acceptance
  criterion.

  This avoids wrapping mid-marker or mid-hint-key for the overwhelming common case (only
  the rare over-budget composed line gets ellipsis-clipped, exactly matching today's
  existing single-line-truncation behavior for that same rare case — no regression, since
  today's line was *already* an all-or-nothing truncation of question+suffix together).
  `renderRun` already returns an array of lines (`lines.push(...)` per line); this just
  pushes one line per wrapped segment instead of always exactly one, with the suffix
  appended (then re-truncated) only on the last one.
- **The real risk is `visibleWindow`'s `sectionHeight()`, not `renderRun` itself.**
  `renderRun`'s caller in `renderFleet` (the render pass) already sizes each section's box
  from the actual `contentLines.length` it collects — no separate bookkeeping needed there,
  the same pattern already used for the escalation *context* field in `escalation.js`. But
  `visibleWindow()` computes a section's height **before** any row is actually rendered, via
  `sectionHeight(s, w) => 2 + s.linesPerRow * w.shown + (...)` — a pure arithmetic estimate
  used only to decide how much to trim *other*, non-pinned sections (FAILED/DONE/etc.) so
  the whole frame fits `rows`. NEEDS YOU is `pinned: true` (never trimmed, always
  `shown = groupLen`), so a wrapped multi-line question only ever grows NEEDS YOU's own
  actual height — but if `sectionHeight()` keeps assuming a flat `linesPerRow: 2` for it
  while the real render pass now sometimes emits 3+ lines per row, `totalHeight()` will
  under-count the frame's true size, under-trim the sections below it, and the frame can
  overflow `rows` (the exact "corrupting... other rows" the acceptance criteria calls out).
  Fix: `sectionHeight()` must special-case `s.kind === 'needs-you'`, replacing
  `s.linesPerRow * w.shown` with the sum, over every run in `s.group`, of that run's actual
  `renderRun(run, { cols: innerCols }, false).length`. **`innerCols` must be derived with the
  same fallback every other field in `visibleWindow`/`renderFleet` already uses, not a bare
  `opts.cols`** — this was the design gate's round-1 Change Request 1: `opts.cols` is
  optional on this function (every existing field `visibleWindow` reads —
  `rows`/`selected`/`scrollOffset`/`queueState` — already has an `(opts && opts.X) || default`
  guard; `cols` would be the one new read with none). At least one existing caller,
  `test/fleet.test.js:2148`'s `visibleWindow(manyRuns, { rows: 12, selected: 0 })`, omits
  `cols` entirely (harmless today only because that test's group is all `status: 'done'`, so
  `sectionHeight`'s `!s.group.length` short-circuit never reaches the needs-you branch).
  Without a fallback, a future or differently-shaped caller with a non-empty needs-you group
  and no `cols` would compute `Math.max(0, undefined - 4)` = `NaN`, silently defeating both
  `f.truncate`'s `n <= 0` guard and `textwrap.wrap`'s line-break condition (`> NaN` is always
  `false`, so it would never break a line) — reintroducing exactly the
  estimate-vs-real-render drift this whole Decision exists to eliminate, just via a
  different input. Required derivation, matching the render pass's own convention
  (`renderFleet`/`buildSections` use `Math.max(40, o.cols || 80)`):
  ```js
  const cols = Math.max(40, (opts && opts.cols) || 80);
  const innerCols = Math.max(0, cols - BOX_BORDER_PADDING_COLS);
  ```
  computed once per `sectionHeight` call (or hoisted once per `visibleWindow` invocation),
  then passed to `renderRun(run, { cols: innerCols }, false).length` — **`innerCols`, not the
  raw `cols`** (design-gate round 3 caught this exact mismatch when it first appeared as a
  slip in this same paragraph). `renderRun` itself expects `opts.cols` to already be the
  *inner*, already-reduced box-content width (it subtracts a further fixed budget
  internally, e.g. `opts.cols - 8` for the escalation line, on top of whatever was already
  removed for border/padding) — the real render pass calls it as `renderRun(s.group[k],
  { cols: innerCols }, ...)` at `fleet.js:1126`, where `innerCols` is already
  border/padding-reduced. Passing the wider, un-reduced `cols` here instead would estimate
  against a budget 4 columns wider (`BOX_BORDER_PADDING_COLS`) than the real render pass
  actually uses — reintroducing the exact estimate-vs-real-render drift this whole Decision
  exists to eliminate, just via a different cause than round 1's. Reusing `renderRun`
  itself (rather than writing a second, parallel
  line-counting formula) guarantees the estimate can never drift from what actually
  renders — the same class of drift this ticket exists to fix for wrapping vs. truncation.
  RUNNING keeps the existing `linesPerRow: 2` fast path unchanged (its rows never carry a
  wrapped question — only NEEDS YOU rows do, since a run only ever hits the escalation
  branch of `renderRun` while `run.escalation` is set, which is exactly fleet's own
  `needsYou` bucketing rule).

## Risks / Trade-offs

- [A wrapped question could make the NEEDS YOU section much taller with several long-question
  runs live at once, pushing other fleet rows further down or off-screen] → Mitigation: this
  is the same trade-off the context field already accepted when it started wrapping; the
  ticket's acceptance criteria explicitly asks for this. Existing trimming behavior for
  non-pinned content (per `dashboard-visual-design`'s pane-fallback rule) is unaffected — NEEDS
  YOU itself already never scrolls off-screen.
- [Splitting `question + stale + keys` at `fleet.js:288` before wrapping could regress the
  exact positioning of the stale marker/keys hint for questions that used to fit on one line,
  or let the appended suffix push the wrapped question's last line past the border budget]
  → Mitigation: the final composed last line (wrapped question's last segment + suffix) is
  always re-truncated to `opts.cols - 8` via `f.truncate` before being pushed (see the
  Decision above, and the two prior unsound attempts recorded there) — an unconditional
  bound that holds regardless of what `wrap()` internally produced, so the border can never
  overflow. For a question that already fit within `opts.cols - 8` combined with the suffix
  (today's common case), the composed line is already within budget, so `f.truncate` is a
  no-op and rendering is byte-for-byte identical to today; verified explicitly by the
  ticket's "short questions... unaffected" acceptance criterion.

## Migration Plan

Not applicable — no data migration, no rollout sequencing. Ship as a single PR; rollback is
a plain revert if a regression surfaces.
