## Source

- `lib/ui/icons.js` — new shared icon vocabulary module; exports the 11 named glyph constants from design.md's Decision 2 table, each a bare 1-visible-column string with no colour/SGR.
- `lib/ui/screens/drilldown.js` — prefixes the branch row (populated and `(no branch yet)` fallback) with `icons.branch`; prefixes the `[1] TICKET`/`TIMELINE`/`GATES`/`EVIDENCE` panel titles with their respective icons.
- `lib/ui/screens/fleet.js` — prefixes the `QUICK START`, `QUEUED (...)`, and `METRICS` section titles with their respective icons; `NEEDS YOU`/`RUNNING`/`FAILED`/`DONE` left untouched.
- `lib/ui/screens/launchpad.js` — prefixes the `EPICS` pane title (both the boxed and degraded-fallback render paths) with `icons.epics`; the right pane's `ticketsTitle` (current epic's name) left untouched.
- `lib/ui/ticketDetail.js` — prefixes `buildDetailLines`'s `DESCRIPTION` and `COMMENTS` (incl. `(N)` suffix) headers with `icons.description`/`icons.comments`. Shared by `ticketview.js` and the launch pad's inline detail pane, so both pick up the change from this one source.
- `lib/ui/watch.js` — prefixes the evidence reader's `docTitle` (set in the `'open-evidence-doc'` action handler) with `icons.evidence`, at the caller rather than inside `docview.js`'s `renderDocView` — see the "Deviation from tasks.md wording" note below.

## Tests

- `test/icons.test.js` — new: every exported glyph measures as exactly 1 visible column (`f.visibleLength`); every exported glyph carries no ANSI escape of its own.
- `test/drilldown.test.js` — icon presence/text-preservation on the branch row (both cases) and the four panel titles; a no-line-exceeds-cols check; a spot-check that the phase-pipeline/gate-status markers are unchanged.
- `test/fleet.test.js` — icon presence on `QUICK START`/`QUEUED`/`METRICS`; confirms `NEEDS YOU`/`RUNNING`/`FAILED`/`DONE` headings carry no new icon.
- `test/launchpad.test.js` — icon presence on the `EPICS` pane title; confirms the right (tickets/epic-name) pane title carries none of this change's icons.
- `test/ticketDetail.test.js` — icon presence on `DESCRIPTION` and `COMMENTS` (with and without a `(N)` suffix).
- `test/docview.test.js` — icon-prefixed-title render/truncation coverage for the evidence reader, using an icon-prefixed title constructed in the test (mirroring what `watch.js`'s caller now does) — kept out of `renderDocView`'s own source per docview.js's pre-existing "generic/reusable, no ticket/evidence references" spec (see deviation note below).
- `test/layout.test.js` — `layout.box()` correctly truncates (and, when it fits, renders verbatim) an icon-prefixed title, generically (not tied to any one screen).

## Deviation from tasks.md wording (flagged, not silent)

Task 6.1 as literally written asks to prefix `icons.evidence` inside `docview.js`'s `renderDocView` (`f.bold(f.truncate(title, cols))`). Doing so verbatim breaks an existing, pre-CON-42 requirement: `openspec/specs/docview/spec.md`'s "docview's exports are generic and reusable" requirement, enforced by an existing test (`test/docview.test.js`: "bodyBox and renderDocView never mention ticket/evidence concepts in their own source") — `icons.evidence` as a literal identifier trips that source-scan (it contains the substring "evidence"), and `docview.js`'s own header comment independently states "Neither export knows about tickets, evidence, or any other caller-specific concept."

Resolution: the `icons.evidence` prefix is applied at `docTitle`'s one assignment site — `lib/ui/watch.js`'s `'open-evidence-doc'` action handler — rather than inside `docview.js`. This is the actual caller-specific site (see `docview.js`'s own comment: "watch.js's open-evidence-doc handler does it for the evidence reader," referring to word-wrapping, and the same caller boundary applies to the icon). The icon still lands inside `renderDocView`'s existing `f.truncate(title, cols)` budget, since it's now part of the `title` string `renderDocView` receives and truncates as a whole — satisfying task 6.1's stated intent ("keeping the icon inside the existing truncate budget") without violating docview.js's pre-existing genericity contract. `docview.js` itself required no code change.

One consequence: this specific icon-prefix site (`watch.js`'s giant stateful `watch()` closure) has no existing unit-test seam — `test/docview.test.js`'s new tests instead exercise `renderDocView` directly with an icon-prefixed title constructed the same way `watch.js` now constructs it, which covers the actual rendering/truncation behaviour but not the `watch.js` assignment line itself. Flagging this gap rather than absorbing it silently.
