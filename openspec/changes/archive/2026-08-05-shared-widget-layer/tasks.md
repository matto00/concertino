## 1. Widget module — confirm dialog

- [x] 1.1 Create `lib/ui/widgets/confirm.js` exporting pure `confirmLines({ warning, confirmHint })` (design.md Decision 1).
- [x] 1.2 Add `test/widgets/confirm.test.js` covering: two-line shape, purity, exact indent/`f.dim` wrap convention.
- [x] 1.3 Swap `lib/ui/screens/fleet/sections.js`'s clear-queue, force-start, and quit confirm blocks to call `confirmLines` (wording/keys unchanged).
- [x] 1.4 Swap `lib/ui/screens/drilldown.js`'s kill/restart confirm block to call `confirmLines` (wording/keys unchanged).
- [x] 1.5 Run `test/fleet*.test.js` and `test/drilldown*.test.js` (or equivalent existing suites) to confirm byte-identical output.

## 2. Widget module — text input

- [x] 2.1 Create `lib/ui/widgets/textinput.js` exporting pure `inputLines({ label, value, cols, error })` (design.md Decision 2), with the `'  '`-indented error line.
- [x] 2.2 Add `test/widgets/textinput.test.js` covering: one-line/two-line shape, truncation width, error-line indent/colour.
- [x] 2.3 Swap fleet's new-run prompt block in `lib/ui/screens/fleet/sections.js` to call `inputLines`.
- [x] 2.4 Swap `lib/ui/screens/escalation.js`'s reply block to call `inputLines`.
- [x] 2.5 Swap `lib/ui/banner.js`'s reply block to call `inputLines`.
- [x] 2.6 Run the existing test suites covering these three screens to confirm byte-identical output and unchanged `handleKey` action types. (`ticketdraft.js`'s field rendering is explicitly out of scope — design-gate round 1 confirmed it is a materially different shape; do not modify it as part of this change.)

## 3. Widget module — footer row accounting

- [x] 3.1 Create `lib/ui/widgets/footer.js` exporting pure `footer({ hints, cols })` returning `{ lines, rows }` (design.md Decision 3).
- [x] 3.2 Add `test/widgets/footer.test.js` covering: `rows === lines.length`, delegation to `f.hintLines`.
- [x] 3.3 Update `lib/ui/screens/drilldown.js`'s footer-row computation for its `evidenceFocused` and default branches only to read `rows` from `footer()` instead of re-deriving `.length`. Its `confirm` branch's row count is NOT a footer computation — it stands in for `confirmLines()`'s always-2-line output (Decision 1, task 1.4); derive it from `confirmLines(...).length` (or an inline `2` with a comment tying it to that contract), never from `footer()`.
- [x] 3.4 Update `lib/ui/screens/launchplan.js`'s equivalent footer-row computation (its line ~289) the same way.
- [x] 3.5 Run `drilldown.js`'s and `launchplan.js`'s existing test suites to confirm no height-budget regression (e.g. CON-43/CON-26's own regression tests, if present). (`escalation.js`, `ticketview.js`, `docview.js`, and fleet's own footer/height budgeting are explicitly out of scope — design-gate round 1 confirmed none of them duplicate a footer-row computation; do not modify their footer rendering as part of this change.)

## 4. Widget module — section header + icon coverage extension

- [x] 4.1 Create `lib/ui/widgets/header.js` exporting pure `sectionHeader({ icon, label, colour })` (design.md Decision 4).
- [x] 4.2 Add `test/widgets/header.test.js` covering: icon+label composition, colour wrap, icon-omitted passthrough.
- [x] 4.3 Fleet already has icon coverage on its three non-status-governed section titles (`fleet/sections.js:136,153,180` — QUICK START/QUEUED/METRICS, each already `icon + ' ' + label`) — there is no missing coverage to add. Migrate those three existing inline compositions to call `sectionHeader({ icon, label })` instead (e.g. `sectionHeader({ icon: icons.quickStart, label: 'QUICK START' })`), preserving the exact rendered text; do not add a second icon or skip this screen. The status-governed carve-out (NEEDS YOU/RUNNING/FAILED/DONE) still applies unchanged — those headings are untouched.
- [x] 4.4 Apply `sectionHeader` to `lib/ui/screens/docview.js`'s title/section rendering.
- [x] 4.5 Apply `sectionHeader` to `lib/ui/screens/ticketview.js`'s pane header(s).
- [x] 4.6 Apply `sectionHeader` to `lib/ui/screens/ticketdraft.js`'s field-group headers.
- [x] 4.7 Apply `sectionHeader` to `lib/ui/screens/escalation.js`'s question/context headers.
- [x] 4.8 Apply `sectionHeader` to `lib/ui/screens/settings.js`'s section headers.
- [x] 4.9 Apply `sectionHeader` to `lib/ui/screens/launchplan.js`'s section headers.
- [x] 4.10 For any screen above with no existing `lib/ui/icons.js` glyph that fits its section, escalate rather than inventing a new glyph ad hoc (design.md Goals note; `dashboard-iconography`'s restricted-vocabulary Decision 2).
- [x] 4.11 Run each affected screen's existing test suite to confirm no unrelated regression.

## 5. Widget module — empty state

- [x] 5.1 Create `lib/ui/widgets/empty.js` exporting pure `emptyState({ icon, message })` (design.md Decision 5), matching the codebase's existing dim-styled empty-state convention (e.g. `fleet/sections.js:228`'s `f.dim('  no active runs')`, `launchpad.js:318`'s `f.dim('no tickets cached yet — press r to fetch')`) — NOT `launchpad.js`'s `teamNotFoundMessage` (that function lives in `watch.js` and renders via `f.red` as an error message, not a dim-styled empty state).
- [x] 5.2 Add `test/widgets/empty.test.js` covering: dim styling, icon-prefixed variant, message text preserved verbatim.
- [x] 5.3 Identify panes that currently hand-roll a "nothing to show" message (e.g. fleet's "no active runs" line) and migrate them to `emptyState()` without changing wording.

## 6. Spec conformance and cleanup

- [x] 6.1 Confirm every requirement/scenario in `specs/dashboard-shared-widgets/spec.md` and the `dashboard-iconography` delta is satisfied by the code above.
- [x] 6.2 Run the full existing test suite (`npm test` or equivalent) — zero regressions, no `handleKey`/action-shape changes anywhere.
- [x] 6.3 Confirm every widget file under `lib/ui/widgets/` is pure (no `process.stdout`, no held module-level state, no ambient clock/env reads beyond what `format.js`'s existing TTY-gated colour helpers already do).
- [x] 6.4 Update any stale comments (e.g. `icons.js`'s own header comment naming its consumers) to reflect the widened consumer list.

## 7. Fold-in follow-up — migrate the three remaining inline icon+label call sites (design.md Decision 7)

- [x] 7.0 **(Design-gate round 5 change request.)** Before touching `controllers/drilldown.js:116`, add a regression test asserting the exact `S.docTitle` string produced by its `open-evidence-doc` handler for all three fallback branches (`action.label` present; `action.label` absent, `action.ref` present; both absent → `'(untitled)'`) — written and verified against the CURRENT inline composition, so task 7.4's swap has something real to regress against. No existing test in `test/` exercises this controller line today (verified: no test requires `controllers/drilldown.js` or `controllers/index.js`; `test/drilldown.test.js:778-786` only checks the dispatched action shape, upstream of this reducer). Place it in a new small test file or as an addition to an existing test that already exercises this controller's dispatch path.
- [x] 7.1 Migrate `drilldown.js:476` (`icons.ticket + ' [1] TICKET'`) to `sectionHeader({ icon: icons.ticket, label: '[1] TICKET' })`, preserving the exact rendered text. (Already covered by `test/drilldown.test.js:104-107`.)
- [x] 7.2 Migrate `drilldown.js:516` (`timelineTitle`) and `:519`/`:520` (`gatesTitle`/`evidenceTitle`) to `sectionHeader({ icon, label: '[n] LABEL' })` for the base composition, keeping each title's dynamic suffix (malformed count / cycle number) string-concatenated onto the result exactly as today. (Already covered by `test/drilldown.test.js:104-107`.)
- [x] 7.3 Migrate `ticketDetail.js:54` (`icons.description + ' DESCRIPTION'`) and `:68` (`icons.comments + ' COMMENTS'` + optional count suffix) to `sectionHeader({ icon, label })` for the base pair, keeping `:68`'s dynamic count suffix appended after, unchanged. (Already covered by `test/ticketDetail.test.js:78-96`.)
- [x] 7.4 Migrate `controllers/drilldown.js:116` (`icons.evidence + ' ' + (action.label || action.ref || '(untitled)')`) to `sectionHeader({ icon: icons.evidence, label: action.label || action.ref || '(untitled)' })` — only after task 7.0's regression test exists and passes against the pre-swap code.
- [x] 7.5 Do NOT touch `drilldown.js:302` (`icons.pr + ' '` prefix) or `:413` (`icons.branch + ' ' + (run.branch || ...)`) — both are mid-row content prefixing a dynamic per-row value, not a static section-header title; outside `sectionHeader`'s "icon + static label" contract (design.md Decision 7's own exclusion note).
- [x] 7.6 Run `drilldown.js`'s and `ticketDetail.js`'s existing test suites (which genuinely cover their respective migrations), task 7.0's new `controllers/drilldown.js` regression test (which now covers that migration), and the full test suite, to confirm byte-identical output and zero regressions.
- [x] 7.7 Update `specs/dashboard-iconography/spec.md`'s delta so its SHALL and scenario no longer carve out these three files (they are now migrated, not deliberately excluded) — confirm the delta's final text is what should land in the canonical `openspec/specs/dashboard-iconography/spec.md` on re-archive.
