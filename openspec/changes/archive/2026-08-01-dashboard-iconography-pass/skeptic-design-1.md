## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/dashboard-iconography/spec.md` in full.
- Cross-checked `design.md` Decision 2's 11-glyph table against
  `lib/ui/format.js`'s `WIDE` table (lines 174-208) using a Node one-liner
  that resolved each candidate codepoint (`0x2387, 0x25A4, 0x25AC, 0x25C6,
  0x25A7, 0x274F, 0x270E, 0x25A3, 0x25B6, 0x2261, 0x25EB`) and confirmed none
  fall inside any `WIDE` range — the design's "no glyph in the table is in
  `format.js`'s WIDE ranges" claim holds against the actual table.
- Confirmed the drill-down branch row quoted verbatim in `ticket.md` and
  `proposal.md` matches the live code exactly:
  `lib/ui/screens/drilldown.js:397` —
  `const row2 = splitLine(run.branch || f.dim('(no branch yet)'), harnessText(run), cols);`
- Confirmed the drill-down panel-title locals (`timelineTitle`, `gatesTitle`,
  `evidenceTitle`, and the `'[1] TICKET'` box title) exist as described, at
  `lib/ui/screens/drilldown.js:460,500-504`.
- Confirmed fleet.js's `QUICK START` / `QUEUED (...)` / `METRICS` section
  titles and untouched `NEEDS YOU`/`RUNNING`/`FAILED`/`DONE` headings exist
  as described (`lib/ui/screens/fleet.js:351-403`).
- Confirmed `docview.js`'s `renderDocView` title row
  (`out.push(f.bold(f.truncate(title, cols)));`, line 178) matches task
  6.1's description, including that the icon must go inside the
  `f.truncate(...)` call, not after it.
- Read `lib/ui/screens/launchpad.js` in full around the EPICS/tickets pane
  render (lines 270-343) and `lib/ui/ticketDetail.js` in full (86 lines).

### Verdict: REFUTE

Two of the six file-level scope items in `proposal.md`'s "Apply the new
icons to" list are either factually wrong about the target code or are
promises with zero corresponding coverage in `design.md`'s vocabulary and
`tasks.md`'s task list. These are exactly the "internal contradiction /
scope item uncovered by any task" class of defect this gate exists to
catch — an implementer following `tasks.md` literally will under-deliver
against what `proposal.md` committed to, or will invent an ungoverned glyph
outside `icons.js` to compensate, which the spec's own Requirement 1
explicitly forbids.

### Change Requests

1. **`tasks.md` 4.2 misdescribes what `ticketsTitle` actually is; applying
   `icons.ticket` to it is semantically wrong.** `proposal.md` line 14 and
   `tasks.md` line 22 both describe the launch pad's right-pane title as
   "TICKETS/ticket-count title" / "the tickets pane's title, including its
   ticket-count suffix." Ground truth
   (`lib/ui/screens/launchpad.js:302-306`) shows `ticketsTitle` is actually
   the **currently selected epic's name** (or `'─ unassigned ─'` /
   `'(no epic selected)'`), not a "TICKETS (N)" label — a prior change (see
   the code comment at lines 278-281: "the pane headings (\"EPICS\", the
   current epic's name) now live in each box's own title") already moved
   this pane's title away from a ticket-count label to the epic name. No
   "TICKETS"-literal string with a count exists anywhere in the codebase
   (verified via grep across `lib/ui/**/*.js`). Prefixing `icons.ticket`
   (design.md's own stated meaning: "ticket(s)") onto what renders as, e.g.,
   `"▤ Sprint 42"` or `"▤ (no epic selected)"` mislabels an epic name as a
   ticket — the opposite of this ticket's stated goal (icons that are
   "visually scannable" signal, not "noise"). Design.md's Decision 2 table
   entry for `▤` ("launch pad tickets-pane title") needs to be corrected: either
   drop this application entirely, or apply `icons.epics` (or a new,
   epic-specific icon) to the right pane's title instead, matching what the
   pane title now actually contains.

2. **`proposal.md`'s "harness/speed metadata rows" scope item has no
   corresponding icon in `design.md`'s vocabulary and no task in
   `tasks.md`.** `proposal.md` line 11 commits to icons on "The drill-down's
   branch-name row (the ticket's named example) **and its harness/speed
   metadata rows**." `design.md`'s Decision 2 table (the sole source of
   every glyph per Requirement 1) has 11 entries — none named `harness` or
   `speed`, and none applied to `harnessText(run)` (drilldown.js:320,
   rendered on branch row2's right side) or `speedModelsText(run)`
   (drilldown.js row4). `tasks.md` section 2 (lines 6-10) covers only 2.1
   (branch) and 2.2 (panel titles) — no task touches harness or speed. An
   implementer following `tasks.md` will not deliver this proposal
   commitment; one following `proposal.md` literally will invent an
   ungoverned inline glyph, violating spec.md's "no screen SHALL inline a
   new structural icon glyph independently" requirement. Either add a
   harness/speed glyph to Decision 2's table plus a task 2.x applying it, or
   strike "and its harness/speed metadata rows" from `proposal.md` line 11.

3. **`proposal.md`'s `ticketDetail.js` `metaLine` scope item has the same
   gap.** `proposal.md` line 15 commits to icons on
   "`ticketDetail.js`'s shared `DESCRIPTION`/`COMMENTS` section headers
   **and its `metaLine` metadata fields (state, assignee, estimate, epic,
   labels)**." Ground truth (`lib/ui/ticketDetail.js:26-34`) shows
   `metaLine` joins five distinct fields with `'   ·   '` into one string.
   `design.md`'s Decision 2 table has no icon named/meant for state,
   assignee, estimate, or labels (the one `epic` entry, `▣`, is scoped
   explicitly to "launch pad EPICS pane title," not this per-field use).
   `tasks.md` section 5 (lines 24-27) covers only 5.1 (`DESCRIPTION`
   header) and 5.2 (`COMMENTS` header) — no task touches `metaLine`. Same
   resolution as #2: either design five field-level glyphs (or decide a
   subset, e.g. reusing `▣` for the epic field specifically) and add the
   corresponding tasks, or strike the `metaLine` clause from `proposal.md`
   line 15.

### Non-blocking notes

- Decision 2's `Emoji_Presentation=No` reasoning is well-argued and shows
  real care (e.g. explicitly choosing `U+270E` over the emoji-listed
  `U+270F` for the comment glyph) — I was not able to exhaustively verify
  every one of the 11 codepoints against Unicode's `emoji-data.txt` from
  inside this sandbox, but the stated methodology and the one documented
  precedent (`▲` U+25B2, already shipped, is itself `Emoji_Presentation=No`
  but `Emoji=Yes`) are consistent with what's proposed here. This is a
  judgment call the design already owns as a documented risk (Risk 1), not
  a new gap I'm raising.
- Once change requests 2 and 3 are resolved (whichever direction — add
  coverage or shrink scope), re-verify `tasks.md` section 7's grep-based
  "no inline glyph literal outside `icons.js`" check will actually catch a
  regression on harness/speed/metaLine specifically, since those are the
  spots most likely for an implementer to improvise a literal.
