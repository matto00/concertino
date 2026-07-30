## 1. docview — shared scrollable document core + full-screen reader

- [x] 1.1 Create `lib/ui/screens/docview.js`. Export `bodyBox(bodyLines, opts)` — pure, box-only:
      `opts: { width, viewportRows, scrollOffset, focused }`. Windows `bodyLines` to `viewportRows`
      via `scrollOffset`, draws through `layout.box()`/`layout.degrade()` with NO `title:` option
      (this codebase's single-pane convention — see `escalation.js`/today's `ticketview.js`, as
      distinct from `drilldown.js`'s/`launchpad.js`'s box-owns-its-title multi-panel convention), and
      no footer. This is the direct generalisation of `ticketview.js`'s current `pane()` helper.
- [x] 1.2 In the same module, export `renderDocView({ title, body }, opts)` — composes one plain-text
      title row, a `bodyBox()` call, and one footer row (`esc back`, plus a scroll indicator when
      windowed) into a complete screen, delegating all content-rendering to `bodyBox` (task 1.1)
      rather than reimplementing it.
- [x] 1.3 Add `clampScroll(bodyLineCount, viewportRows, scrollOffset)` — pure, bounds to
      `[0, max(0, bodyLineCount - viewportRows)]`.
- [x] 1.4 Add `scrollDelta(key)` — pure, returns `{ lines: ±1 }` for `↑`/`k`/`↓`/`j`,
      `{ lines: ±viewportRows }` for page-up/page-down (`\x1b[5~`/`\x1b[6~`), or `null` for any other
      key. Both `renderDocView`'s own `handleKey` (task 1.5) and `ticketview.js`'s scroll handling
      (task 2.2) call this — no second copy of scroll-key recognition.
- [x] 1.5 `renderDocView`'s `handleKey(key, state)`: scroll via `scrollDelta`/`clampScroll`, and
      `\x1b` (esc) returns a `back` action (opaque to `docview.js` — see task 4.4 for how `watch.js`
      interprets it; `docview.js` itself names no caller).
- [x] 1.6 When `body.length <= viewportRows`, `bodyBox` renders with no scroll indicator and
      byte-identical content to the unbounded case (verify against `ticketview.js`'s current golden
      output for a short ticket before wiring anything else to this module).
- [x] 1.7 When content exceeds the viewport, render a windowed slice plus a visible "more below/above"
      indicator, consistent with this codebase's existing "… N more" convention
      (`drilldown.js`'s `timelineLines`/`ticketPanelLines`).

## 2. ticketview.js — reuse the shared box core (not the full-screen reader)

- [x] 2.1 Refactor `renderTicketView` to keep its existing header rows (identifier/title/meta/url)
      and existing `esc back` footer line completely unchanged, replacing only its internal
      `pane(boxContent, {...})` call with `docview.bodyBox(boxContent, {...})`, passing a viewport
      row budget instead of `boxContent.length + 2`. `ticketview.js` does NOT call `renderDocView`
      and does NOT enter `mode = 'docview'` — it stays `mode = 'ticketview'`, unchanged.
- [x] 2.2 Thread a scroll offset through `ticketview.js`'s `render`/`handleKey` seam (reads from
      `state`, same as today's `findTicket`), using `docview.scrollDelta`/`docview.clampScroll`
      (task 1.4/1.3) for the scroll-key logic, wired to `watch.js`'s own scroll variable for this
      screen (see 4.1).
- [x] 2.3 `esc` from `ticketview.js` continues to dispatch `{ type: 'back-to-launchpad' }` directly,
      exactly as today — this is `ticketview.js`'s own hardcoded routing, never delegated to
      `docview.js`'s generic `back` action (that action is used only by the evidence reader; see
      design.md Decision 3a).
- [x] 2.4 Manually verify: a short ticket description renders identically to pre-change output; a
      long one (longer than one screen) is now scrollable instead of overflowing off-screen.

## 3. drilldown.js — EVIDENCE panel focus, selection, and bounded/scrolling list

- [x] 3.1 Add `drillFocus` (`null | 'evidence'`) and `drillEvidenceIndex` handling to
      `renderDrillDown`/`handleKey`: `\t` toggles focus (no-op, not advertised, when
      `evidenceLines()` would render the "no evidence recorded" fallback).
- [x] 3.2 Add an `EVIDENCE_MAX_VISIBLE` row cap to `evidenceLines()` (same constant shape as
      `timelineLines`'s `MAX_TIMELINE`). Unfocused: show the leading entries up to the cap, followed
      by a `… N more` row (mirrors `timelineLines`'s `… N earlier events`) when more exist. Focused:
      window instead follows `drillEvidenceIndex` so the selected entry is always visible — same
      "selection stays visible" principle CON-6 established for `fleet.js`'s own scrolling
      (`visibleWindow`), adapted here to a flat (non-sectioned) list.
- [x] 3.3 When `drillFocus === 'evidence'`, render the EVIDENCE panel with `focused: true` (see
      `layout.box`'s existing option), highlight the selected entry, and change the footer hint set
      to the evidence-selection/open keys — omitting `↵ attach`/`k kill`/`r restart` from the hint
      text while focused (their key bindings may remain inert-but-unadvertised, or be disabled
      entirely — pick whichever keeps `handleKey` simplest, per design.md Decision 3).
- [x] 3.4 When `drillFocus` is not `'evidence'`, footer hints and key bindings are byte-for-byte
      unchanged from before this change.
- [x] 3.5 `↑`/`k`, `↓`/`j` move `drillEvidenceIndex`, clamped to the evidence list's bounds, and
      trigger the scroll-follows-selection windowing from task 3.2.
- [x] 3.6 `↵` while EVIDENCE is focused with a selected entry returns an `open-evidence-doc` action
      (ticket, ref, label) for `watch.js` to carry out — never reads the file itself (renderer stays
      pure).

## 4. watch.js — wiring

- [x] 4.1 Add `drillFocus`/`drillEvidenceIndex` to the drill-down's tracked sub-state (alongside
      `drillTicket`/`drillConfirm`/`drillNotice`), included in `currentState()`, reset by
      `backToFleet()` exactly as the existing drill-down fields are. Also add `ticketviewScroll`
      (or equivalent), the scroll variable `ticketview.js`'s own reuse of `bodyBox` needs (task 2.2) —
      independent of and never confused with the evidence reader's own scroll state below.
- [x] 4.2 Add `docScroll` (reset to `0` on every `open-evidence-doc` action) for the evidence reader's
      own `mode = 'docview'` state. No `docSource` discriminator: per design.md Decision 3a,
      `mode = 'docview'` is entered ONLY via `open-evidence-doc`, so its `esc`/`back` action always
      means "return to the drill-down" — there is nothing to discriminate.
- [x] 4.3 Handle `open-evidence-doc`: synchronously `fs.readFileSync` the given `ref` (try/catch,
      mirroring `ticket-text.js#resolve`'s existing pattern), set `mode = 'docview'`, store
      `{ title, body }` (body = `markdown.toPlainText(content)` wrapped to the reader's width — or,
      on read failure, the "file not found" fallback line from design.md Decision 5).
- [x] 4.4 Handle the doc reader's `back` action (fired only from `mode = 'docview'`, i.e. only ever
      the evidence reader per 4.2): return to `mode = 'drilldown'` with `drillFocus`/
      `drillEvidenceIndex` untouched (still selected). `ticketview.js`'s own `esc` (task 2.3) never
      reaches this handler — it dispatches `back-to-launchpad` directly, as today.
- [x] 4.5 Register `docview` in `lib/ui/router.js`'s `SCREENS` map (its `render`/`handleKey` seam
      wraps `renderDocView`/its `handleKey`, per the router's existing per-screen contract).

## 5. Verification

- [x] 5.1 Run this project's existing test suite; add/extend unit tests for `docview.js`
      (`clampScroll`, `scrollDelta`, `bodyBox` windowing short-vs-long content, `renderDocView`
      composing `bodyBox` unchanged) and `drilldown.js` (focus toggle inert with no evidence; footer
      hint set per focus state; selection index clamped; EVIDENCE cap + scroll-follows-selection).
- [x] 5.2 Manually drive a real run with several evidence entries (including at least one
      evaluator/skeptic report long enough to require scrolling, and enough entries to exceed
      `EVIDENCE_MAX_VISIBLE`) through the dashboard: select, open, scroll, esc back with selection
      preserved, and a deliberately-removed evidence file's "file not found" degradation.
- [x] 5.3 `openspec validate open-evidence-artifacts --strict` passes.
