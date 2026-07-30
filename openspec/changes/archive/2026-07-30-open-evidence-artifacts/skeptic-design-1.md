## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/docview/spec.md`,
  `specs/evidence-reader/spec.md` in full.
- Read ground truth for every file the design claims to touch or mirror:
  `lib/ui/screens/drilldown.js`, `lib/ui/screens/ticketview.js`, `lib/ui/router.js`,
  `lib/ui/watch.js`, `lib/ui/layout.js`, `lib/ui/markdown.js`, `lib/ui/format.js`,
  `lib/ui/ticketDetail.js`, `lib/ui/ticket-text.js`, `lib/ui/screens/launchpad.js`
  (grep for its `\t`/pane-switch handling), and
  `openspec/specs/launchpad-detail-pane/spec.md`.
- Confirmed the design's claim that `drilldown.js#handleKey` currently recognises only
  `\x1b`, `y` (via the confirm branch), `\r`, `k`, `r` — no `\t` — so a new `\t` focus-switch
  key is genuinely free (drilldown.js:487-530). Matches design.md's risk log.
- Confirmed `launchpad.js`'s existing `\t` → `switch-pane` pattern (`lib/ui/screens/launchpad.js:404-406`)
  and its `focused` border option threaded into `layout.box()` (`layout.js:23-26,55-63`) — the
  precedent Decision 3 claims to mirror is real and shaped the way the design describes.
- Confirmed `ticketview.js`'s box is genuinely unbounded today (`boxHeight = boxContent.length + 2`,
  ticketview.js:59) — the design's stated motivation for adding real scrolling (not just relabeling
  a "solved" problem the ticket's own wording assumes) is accurate and the design explicitly
  corrects the ticket's premise rather than silently trusting it — good instinct.
- Confirmed `markdown.toPlainText` and `format.js`'s `stripUnsafeControls`/`f.truncate` choke point
  exist and are used the way Decision 6 claims (markdown.js:55-88, format.js:125,228-265).
- Confirmed `ticket-text.js#resolve`'s synchronous `fs.readFileSync` + try/catch precedent Decision 4
  cites is real (ticket-text.js:90-97).
- Checked `openspec/specs/launchpad-detail-pane/spec.md` for a conflict with bounding
  `ticketview.js`'s box: its "Detail pane renders at full height when space allows" scenario
  compares the inline pane to "ticketview.js's own unbounded-height content" — not violated,
  since the inline detail pane in `launchpad.js` builds its own box independently of `docview`
  (confirmed via grep — it calls `layout.box(detailContent, {..., height: detailHeight})` directly,
  not through any shared docview helper), and design.md's own "byte-identical when content fits
  viewport" property preserves the full-screen ticketview.js case too. No spec break found here.

### Verdict: REFUTE

The overall shape (shared `docview`, tab-gated evidence focus, missing-file degradation, plain-text
+ control-strip reuse) is sound and well-grounded in real precedent. But the artifacts have three
specific, concrete gaps that a competent implementer could resolve two different (and mutually
exclusive) ways, all centered on the one piece of architecture the ticket cares most about —
"one shared renderer, not two independent box-drawing implementations."

### Change Requests

1. **`docview.js`'s exported API doesn't actually support `ticketview.js`'s partial reuse.**
   Task 1.1 defines exactly one export, `renderDocView({ title, body }, opts)`, described as
   drawing "title as a header row, the... body through `layout.box()`..., and a footer hint row
   (`esc back`...)" — i.e. a full mini-screen (title + box + footer). But task 2.1 requires
   `ticketview.js` to keep its *own* header rows (identifier/title/meta/url) and its own footer
   (`esc back`) and delegate *only* "the description/comments box" to "a shared docview render
   helper" — necessarily a second, narrower function docview.js must also export (box-only, no
   title row, no footer row). Design.md's own "Alternative considered" under Decision 1 confirms
   ticketview.js is deliberately *not* routed through `renderDocView` as a whole screen (that's the
   rejected alternative). Neither `design.md`, `specs/docview/spec.md`, nor `tasks.md` names, scopes,
   or tests this second export. **Required:** name and scope the box-only export (signature, what it
   returns) in design.md/tasks.md/spec.md before implementation, so ticketview.js's refactor (task
   2.1) and docview.js's creation (task 1.1) are building toward the same interface.

2. **The title-rendering shape is inconsistent between `tasks.md` and `specs/docview/spec.md`.**
   Task 1.1 says the title is drawn as "a header row" *outside* the box. `specs/docview/spec.md`'s
   Requirement 1 says the whole document renders "inside a single bordered pane" — which, by this
   codebase's own established convention (every other panel — TICKET/GATES/EVIDENCE in
   `drilldown.js`, EPICS/tickets in `launchpad.js` — passes its title through `layout.box()`'s own
   `title:` option, not a separate line above the box), reads as "the title is the box's own
   border-woven title." These are two different renders with different row budgets (a header row
   costs an extra content row the box-title convention does not). This directly affects the
   viewport-row math `clampScroll`/windowing depend on, and it directly affects requirement (1)
   above (what shape the box-only export returns). **Required:** pick one and make design.md,
   tasks.md, and spec.md agree.

3. **`watch.js`'s `docSource: 'evidence' | 'ticket'` discriminator (task 4.2/4.4) describes a branch
   that the rest of the design makes unreachable.** Per Decision 1, `ticketview.js` keeps its own
   `mode = 'ticketview'` (never `'docview'`) and, per task 2.3, its `handleKey` keeps hardcoding
   `{ type: 'back-to-launchpad' }` directly rather than emitting docview's generic `back` action.
   `mode = 'docview'` is only ever entered via `open-evidence-doc` (task 4.3), which always sets
   `docSource = 'evidence'` — no task ever sets it to `'ticket'`. So the `docSource === 'ticket'`
   branch in task 4.4 can never fire; it's either dead code an implementer might build unnecessarily
   from a literal reading of the type, or a sign the intended architecture is actually different from
   what Decision 1 and task 2.3 describe (i.e. ticketview.js *should* route through the generic
   back/docSource machinery after all — but Decision 1's own "Alternative considered" explicitly
   rejects that, for good reason: it would drag ticketview.js's `back-to-launchpad` routing into a
   screen that's supposed to be generic). **Required:** drop the `'ticket'` value/branch (docSource
   only ever needs to exist, if at all, to type-tag the one real caller) and make design.md/tasks.md
   consistent with Decision 1's own stated architecture, or explicitly reconcile it if a second real
   caller is actually intended.

4. **No cap/window on the EVIDENCE panel's own selectable list, unlike `TIMELINE`'s existing
   `MAX_TIMELINE` + "… N earlier events" precedent (`drilldown.js:112-138`).** Before this change,
   EVIDENCE's unbounded length was cosmetic (names-only, nothing to select). This change adds real
   keyboard navigation (`drillEvidenceIndex`) over that same unbounded list. A ticket that
   accumulates many evidence entries across several review rounds (each round can emit a proposal,
   design, N evaluation reports, and 2 skeptic reports) can produce an EVIDENCE panel taller than
   the visible terminal, with no design for scrolling that panel's *own* selection list (as opposed
   to `docview`'s scrolling of an *opened* document's body, which is a separate concern). An entry
   below the fold would then be unreachable/unselectable, silently breaking the "selecting an
   evidence entry opens it" acceptance criterion for exactly the busiest, most-reviewed tickets —
   the ones this feature matters most for. **Required:** either explicitly windows/caps the EVIDENCE
   list's selectable rows (mirroring `timelineLines`'s existing pattern) or explicitly document this
   as an accepted, bounded-scope limitation with the reasoning for why current entry counts can never
   exceed a typical terminal's EVIDENCE box height.

### Non-blocking notes

- Task 3.2's footer-hint wording leaves `k`/`r` "inert-but-unadvertised, or... disabled entirely" as
  an implementer's choice — reasonable per-decision flexibility, not a defect, since the AC only
  constrains what's *advertised*, not what's *bound*.
- The default (unfocused) footer never advertises `\t` even when EVIDENCE has entries (task 3.3
  mandates it stay byte-for-byte unchanged) — a discoverability gap for the whole feature, but not a
  literal violation of the ticket's "no key advertised unless bound" AC (that AC prohibits false
  advertising, not under-advertising). Worth a design call-out but not blocking.
