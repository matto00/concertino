## Context

The drill-down (`lib/ui/screens/drilldown.js`) already lists a run's persisted evidence artifacts
(proposal, design, evaluation reports, both skeptic reports — CON-10) in its EVIDENCE panel, each
line built from an `evidence`/`verdict` event's `label`/`ref` fields (`evidenceLines()`). `ref` is a
durable, absolute path under `.concertino/runs/<TICKET>/evidence/` (see `persist-evidence.sh`,
`evidence-telemetry` spec), guaranteed to survive `cleanup.sh --phase4` destroying the run's
worktree — but there is currently no way to read the file at that path without leaving the dashboard.

Separately, `ticketview.js` (reached from the launch pad via `↵`) already solves "render a long text
document in a bounded pane": it draws `ticketDetail.buildDetailLines()`'s output through
`layout.box()`. It does **not**, on inspection, actually bound or scroll that content — `boxHeight`
is always `boxContent.length + 2` (full content height), so a ticket description long enough to
exceed the terminal simply renders off the bottom with no way to reach the rest. This change needs
genuine scrolling (evaluation/skeptic reports run to several screens), so it cannot reuse
`ticketview.js`'s box-drawing as-is; it has to add the capability, and give `ticketview.js` the fix
for free by sharing it (per the ticket's own note).

## Goals / Non-Goals

**Goals:**
- One shared, pure, scrollable `{ title, body }` document reader (`docview.js`), used by both the
  new evidence reader and (refactored) `ticketview.js`.
- Selecting an EVIDENCE entry and opening it costs one keypress from the drill-down; `esc` returns
  with the same entry still selected.
- A missing/unreadable file degrades honestly (explicit message), never a thrown error or blank pane.
- Markdown source renders as plain text; control bytes are stripped — reusing the two mechanisms
  that already do this for ticket text (`markdown.toPlainText`, `format.js`'s `f.truncate` choke
  point), not new ones.
- No footer key hint appears unless that key is actually bound in the current state.

**Non-Goals:**
- Syntax highlighting, markdown tables, or any richer-than-plain-text rendering — same non-goal
  `markdown.js` already states for ticket descriptions.
- Editing, searching within, or exporting a document from the reader — read-only, same as
  `ticketview.js`.
- Changing `evidence`/`verdict` event schemas, `persist-evidence.sh`, or retention policy (CON-4's
  concern) — this reads whatever `ref` currently resolves to, honestly, and stops there.
- Live-updating an open document if its file changes on disk mid-read — the reader loads once per
  open, matching `ticketview.js`'s existing snapshot-on-open behavior for ticket text.

## Decisions

**Decision 1 — `docview.js` exports TWO things: a shared box-only core (`bodyBox`), and a
full-screen composition (`renderDocView`) built on top of it. `ticketview.js` calls only the
former.** This codebase has two different conventions for "a titled block of content," confirmed by
reading both: multi-panel screens (`drilldown.js`'s TICKET/GATES/EVIDENCE, `launchpad.js`'s
EPICS/tickets) pass their title through `layout.box()`'s own `title:` option (woven into the
border); single-pane screens (`escalation.js`, and `ticketview.js` itself today) render their title
as ordinary text row(s) ABOVE an untitled box. `docview` is a single-pane reader, so it follows the
second convention — the box itself never receives a `title:` option, in either export:

- `bodyBox(bodyLines, opts)` — pure, box-only. `opts: { width, viewportRows, scrollOffset, focused }`.
  Windows `bodyLines` to `viewportRows` using `scrollOffset` (see Decision 2's `clampScroll`), draws
  it through `layout.box()`/`layout.degrade()` with NO `title:` option (matching the convention
  above) and no footer — exactly the "box" half of what `ticketview.js`'s current `pane()` helper
  does today, generalised to be scrollable. This is the ONLY export `ticketview.js` calls: its
  refactor (task 2.1) keeps its own header rows (identifier/title/meta/url) and its own `esc back`
  footer line completely unchanged, replacing only its internal `pane(boxContent, {...})` call with
  `docview.bodyBox(boxContent, {...})`.
- `renderDocView({ title, body }, opts)` — composes ONE header row (`title`, plain text, no box)
  above a `bodyBox()` call above ONE footer row (`esc back` + a scroll indicator when windowed).
  This is the full mini-screen the evidence reader (`mode = 'docview'`) actually renders; nothing
  else calls it.

Both exports share the same `clampScroll`/scroll-key-recognition logic (Decision 2) so the two
callers' scrolling behaves identically even though only one of them is a full screen.
_Alternative considered_: give `docview.js` exactly one export (`renderDocView`) and make
`ticketview.js` a thin `{title, body}` constructor that renders through it as a full-screen swap.
Rejected for this change — it would also have to reproduce `ticketview.js`'s `esc`-target
(`back-to-launchpad`, a caller-specific routing concern) inside what should stay a generic screen,
and it would force `ticketview.js`'s existing ticket-specific header rows through `renderDocView`'s
generic single-title-row shape, which cannot represent them (identifier + title + meta line + URL is
four distinct rows with different styling, not one title string). Revisit only if a third caller
ever needs the exact `renderDocView` full-screen shape.

**Decision 2 — Scroll state lives in `watch.js`, mirroring `scrollOffset`'s existing precedent.**
`watch.js` gains `docScroll` (an integer, reset to `0` whenever the evidence reader is opened via
`open-evidence-doc`, and independently owned by `ticketview.js`'s own existing per-ticket state for
its own scroll position — see task 2.2) alongside the existing `drillTicket`/`launchPad` sub-state
pattern. `docview.js` exports a pure `clampScroll(bodyLineCount, viewportRows, scrollOffset)` (same
shape as `fleet.js`'s `visibleWindow`/`maxScrollOffset`) and a pure `scrollDelta(key)` (returns
`{ lines: ±1 }` for `↑`/`k`/`↓`/`j`, `{ lines: ±viewportRows }` for page-up/page-down
(`\x1b[5~`/`\x1b[6~`), or `null` for any other key) so neither `watch.js` nor `ticketview.js`
duplicates key-recognition logic — both callers call `scrollDelta` then `clampScroll`, they just
apply the result to their own differently-owned scroll variable.

**Decision 3 — EVIDENCE panel selection is a `tab`-gated focus, not an always-on cursor.**
The drill-down gains `drillFocus: null | 'evidence'` and `drillEvidenceIndex: <n>` in `watch.js`.
`\t` toggles focus between the default (unfocused: `↵` attach / `k` kill / `r` restart still bound
exactly as today) and `evidence` (the EVIDENCE panel's border switches to `layout.box`'s `focused`
style — same visual contract `launchpad.js`'s epics/tickets panes already use — and `↑`/`↓`/`j`/`k`
move `drillEvidenceIndex`, `↵` opens the selected entry). This is the same shape as
`launchpad.js`'s existing `pane`/`\t` mechanism (`switch-pane`), not a new pattern. `\t` is a no-op
(and not advertised) when there is no evidence to focus — `evidenceLines()` returning the
"no evidence recorded" fallback means `drillFocus` can never usefully become `'evidence'`.
_Alternative considered_: overload `↵` contextually (attach when nothing selected, open when an
evidence row is highlighted, always-on cursor). Rejected: the drill-down has no existing notion of
"a row is highlighted" outside a pane focus, and an always-on implicit selection risks a run with
live gates/timeline content silently swallowing `↵`-attach the moment EVIDENCE has ≥1 entry — a
correctness regression on the screen's most common action for a live run. An explicit focus toggle
keeps `↵`'s meaning unambiguous in both states, and satisfies the "no key advertised unless bound"
criterion directly: the footer hint set is simply different per `drillFocus` value.

**Decision 3a — `watch.js` has no `docSource` discriminator; `mode = 'docview'` has exactly one real
caller.** The gap identified in review: an earlier draft of this design gave `watch.js` a
`docSource: 'evidence' | 'ticket'` field to route the reader's `esc` back to either the drill-down or
the launch pad. That is dead by construction — per Decision 1, `ticketview.js` never enters
`mode = 'docview'` at all (it calls `bodyBox` directly and keeps its own `mode = 'ticketview'` and its
own hardcoded `{ type: 'back-to-launchpad' }` on `esc`, unchanged from today). `mode = 'docview'` is
therefore entered ONLY via the evidence reader's `open-evidence-doc` action, so its `esc` always
means "return to the drill-down" — no discriminator needed. If a second real full-screen `docview`
caller is ever added, add the discriminator then, scoped to what that caller actually needs.

**Decision 4 — The reader reads `ref` fresh, off the main thread's synchronous `fs.readFileSync`,
same as `ticket-text.js`'s existing persisted-file read.** No new I/O abstraction; `docview`'s
`open-evidence-doc` handler in `watch.js` does the read (try/catch, exactly like
`ticket-text.js#resolve`) at the point the action fires, not inside the pure render path — mirrors
`drillTicketText`'s existing "impure read passed through opts" placement in `draw()`.

**Decision 3b — The EVIDENCE panel's own entry list is capped and follows the selection into view,
mirroring `timelineLines`'s `MAX_TIMELINE` and CON-6's `fleet.js` "selection stays visible" fix.**
Before this change, `evidenceLines()` was unbounded-but-harmless (names only, nothing to select).
This change adds real keyboard navigation (`drillEvidenceIndex`) over that same list, so an
unbounded EVIDENCE panel on a ticket with many review rounds (each round can add a proposal, design,
N evaluation reports, 2 skeptic reports) could grow taller than the terminal, leaving entries below
the fold selectable-in-theory but unreachable — silently breaking the ticket's core acceptance
criterion for exactly the busiest, most-reviewed tickets. `evidenceLines()` gains a fixed
`EVIDENCE_MAX_VISIBLE` row cap (same constant shape as `timelineLines`'s `MAX_TIMELINE`): when
`drillFocus !== 'evidence'`, it shows the leading `EVIDENCE_MAX_VISIBLE` entries followed by a
`… N more` row (identical convention to `timelineLines`'s `… N earlier events`); when
`drillFocus === 'evidence'`, the window instead follows `drillEvidenceIndex` — scrolling to keep the
selected entry visible, the exact principle CON-6 (`7ea12b4`, `fleet.js`'s `visibleWindow`) already
established for the fleet view's own selection, applied here to a flat list instead of a sectioned
one (a smaller adaptation, not a new algorithm).

**Decision 5 — Missing file renders inside the reader, not as a blocker to opening it.** Pressing
`↵` on a selected entry always transitions to the doc-reader mode; if the read failed, `body` is a
single line: `f.yellow('file not found: ' + ref)` (same styling convention as every other
"nothing here" fallback in this codebase — `ticket text unavailable`, `no evidence recorded`).
`esc` from that state returns to the drill-down exactly the same way a successful read's `esc` does.
_Alternative considered_: refuse to open (show a `drillNotice` on the drill-down instead, never
entering doc-reader mode). Rejected — inconsistent with every other "open X" affordance in this
codebase (`attach`, `open-ticketview`) always succeeding at the mode transition and depicting failure
inside the destination, and it would need its own footer wording the ticket does not ask for.

**Decision 6 — Markdown stripping and control-byte safety are reused verbatim, not reimplemented.**
`docview`'s render pipeline calls `markdown.toPlainText(rawFileContent)` before wrapping to width
(exactly as `drilldown.js`'s `ticketPanelLines` already does for the TICKET panel), and — like every
other screen — never strips control bytes itself; that happens once, for free, at the final
`f.truncate` pass every rendered line already goes through (`format.js`'s `stripUnsafeControls`,
documented as the single project-wide choke point). No new sanitization code.

## Risks / Trade-offs

[A report body containing very long lines (e.g. an unwrapped stack trace or table) renders wide
lines that `f.truncate` clips per-row rather than wrapping] → Same behavior `ticketPanelLines`/
`ticketDetail.buildDetailLines` already accept for ticket text; `textwrap.wrap` is applied to the
raw content the same way, so a report's prose wraps normally — only a single unbroken long token
(no whitespace) would still clip, an existing, accepted limitation of `textwrap.wrap` itself, not
new to this change.

[Refactoring `ticketview.js`'s box call changes its visual output for the common case where content
already fit — a taller box would now be clamped to viewport height, and formerly-fully-visible short
tickets must not lose any content] → `docview`'s viewport height is `max(content height, available
rows)`-independent for the common case: when `body.length <= viewportRows`, the reader renders the
full content with no scroll indicator at all, byte-for-byte matching what `layout.box()` already
produces for that content today. Only content that exceeds the viewport changes behavior (from
"silently cut off the bottom of the terminal" to "visibly scrollable") — verified in design review
against `renderTicketView`'s existing golden-output tests before implementation.

[`\t` for evidence focus is a new key on the drill-down, currently unbound there] → No existing
drill-down key uses `\t`; confirmed by reading `drilldown.js#handleKey` in full during design
(`\x1b`, `y`, `k`, `r`, `\r` are the only keys it currently recognises).

## Open Questions

None outstanding. The shared-`docview` question the ticket's own notes raised is resolved by
Decision 1 (two exports: `bodyBox` for partial reuse, `renderDocView` for the full-screen reader).
The design-gate skeptic's round-1 review (see `skeptic-design-1.md`) surfaced four concrete gaps —
the `bodyBox`/`renderDocView` split (Decision 1), the title-rendering convention (also folded into
Decision 1), the dead `docSource: 'ticket'` branch (Decision 3a), and the EVIDENCE list's own
missing cap/scroll-follows-selection (Decision 3b) — all resolved above.
