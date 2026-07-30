## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Verified against ticket.md, design.md (Decisions 1–6, 3a, 3b), tasks.md (all 25 items),
specs/docview/spec.md, specs/evidence-reader/spec.md:

- All six ticket ACs are addressed explicitly, not partially:
  - `docview.bodyBox`/`renderDocView` reuse the ticketview "bounded scrollable pane" shape
    (`lib/ui/screens/docview.js`), and `ticketview.js` now calls `docview.bodyBox` instead of its
    own `pane()` — the ticket's own suggested design (Decision 1, tasks 1.1–1.2, 2.1).
  - Scrolling works via `clampScroll`/`scrollDelta`, arrow/`j`/`k`/page-up/page-down, tested in
    `test/docview.test.js`.
  - `esc` from the reader dispatches `back-to-drilldown-from-doc`, which leaves
    `drillFocus`/`drillEvidenceIndex` untouched (`watch.js:1013-1019`) — selection is preserved.
  - A missing file renders `f.yellow('file not found: ' + ref)` inside the reader rather than
    blocking the open (`watch.js`'s `open-evidence-doc` case, Decision 5) — verified this path is
    reached via `try/catch` around `fs.readFileSync`.
  - Markdown is stripped via the pre-existing `markdown.toPlainText` (confirmed unmodified by this
    diff — it shipped in CON-18) and control bytes are stripped once at `format.js`'s existing
    `f.truncate` choke point — no new sanitization path.
  - The EVIDENCE panel's footer only shows `↑/↓ select`/`↵ open` while `drillFocus === 'evidence'`,
    and `k`/`r`/`↵` (attach/kill/restart) are both unadvertised AND functionally inert while
    focused (`drilldown.js:603-617` returns before reaching those branches) — no key advertised
    unless bound, verified for both focus states.
- Two deliberate deviations flagged in `files-modified.md`, evaluated against spec.md's scenarios
  rather than the literal task prose:
  1. `scrollDelta(key, viewportRows)` (two-arg) vs. the design/tasks' one-arg mention: the design's
     own prose describes page-key behavior (`{ lines: ±viewportRows }`) that is only computable with
     `viewportRows` in hand, so the one-arg signature as literally written is not implementable as
     specified. The two-arg form is required by the design's own semantics, produces byte-identical
     behavior to what every scenario in `docview/spec.md`'s "scrolling is keyboard-driven" requirement
     describes, and both callers (`docview.js`'s own `handleKey`, `ticketview.js`'s `routeHandleKey`)
     already know their own viewport budget at the call site. Accepted as an implementation-level
     correction, not a deviation from behavior.
  2. Single reserved "showing X-Y of N" row vs. task 1.7's literal "more below/above" phrasing:
     spec.md's actual requirement ("Content taller than the viewport is windowed... the render
     includes a visible indication that more content exists beyond the current window") is generic,
     not prescriptive about a specific glyph/direction. The single-row form satisfies it (Y < N is
     directly visible), and the executor's own justification — that a two-directional reservation
     would silently either drop the document's true last line or show a false "more below" at the
     max scroll offset, because `clampScroll`'s own max-offset arithmetic is computed against the
     full `viewportRows` — is verified correct by reading `windowBody`/`footerLine`'s shared
     `contentRows = viewportRows - 1` math (`docview.js:90-99`, `145-159`): both the box's content
     window and the footer's/indicator's own reported range agree at every scroll position, including
     the boundary. Confirmed by `test/docview.test.js`'s "scrolled past the end clamps to the
     document's true last line" test. Accepted — a genuine internal-consistency improvement over the
     literal task wording, not scope creep or a hidden behavior change.
- No task item is checked off without matching implementation — spot-checked tasks 1.1–1.7, 2.1–2.4,
  3.1–3.6, 4.1–4.5, 5.1–5.3 against the diff; all match.
- No scope creep: `git diff main...HEAD --stat` for `lib/`/`scripts/` touches exactly
  `router.js`, `screens/docview.js` (new), `screens/drilldown.js`, `screens/ticketview.js`,
  `watch.js` — all within this ticket's stated surface. No unrelated files changed.
- No regressions to existing behavior: `ticketview.js`'s short-content case renders byte-identical
  output to the pre-change unbounded `pane()` call (task 1.6/2.4; verified by
  `test/ticketview.test.js`'s "renders identically whether or not rows is supplied" test); the
  drill-down's default (unfocused) footer/keys are unchanged (task 3.4, tested).
- No API/schema changes — this change deliberately does not touch `evidence`/`verdict` event
  schemas or `persist-evidence.sh` (design.md Non-Goals), confirmed no diff to those files.
- Planning artifacts (design.md/tasks.md/specs) match the final implementation; the two
  disclosed deviations are the only points of prose/implementation divergence and both are
  documented in-code (`docview.js`'s own comments) and in `files-modified.md`.

### Phase 2: Code Review — PASS
Issues: none blocking.

Fresh gate run (not trusting the executor's own report), in `WORKTREE_PATH` (no `CLEAN_WORKTREE`
flag was set for this cycle):

```
npm test
```
Result: exit 0. `node --test` alone: 121 passed, 0 failed (including all of `test/docview.test.js`,
`test/drilldown.test.js`, `test/ticketview.test.js`); the full `npm test` script (node tests plus
all `test/scripts/*.sh` suites) also completed with exit 0 and no failures anywhere in the log.
Also ran `openspec validate open-evidence-artifacts --strict` (task 5.3): "Change
'open-evidence-artifacts' is valid".

No canonical code-quality standard is configured for this project (per the task brief), so
mechanical citations are scoped to the checklist items below:

- **DRY**: `docview.bodyBox`/`clampScroll`/`scrollDelta` are the single implementation both
  `renderDocView` and `ticketview.js` call — no duplicated box-drawing or scroll-key recognition
  (verified `ticketview.js`'s old `pane()` helper was removed, not left dead alongside the new
  path). `markdown.toPlainText`/`textwrap.wrap`/`format.js`'s `f.truncate` are all reused verbatim
  (confirmed pre-existing, unmodified by this diff via `git diff main...HEAD -- lib/ui/markdown.js
  lib/ui/textwrap.js` — empty). Minor nit (non-blocking): `watch.js`'s `draw()` computes
  `process.stdout.columns || 80` twice in the same tick (`watch.js:597` as `cols`, then again at
  `watch.js:629` inline) instead of reusing the already-computed `cols`.
- **Readable**: naming is clear and self-documenting throughout (`EVIDENCE_MAX_VISIBLE`,
  `DOC_CHROME_ROWS`, `evidenceWindow`); constants are named, not magic numbers.
- **Modular**: clean separation — `docview.js` stays generic (no ticket/evidence references in
  `bodyBox`/`renderDocView`, enforced by `docview.test.js`'s own source-scan test), `drilldown.js`
  owns EVIDENCE-specific windowing, `watch.js` owns the only impure I/O (`fs.readFileSync`) — matches
  design.md Decision 4's "impure read passed through opts" placement exactly, mirroring
  `ticket-text.js#resolve`.
- **Type safety**: plain JS, consistent with the rest of the codebase; no untyped escape hatches
  introduced.
- **Security**: the evidence file read is a synchronous, try/catch-guarded `fs.readFileSync` against
  a `ref` sourced from an already-durable, already-trusted `evidence`/`verdict` event field (not raw
  user input) — no path traversal surface beyond what already existed for `persist-evidence.sh`'s own
  writes; consistent with `ticket-text.js`'s existing precedent. Control-byte stripping is applied at
  the existing single choke point, not bypassed.
- **Error handling**: read failures degrade to an explicit "file not found" message rather than
  throwing or leaving a blank pane (Decision 5); a vanished run under an open drill-down was already
  handled defensively pre-change and remains so.
- **Tests meaningful**: 121 passing node tests including behavior-level assertions (byte-identical
  short-content output, clamped scroll at both ends, focus-gated key inertness, EVIDENCE cap +
  scroll-follows-selection, missing-file degradation is exercised via the `open-evidence-doc`
  read path in `watch.js` — though see note below on `watch.js`'s own wiring coverage). These tests
  would catch a real regression (e.g. reverting the byte-identical-short-content property, or
  breaking the focus gate) — not tautological.
- **No dead code**: no leftover TODO/FIXME; `ticketview.js`'s old `pane()` helper was removed
  (not left unused alongside the new `docview.bodyBox` call).
- **No over-engineering**: `docview.js`'s two-export split (bodyBox/renderDocView) is exactly what
  design.md Decision 1 calls for, with a documented rejected alternative — not a premature
  abstraction beyond what both current callers need.
- **Behavior preservation**: `ticketview.js`'s refactor is verified behavior-preserving for the
  common (fits-in-viewport) case by its own test (`test/ticketview.test.js`: "a short ticket
  description renders identically whether or not rows is supplied") and only changes behavior for
  the previously-broken overflow case (content silently cut off -> now scrollable), which is the
  ticket's own intended fix, not a drive-by change.

**Non-blocking observations** (do not affect PASS):
- `watch.js`'s `ticketviewScroll` is a single scalar never reset to `0` in the `open-ticketview`
  case (`watch.js:1163-1172`) — unlike `docScroll`, which is explicitly reset to `0` on every
  `open-evidence-doc` (design.md Decision 2, `watch.js`'s own `docTitle`/`docBody`/`docScroll` reset
  comment). Opening ticket B right after having scrolled ticket A down will carry ticket A's offset
  over (clamped to ticket B's own max on the next `draw()`, so it never goes out of range or errors,
  but ticket B may open already scrolled rather than at the top). This is not a violation of any
  ticket AC or design.md/tasks.md requirement (both are silent on ticketview's own reset-on-open
  behavior, and this scroll state didn't exist pre-change at all), so it does not block this cycle,
  but is worth a follow-up: reset `ticketviewScroll = 0` alongside `lp.viewingTicket = t.identifier`
  in the `open-ticketview` case.
- `watch.js`'s own new `applyAction` cases (`switch-drill-focus`, `move-drill-evidence`,
  `open-evidence-doc`, `doc-scroll`, `back-to-drilldown-from-doc`, `ticketview-scroll`) have no
  direct integration-level test in `test/watch.test.js`; the underlying pure logic they call
  (`evidenceItems`, `clampScroll`, `computeViewportRows`) is fully unit-tested in the screen modules'
  own test files, and `test/watch.test.js` does not integration-test any *pre-existing* `applyAction`
  case either (confirmed: no `attach`/`kill-confirmed`/`confirm-action` tests there) — so this is
  consistent with the codebase's existing test-coverage boundary, not a gap this change introduces.

### Phase 3: UI Review — N/A
Per the task brief, this project has no UI review configured for this run; dev-server steps skipped.

### Overall: PASS

### Non-blocking Suggestions
- Reset `ticketviewScroll = 0` in `watch.js`'s `open-ticketview` case so opening a different ticket
  always starts at the top rather than carrying over the previously-viewed ticket's scroll offset.
- Reuse the already-computed `cols` variable at `watch.js:629` instead of recomputing
  `process.stdout.columns || 80` a second time in the same `draw()` tick.
