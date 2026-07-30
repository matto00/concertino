## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read round 1's report (`skeptic-design-1.md`) and all six current planning artifacts in full:
  `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/docview/spec.md`,
  `specs/evidence-reader/spec.md`.
- Re-read ground truth for every codebase file the revised design cites, independent of the
  orchestrator's summary:

**Gap 1 (bodyBox/renderDocView split).** Confirmed design.md's Decision 1, tasks.md 1.1/1.2/2.1, and
`specs/docview/spec.md`'s two "ADDED Requirements" now consistently name and scope both exports:
`bodyBox(bodyLines, opts)` (box-only, no title, no footer) and `renderDocView({title, body}, opts)`
(full-screen, built on `bodyBox`). Task 2.1 has `ticketview.js` call only `bodyBox`, never
`renderDocView`, and never enter `mode = 'docview'` — matching Decision 1's "Alternative considered"
rejection. Read `lib/ui/screens/ticketview.js:18-24,52-60`: its current `pane()` helper is exactly the
box-only, no-title, no-footer shape the design says `bodyBox` generalises — the refactor target is
real and precisely described.

**Gap 2 (title-rendering shape).** Design.md, tasks.md, and spec.md now agree, word-for-word, that the
title renders as a plain-text header row OUTSIDE an untitled box (never `layout.box()`'s own `title:`
option), citing `escalation.js`/`ticketview.js` as the single-pane precedent. Verified both citations
directly:
  - `lib/ui/screens/ticketview.js:44-59` — `pane(boxContent, {width, height, focused: false})` is
    called with no `title` key; the ticket identifier/title/meta/url are separate `out.push(...)` rows
    above it.
  - `lib/ui/screens/escalation.js:48-65` — same shape: `concertino · TICKET name` is a plain
    `out.push` row above `pane()`'s untitled box.
  Also re-confirmed the codebase's OTHER convention (box owns its title) is real and correctly
  distinguished from this one: `lib/ui/screens/drilldown.js:399-403,459-465` passes `title: 'TICKET'`
  / `title: timelineTitle` / `title: gatesTitle` / `title: evidenceTitle` directly into `pane()`→
  `layout.box()`, and `lib/ui/layout.js:52-83` confirms `box()`'s `title` option is real and woven into
  the border. The design's two-convention claim is accurate on both sides, and now stated identically
  in all three artifacts — no residual mismatch.

**Gap 3 (dead `docSource: 'ticket'` branch).** Design.md Decision 3a and tasks.md 4.2/4.4 now state
`watch.js` carries no `docSource` field at all; `mode = 'docview'` has exactly one real entry point
(`open-evidence-doc`), so `esc`/`back` unambiguously means "return to the drill-down." Verified this is
consistent with the rest of the design: task 2.3 keeps `ticketview.js`'s `esc` hardcoded to
`{ type: 'back-to-launchpad' }` (confirmed still true today at `ticketview.js:66-68`), never routing
through `docview`'s generic `back` action. Checked `lib/ui/router.js:22-28` and `lib/ui/watch.js`
(`mode` assignments, `currentState()`, `backToFleet()`) — the registry/mode-transition pattern the
design's task 4.5 relies on (`SCREENS` map, `render`/`handleKey` seam) is real and matches how
`ticketview` was registered (`router.js:26`, `watch.js:1020` sets `mode = 'ticketview'` directly, the
same shape task 2.1/2.3 describes for the refactored screen). No remaining reference to a `'ticket'`
docSource value anywhere in the three artifacts — the branch is genuinely gone, not just renamed.

**Gap 4 (EVIDENCE list cap + scroll-follows-selection).** Design.md Decision 3b, tasks.md 3.2, and a
new `specs/evidence-reader/spec.md` requirement ("The EVIDENCE panel's selectable list is bounded and
follows the selection into view") now mirror `timelineLines`'s existing `MAX_TIMELINE` cap by name.
Verified the precedent is real: `drilldown.js:112-125` (`const MAX_TIMELINE = 14`, the `… N earlier
events` fallback) and confirmed the CON-6/`fleet.js` citation is grounded — `fleet.js:301-341`
(`visibleWindow`) genuinely implements "keep the current selection inside the visible window" logic
(the `startOffset`/`remaining`/`shown` accounting the design describes as precedent), and `git log`
confirms `7ea12b4` ("Fleet view scrolls instead of hiding the selection past the visible window") is
real, matching the ticket's own recent-commits list. Confirmed today's `evidenceLines(run, width)`
(`drilldown.js:229-235`) is genuinely unbounded (`items.map(...)`, no cap) — the gap the new
requirement closes is real, not invented.

### Additional checks re-run from round 1 (still hold)

- Acceptance-criteria coverage: all six of `ticket.md`'s ACs still trace to a specific decision/task —
  reuse of a reader for a bounded/scrollable pane (Decision 1/2), `esc` preserves selection (new
  evidence-reader spec requirement + task 4.4), missing-file degradation (Decision 5), markdown/plain
  text + control-byte stripping (Decision 6, unchanged from round 1's verified citations), no
  false-advertised key (Decision 3 + spec.md's focus-gated requirement).
- Key-binding conflict check: re-confirmed `drilldown.js#handleKey` (now read in full again,
  `drilldown.js:483-528`) recognises only `\x1b`, `y`, `\r`, `k`, `r` — `\t` is still genuinely free.
- Scope: no drift found; the `ticketview.js` scrolling fix remains an explicitly-justified byproduct of
  sharing `bodyBox`, not unrelated scope creep, same conclusion as round 1.
- `openspec/specs/launchpad-detail-pane/spec.md` conflict check: unaffected by this round's revisions
  (the inline detail pane in `launchpad.js` still builds its own box directly, never through
  `docview`); round 1's "no spec break" finding stands and nothing in the revision touches that file.

### Verdict: CONFIRM

All four round-1 change requests are addressed with real, verifiable fixes — not just restated
claims. Each fix is internally consistent across design.md, tasks.md, and the relevant spec.md, and
each cites a real codebase precedent I independently confirmed by reading the actual files (not
trusting the orchestrator's summary). I did not find a new contradiction, placeholder, or scope gap
introduced by the revision.

### Non-blocking notes

- Design.md's decision numbering is now non-sequential (`1, 2, 3, 3a, 4, 3b, 5, 6`) — `3b` sits after
  `4` rather than immediately after `3a`. Purely cosmetic (an artifact of appending fixes in review
  order rather than renumbering), but worth tidying before this reads as the change's permanent
  history.
- `bodyBox`'s windowed-content scenario (spec.md docview Requirement 1: "a visible indication that
  more content exists") and `renderDocView`'s separate footer "scroll indicator when windowed" (task
  1.2, spec.md Requirement 2) are two distinct UI elements (an in-box "more below" style row vs. a
  footer-level indicator) that could end up visually redundant for the evidence reader, which gets
  both. Not a contradiction — plausibly deliberate (mirrors `timelineLines`'s in-box "… N earlier
  events" convention for the box half, plus a footer cue for the full-screen half) — but worth a
  one-line design call-out on exactly what each looks like so an implementer doesn't invent two
  competing "you're not at the end" affordances on the same screen.
- Round 1's two non-blocking notes (task 3.2's `k`/`r` inert-vs-disabled flexibility while focused; the
  default footer never advertising `\t` even when EVIDENCE has entries) are unchanged by this revision
  and remain non-blocking for the same reasons stated in `skeptic-design-1.md`.
