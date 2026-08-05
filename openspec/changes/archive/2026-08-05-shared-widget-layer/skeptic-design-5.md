## Skeptic Report — design gate (round 5 — fold-in follow-up scope, "N=1" per orchestrator for this new review cycle)

Note on filename: the orchestrator passed N=1, but `skeptic-design-1.md`
through `skeptic-design-4.md` already exist in this change directory from
the original delivery's four design-gate rounds (this change dir was
reopened from `archive/2026-08-05-shared-widget-layer/`). To avoid
destroying that prior review history, this report is filed as round 5
(the next unused slot) rather than overwriting round 1. This report covers
only the NEW fold-in scope (ticket.md's "Additional Scope", design.md
Decision 7, tasks.md task group 7, and the revised
`specs/dashboard-iconography/spec.md` delta) as instructed — the rest of
the document (already reviewed four times) was read only for context.

### What I verified (with evidence)

- Read `ticket.md`'s "Additional Scope" section, `design.md`'s Decision 7
  (lines 243-298), `tasks.md`'s task group 7 (lines 53-61), and the revised
  `specs/dashboard-iconography/spec.md` delta in full.

- **Call-site line-number citations, verified against actual source
  (all exact matches):**
  - `lib/ui/screens/drilldown.js:476` — `title: icons.ticket + ' [1] TICKET'`
    inside `pane(...)`. Matches Decision 7's citation verbatim.
  - `lib/ui/screens/drilldown.js:516` — `timelineTitle = icons.timeline + '
    [2] TIMELINE' + (run.malformed ? ... : '')`. Matches the claimed
    "base pair + dynamic malformed-count suffix appended after" shape.
  - `lib/ui/screens/drilldown.js:519` — `gatesTitle = icons.gates + ' [3]
    GATES' + (run.cycle != null ? ' · cycle ' + run.cycle : '')`. Matches
    the claimed "base pair + dynamic cycle-number suffix appended after"
    shape.
  - `lib/ui/screens/drilldown.js:520` — `evidenceTitle = icons.evidence + '
    [4] EVIDENCE'` (no dynamic suffix, correctly not claimed to have one).
  - `lib/ui/ticketDetail.js:54` — `f.bold(icons.description + '
    DESCRIPTION')`. Matches.
  - `lib/ui/ticketDetail.js:68` — `icons.comments + ' COMMENTS' +
    (commentCount ? '  (' + commentCount + ')' : '')`. Matches the claimed
    "base pair + optional count suffix" shape.
  - `lib/ui/controllers/drilldown.js:116` — `S.docTitle = icons.evidence +
    ' ' + (action.label || action.ref || '(untitled)')`. Matches verbatim.

- **Exclusion boundary verified against source:**
  `lib/ui/screens/drilldown.js:302` — `const prefix = ev.kind === 'pr' ?
  icons.pr + ' ' : (isSelected ? '▸ ' : '  ')` — a per-row dynamic prefix on
  evidence-list rows, not a static section header. `:413` — `splitLine(icons.branch
  + ' ' + (run.branch || f.dim('(no branch yet)')), harnessText(run),
  cols)` — a per-run dynamic header row, not a static title. Both are
  correctly characterized as outside `sectionHeader`'s "icon + static
  label" contract and correctly excluded from Decision 7's migration.

- **`sectionHeader` contract confirmed:** read
  `lib/ui/widgets/header.js` — `sectionHeader({ icon, label, colour })`
  returns `icon ? icon + ' ' + label : label`, optionally colour-wrapped.
  This is exactly the "icon + static label pair" contract Decision 4/7
  claim, and is mathematically equivalent to every one of the seven cited
  inline compositions for their base pair.

- **`icons.js` exports referenced by Decision 7 all exist**: `ticket`,
  `timeline`, `gates`, `evidence`, `description`, `comments`, `branch`,
  `pr` are all present in `lib/ui/icons.js`.

- **Spec delta consistency**: compared the new
  `specs/dashboard-iconography/spec.md` delta against the currently
  archived/canonical `openspec/specs/dashboard-iconography/spec.md`
  (`git show HEAD:...`). The canonical version explicitly excludes
  `drilldown.js`'s panel titles, `ticketDetail.js`'s headers, and
  `controllers/drilldown.js`'s `docTitle` ("deliberately out of this
  change's scope... remain pre-existing inline call sites"). The new delta
  correctly flips this: it folds all three into the SHALL's covered
  consumer list and updates the scenario text accordingly (no stale
  "NOTE this scenario does not (yet) cover..." carryover). This is an
  accurate, non-widening restatement of Decision 7, not scope drift.

- **Decision 4's original contract re-read** (design.md:205-211) to confirm
  Decision 7's claim that "Decision 4's contract is scoped to the icon+label
  pair, not to a title's entire string" is accurate — it is; Decision 4
  itself defines `sectionHeader` as exactly `icon + ' ' + label`.

- **Test-coverage gap found (the one substantive issue)**: I checked
  whether each of the three migration groups has an existing regression
  test that would actually catch a change in the composed output (the
  concrete verification Decision 7's own Risk mitigation and task 7.6 both
  claim: "every widget extraction is verified against that screen's
  existing test fixtures/snapshots before and after the swap").
  - `drilldown.js`'s four panel titles: **covered**.
    `test/drilldown.test.js:104-107` asserts
    `icons.ticket + ' [1] TICKET'`, `icons.timeline + ' [2] TIMELINE'`,
    `icons.gates + ' [3] GATES'`, `icons.evidence + ' [4] EVIDENCE'`
    directly against rendered output.
  - `ticketDetail.js`'s two headers: **covered**.
    `test/ticketDetail.test.js:78-96` asserts
    `icons.description + ' DESCRIPTION'`, `icons.comments + ' COMMENTS
    (3)'`, and the zero-count `icons.comments + ' COMMENTS'` cases
    directly.
  - `controllers/drilldown.js:116`'s `docTitle` composition: **not
    covered by any existing test**. I searched the entire `test/`
    directory (`grep -rn "docTitle\|open-evidence-doc" test/*.js`) and the
    codebase for any require of `controllers/drilldown.js` or
    `controllers/index.js` from a test file
    (`grep -rln "controllers/index\|controllers')" test/ lib/`) — zero
    matches under `test/`. `test/drilldown.test.js:778-786` only asserts
    the shape of the *dispatched action* (`{ type: 'open-evidence-doc',
    ref, label }`), which is upstream of the controller reducer that
    actually builds `S.docTitle`. `test/docview.test.js:198-202` tests
    `renderDocView`'s generic handling of an icon-prefixed title, but
    constructs that title inline in the test
    (`icons.evidence + ' eval-report.md'`) rather than exercising the real
    `controllers/drilldown.js:116` line — it never invokes that file. No
    test in the suite currently invokes the controller function that
    contains line 116 at all.

  This means task 7.6's claim — "Run ... `controllers/drilldown.js`'s
  existing test suites ... to confirm byte-identical output" — has nothing
  to run for this specific call site: there is no existing fixture that
  would fail if the migration introduced a regression (e.g. dropped a
  fallback, mis-ordered the `||` chain, or mis-nested the colour wrap).
  This is also the most complex of the three groups (a three-way `||`
  fallback: `action.label || action.ref || '(untitled)'`), so it is the
  one most worth having a direct assertion for, not least. Design.md's own
  Risk mitigation text ("every widget extraction is verified against that
  screen's existing test fixtures/snapshots before and after the swap")
  is therefore inaccurate as applied to this one call site — the mitigation
  it describes does not actually exist for it.

### Verdict: REFUTE

### Change Requests

1. `tasks.md` task group 7 is missing a task to **add** a regression test
   asserting the exact `S.docTitle` string produced by
   `controllers/drilldown.js`'s `open-evidence-doc` handler (currently
   line 116) for at least the three fallback branches it exercises
   (`action.label` present, `action.label` absent but `action.ref`
   present, both absent → `'(untitled)'`), written/verified against the
   **current** inline composition *before* the swap to `sectionHeader()`,
   so the swap has something to regress against — matching the coverage
   already present for the other two migration groups
   (`test/drilldown.test.js:104-107`, `test/ticketDetail.test.js:78-96`).
   This can be a new small test (e.g. a `controllers/drilldown.js`-focused
   test file, or an addition to an existing one that already exercises
   this controller's dispatch path) — the design doesn't need to specify
   which file, only that this specific assertion needs to exist before
   task 7.4's swap lands.
2. Update `design.md`'s Decision 7 Risk mitigation text (or the shared
   Risks/Trade-offs entry it refers to) to either (a) note this test is
   being added as part of this fold-in specifically because no such
   coverage existed before, or (b) otherwise correct the blanket claim
   that "every widget extraction is verified against that screen's
   existing test fixtures/snapshots" so it doesn't overstate existing
   coverage for `controllers/drilldown.js`.
3. Update `tasks.md` task 7.6's wording — "Run ...
   `controllers/drilldown.js`'s existing test suites" implies a suite
   exists to run; today there isn't one that exercises this line at all.
   Once change request 1 is addressed this becomes accurate; until then
   it's a false acceptance signal.

### Non-blocking notes

- `test/docview.test.js:194` describes the evidence-title-prefixing caller
  as "watch.js's 'open-evidence-doc' handler" — that logic actually now
  lives in `lib/ui/controllers/drilldown.js` post-modularization, not
  `watch.js`. Pre-existing staleness, not introduced by this change, and
  not part of Decision 7's diff — flagging only in case the executor
  touches this file anyway and wants to fix it in passing.
- Every other citation, contract claim, and the spec-delta text in this
  fold-in round is well-grounded against current source and internally
  consistent with the prior (already 4-times-reviewed) delivery. This is a
  narrowly-scoped, single-issue REFUTE, not a broad rejection of the
  design.
