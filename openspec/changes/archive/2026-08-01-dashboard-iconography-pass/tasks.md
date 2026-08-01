## 1. Icon vocabulary module

- [x] 1.1 Create `lib/ui/icons.js` exporting the 11 named glyph constants from design.md's Decision 2 table (`branch`, `ticket`, `timeline`, `gates`, `evidence`, `description`, `comments`, `epics`, `quickStart`, `queue`, `metrics`), each a bare glyph string with no colour/SGR. Include a header comment stating the `Emoji_Presentation=No` / narrow-blocks-only constraint (design.md Decision 2) so a future addition to this file follows the same rule.
- [x] 1.2 Add a unit test asserting every exported glyph's `f.visibleLength(...)` is exactly `1`.

## 2. Drill-down (`lib/ui/screens/drilldown.js`)

- [x] 2.1 Prefix the branch row (the ticket's named example, currently `splitLine(run.branch || f.dim('(no branch yet)'), harnessText(run), cols)`) with `icons.branch + ' '`, applied to both the populated-branch and the `(no branch yet)` fallback case.
- [x] 2.2 Prefix the `[1] TICKET` panel title with `icons.ticket`, `TIMELINE`'s title with `icons.timeline`, `GATES`'s title with `icons.gates`, `EVIDENCE`'s title with `icons.evidence` (all three `timelineTitle`/`gatesTitle`/`evidenceTitle` locals near the `layout.box(...)` calls at the panel-render site).
- [x] 2.3 Confirm (no code change expected) that the phase-pipeline and gate-status `✓`/`✗`/`○`/`●` markers are untouched — these are explicitly out of scope (design.md Decision 4 / spec.md's "never duplicate STATUS_COLOUR" requirement).

## 3. Fleet view (`lib/ui/screens/fleet.js`)

- [x] 3.1 Prefix the `QUICK START` section title with `icons.quickStart`.
- [x] 3.2 Prefix the `QUEUED (${queueState.pending.length}, running ${queueState.maxConcurrent} at a time)` section title with `icons.queue`.
- [x] 3.3 Prefix the `METRICS` section title with `icons.metrics`.
- [x] 3.4 Confirm (no code change expected) that `NEEDS YOU`/`RUNNING`/`FAILED`/`DONE` section titles are untouched.

## 4. Launch pad (`lib/ui/screens/launchpad.js`)

- [x] 4.1 Prefix the `EPICS` pane title with `icons.epics`. Do NOT touch `ticketsTitle` (the right pane's title) — ground truth shows it renders the currently-selected epic's name, not a "tickets" label; out of scope for this pass (design.md Non-Goals).

## 5. Ticket detail (`lib/ui/ticketDetail.js`, shared by `ticketview.js` and the launch pad's inline detail pane)

- [x] 5.1 Prefix the `DESCRIPTION` header in `buildDetailLines` with `icons.description`.
- [x] 5.2 Prefix the `COMMENTS` header (including its `(N)` count suffix) in `buildDetailLines` with `icons.comments`.

## 6. Evidence reader (`lib/ui/screens/docview.js`)

- [x] 6.1 Prefix `renderDocView`'s title row (`f.bold(f.truncate(title, cols))`) with `icons.evidence` (reusing the same glyph as the drill-down's EVIDENCE panel — design.md Decision 2's stated reuse rationale), keeping the icon inside the existing `f.truncate(..., cols)` budget rather than adding it after truncation.

## 7. Verification

- [x] 7.1 Run the existing test suite; add/extend screen-render tests covering each icon application point above (icon glyph present, existing label text unchanged, no line exceeds `cols` under `f.visibleLength`).
- [x] 7.2 Manually verify (or via a forced-`isTTY` render test) that `layout.box()` still truncates an icon-prefixed title correctly when its available width is narrower than the icon + label.
- [x] 7.3 Grep the diff for any new inline glyph literal outside `lib/ui/icons.js` — there should be none (Requirement: "A shared icon vocabulary module governs every structural icon glyph"). Pay particular attention to `harnessText`/`speedModelsText` (drilldown.js), `ticketDetail.js`'s `metaLine`, and `launchpad.js`'s `ticketsTitle` — all three are explicitly out of scope (design.md Non-Goals) and are the spots most likely for an improvised glyph to sneak in.
