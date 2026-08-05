## Context

`lib/ui/layout.js` already unified box-drawing (`box()`, `hsplit()`) and
selection-window scrolling (`selectionWindow()`); `lib/ui/screens/docview.js`
already unified long-document scroll (`windowBody`/`clampScroll`/
`scrollDelta`), reused by `ticketview.js` and `drilldown.js`. Those two
consolidations mean CON-71's "four scrollable-viewport implementations"
framing is largely already resolved by prior work (CON-6/CON-27 and the
docview extraction) — verified during planning, not assumed. What is still
genuinely duplicated, verified by reading every call site, is:

- **Confirm dialogs**: `lib/ui/screens/fleet/sections.js`'s `buildHeadTail`
  (clear-queue, force-start, quit — three near-identical blocks in one
  function) and `lib/ui/screens/drilldown.js`'s `renderDrilldown` (kill/
  restart) each independently push `[warning line, hint line]` with the same
  shape: `f.red(...) ` or `f.yellow(...)` warning, then
  `f.dim('  y confirm ...   (any other key) cancel')`.
- **Text-input fields**: `lib/ui/screens/fleet/sections.js`'s prompt block,
  `lib/ui/screens/escalation.js`'s reply block, and `lib/ui/banner.js`'s
  reply block each independently render `'  ' + f.bold(label) + f.dim(' › ')
  + f.truncate(value, cols - 14) + '▏'` plus a `'  ' + f.red(f.truncate(error,
  cols - 4))` error line — verified byte-for-byte identical across all three.
  **`lib/ui/screens/ticketdraft.js`'s field rendering was checked during the
  design gate's first round and does NOT match this shape** (see below) —
  removed as a consumer.
- **Footer height accounting**: `f.hintLines(hints, cols)` (format.js) already
  returns the wrapped footer lines. Of the seven screens with a footer
  (drilldown, launchplan, escalation, ticketview, docview, fleet, and
  `settings.js` — the last added to this enumeration in design-gate round 4;
  `settings.js:242` also builds its footer via `f.hintLines`, missed in the
  original count), `drilldown.js` (`footerRows = f.hintLines(...)` then
  `footerRows.length` reused later in `belowRow`) and `launchplan.js` (line
  289) genuinely re-derive the row count a second time. **`escalation.js`,
  `ticketview.js`, `docview.js`, fleet, and `settings.js` were checked and do
  NOT exhibit this duplication** (`settings.js` has no `opts.rows`-based
  height budget at all, so nothing there re-reads the footer's row count) —
  all five removed as consumers (see below).

### Design-gate round 1 findings (verified against source, not assumed)

- `ticketdraft.js:58-67` renders each field as a multi-line wrapped textarea:
  an active marker + bold `'[key] label'` header line, N
  `textwrap.wrap(text, innerWidth)` body lines, and (when active) a bare
  `'    ▏'` cursor line with no label/`' › '`/single-value shape at all. This
  is a different widget shape entirely from `inputLines`'s single-line
  contract, not a byte-for-byte match — unifying it would require designing
  a second, distinct widget (out of scope for this change; see proposal.md's
  scoping note) rather than reusing `inputLines`.
- `escalation.js`'s footer (its own lines ~241-249) is one hardcoded
  `f.dim(...)` line, never built via `f.hintLines`; its `belowBoxRows += 1`
  is a correct fixed constant, not a re-derivation of anything computed
  elsewhere in the file.
- `ticketview.js`'s footer (`f.dim('  esc back')`) and its `CHROME_ROWS_BASE`
  viewport budget are both fixed constants — the file has no `hintLines`/
  `footerRows`/`belowRow` references at all.
- `docview.js`'s footer (`footerLine()`) is a hand-built single line (`esc
  back` plus an optional scroll-position range); `DOC_CHROME_ROWS` is a fixed
  constant — no `hintLines` references in the file.
- fleet's height budget reads `tail.length` directly off the same array its
  footer hints are already pushed into (`fleet/sections.js`'s own comment
  confirms this is the intentional pattern) — not a second independent
  computation of the same thing.
- `settings.js:242` builds its footer via `f.hintLines` too (added to this
  enumeration in design-gate round 4, missed in round 1's original count),
  but `renderSettings` has no `opts.rows`-based height budget at all — no
  `belowBoxRows`/`targetHeight`/`reservedBelow` computation anywhere in the
  file — so there is nothing there that re-reads the footer's row count a
  second time either.
- **Icon coverage**: `lib/ui/icons.js` is required by `drilldown.js`,
  `launchpad.js`, `ticketDetail.js`, and (design-gate round 3 correction —
  verified fresh against source, `fleet/sections.js:8` requires it too)
  `fleet/sections.js`, which already icon-prefixes its three
  non-status-governed section titles — QUICK START (`sections.js:136`),
  QUEUED (`sections.js:153`), METRICS (`sections.js:180`) — via inline `icon +
  ' ' + label` composition. Fleet's headers are therefore NOT missing icon
  coverage; the remaining work there is narrower than for the other screens:
  migrate those three existing inline compositions to the new
  `sectionHeader()` widget (Decision 4/6, below) rather than add coverage
  that doesn't exist yet. `docview.js`, `ticketview.js`, `ticketdraft.js`,
  `escalation.js`, `settings.js`, and `launchplan.js` have no icon-prefixed
  section headers at all — genuinely missing coverage, added fresh via
  `sectionHeader()`.

## Goals / Non-Goals

**Goals:**
- One pure implementation each for confirm-dialog lines, text-input-field
  lines, and footer-lines-with-row-count, under `lib/ui/widgets/`.
- Every existing call site of these three shapes uses the new widget instead
  of its own inline construction — screens shrink, behavior does not change.
- Icon coverage extended to every screen's section/pane headers via a small
  `header.js` widget, reusing `lib/ui/icons.js`'s existing glyph table (no
  new glyphs unless a screen has no fitting existing glyph — verified during
  implementation, escalated if a genuinely new glyph is needed since that is
  a designed, restricted vocabulary per `dashboard-iconography`'s own
  Decision 2).
- A pure `emptyState()` widget mirroring `launchpad.js`'s existing
  `teamNotFoundMessage` shape, for reuse by other panes' "nothing here"
  branches.
- Zero change to any key binding, `handleKey` return-action shape, or
  `render(state, opts) -> string` call signature. Every existing screen test
  keeps passing unchanged.

**Non-Goals:**
- Re-deriving `selectionWindow`/`windowBody`/`clampScroll`/`scrollDelta` —
  already shared, out of scope (see Context).
- A `STATUS_COLOUR`/`ROLE_COLOUR` redesign — already a single shared table,
  used consistently; no drift found during planning.
- A line-by-line audit of every possible empty/error branch across all six
  screens — `emptyState()` is added and applied where a pane already
  hand-rolls a "nothing here" message today; further gaps are natural
  follow-up tickets (see proposal.md's scoping note).
- Changing the `reservedBelow`/`belowBoxRows`/`targetHeight` growth math
  itself (dashboard-full-height-layout's own contract) — only the footer's
  own row-count sub-computation moves into the new widget; the surrounding
  height-budget arithmetic per screen is unchanged.

## Decisions

**Decision 1 — `lib/ui/widgets/confirm.js`: `confirmLines({ warning,
confirmHint })`.** Returns exactly two lines: `['  ' + warning, f.dim('  ' +
confirmHint)]`. The caller still composes the warning text itself (verb,
ticket id, consequence wording, colour) — this widget only owns the shared
two-line shape and the `'  '` indent/`f.dim` wrap convention, not the wording,
since the wording is deliberately different per gate (fleet's clear-queue
names a dropped-ticket count; drilldown's kill/restart names an
un-resumability consequence) and CON-39/CON-29's own design docs already
require that specificity ("no vague are-you-sure"). Applied at fleet's three
gates and drilldown's kill/restart gate, replacing their inline two-line
pushes with a call to `confirmLines`.

*Alternative considered*: a fully parameterised `confirmDialog({ verb,
subject, consequence, confirmKey })` that also generates the warning text.
Rejected — the four warnings' wording is genuinely different (count-based vs
consequence-based vs a plain yes/no), and forcing them through one template
would either lose specificity or need as many parameters as the inline code
already takes; the two-line envelope is the actual duplication, not the
prose.

**Decision 2 — `lib/ui/widgets/textinput.js`: `inputLines({ label, value,
cols, error })`.** Returns `[inputLine]` or `[inputLine, errorLine]`:
`inputLine = '  ' + f.bold(label) + f.dim(' › ') + f.truncate(value || '',
Math.max(0, cols - 14)) + '▏'`; `errorLine = '  ' + f.red(f.truncate(error,
Math.max(0, cols - 4)))` when `error` is truthy (the `'  '` indent matches
all three real call sites — `fleet/sections.js`, `escalation.js`,
`banner.js` — verified byte-for-byte during the design gate's first round).
This is a byte-for-byte extraction of the shape common to `fleet/
sections.js`'s prompt block, `escalation.js`'s reply block, and `banner.js`'s
reply block (verified by reading each), so applying it changes no rendered
output at those three sites. `banner.js`'s reply label is `'reply'`, fleet's
is `'new run'`, matching today. `ticketdraft.js`'s field rendering is a
different shape (see "Design-gate round 1 findings" above) and is not a
consumer of this widget.

*Alternative considered*: also owning cursor/backspace key handling.
Rejected — each caller's `handleKey` already threads distinct action-type
names (`banner-reply-type` vs `prompt-type` vs `escalation reply` vs
ticketdraft's field actions) through to different downstream state, and unifying
that is a `handleKey`/action-shape change this ticket's own acceptance
criteria ("no behavior change to key bindings or event semantics") forbids
touching. `inputLines` is render-only.

**Decision 3 — `lib/ui/widgets/footer.js`: `footer({ hints, cols })`.**
Returns `{ lines: f.hintLines(hints, cols), rows: lines.length }` — a thin
wrapper, deliberately, since `f.hintLines`'s own wrapping algorithm is
unchanged and already correct (CON-26/CON-43 already fixed its bugs); the
gap being closed is purely "own the row count so a caller never re-derives
`.length` at a second call site out of sync with the first." Applied only to
`drilldown.js` and `launchplan.js` — the two screens verified during the
design gate's first round to actually duplicate this computation.
`escalation.js`, `ticketview.js`, `docview.js`, fleet, and `settings.js`
build their footers from fixed constants, read the row count from a single
place already, or (settings.js) never budget height against `opts.rows` at
all (see "Design-gate round 1 findings" above) and are not consumers of this
widget — forcing them through `f.hintLines` would be an unplanned rendering
change, not a pure relocation.

**Design-gate round 2 finding.** `drilldown.js`'s pre-computed `footerRows`
is built by a three-way branch — `confirm` / `evidenceFocused` / default —
but only the latter two genuinely call `f.hintLines` and belong to
`footer()`'s scope. The `confirm` branch's `footerRows = ['confirm-
placeholder', 'confirm-placeholder']` is not a footer at all: it stands in
for the *confirm dialog's* row count (the real content, built later at the
actual confirm-block render site, is Decision 1's `confirmLines()` output —
already assigned to that call site by tasks.md task 1.4), which is always
exactly 2 lines by `confirmLines`'s own contract. So `drilldown.js` calls
`footer()` for its `evidenceFocused` and default branches only, reading
`.rows` off the result for its height-budget math (replacing its own
`footerRows.length` re-reads at those two branches); its `confirm` branch's
row count instead comes from `confirmLines(...).length` (or an inline `2`
with a comment noting it must stay in sync with `confirmLines`'s fixed
2-line contract) — never routed through `footer()`, since there is no
`hints` array to wrap there. `launchplan.js`'s single footer branch is
unaffected by this distinction and calls `footer()` as originally
described.

*Alternative considered*: having `footer()` also own the surrounding
`belowRow`/`targetHeight` computation end-to-end. Rejected as this ticket's
Non-Goal above states — that arithmetic differs meaningfully per screen
(what else besides the footer counts as "below": a notice block, a confirm
block, a scroll-position line), and collapsing it into one shared function
risks silently changing a screen's height budget rather than only relocating
where its footer-row-count comes from.

**Decision 4 — `lib/ui/widgets/header.js`: `sectionHeader({ icon, label,
colour })`.** Returns `(colour || ((s) => s))(icon + ' ' + label)` — the same
"icon + space + label" composition `dashboard-iconography`'s existing
requirement ("Icons are additive to existing labels, never a substitute for
them") already mandates, factored out so it becomes the one place every
icon+label composition is built, rather than each screen inlining `icon + '
' + label` independently. Two distinct groups of call sites migrate to it:
the six screens with no icon-prefixed headers today (`docview.js`,
`ticketview.js`, `ticketdraft.js`, `escalation.js`, `settings.js`,
`launchplan.js` — genuinely new coverage), and `fleet/sections.js`'s three
existing inline `icon + ' ' + label` compositions (QUICK START, QUEUED,
METRICS — design-gate round 3 correction: already icon-prefixed, migrated to
the widget rather than left as the one remaining inline composition in the
codebase). Icons passed in are always `lib/ui/icons.js` exports — this
widget does not add new glyphs itself.

**Decision 5 — `lib/ui/widgets/empty.js`: `emptyState({ icon, message })`.**
Returns a small array of lines mirroring the codebase's existing dim-styled
"nothing to show" convention — e.g. `fleet/sections.js:228`'s `f.dim('  no
active runs')` and `launchpad.js:318`'s `f.dim('no tickets cached yet —
press r to fetch')` — optionally icon-prefixed via Decision 4's
`sectionHeader` convention when an icon is given. (Design-gate round 4
correction: earlier drafts of this decision cited `launchpad.js`'s
`teamNotFoundMessage` as the exemplar; that function actually lives in
`watch.js` and is rendered via `f.red` at its call site — an error message,
not an empty-state one — so it was the wrong exemplar and is dropped here.)
Applied to panes that currently hand-roll their own "nothing to show" text;
existing wording is preserved verbatim per pane, only the line-construction
plumbing moves.

**Decision 6 — widget module boundary.** Each widget is its own file under
`lib/ui/widgets/` (not one `widgets.js` god file) — mirrors this codebase's
existing one-concept-per-file convention (`layout.js`, `format.js`,
`icons.js` are each already single-purpose), and keeps each widget's own
unit test file 1:1 with its source file
(`test/widgets/confirm.test.js` etc.), consistent with how `format.test.js`/
`layout.test.js` are organised today.

**Decision 7 (fold-in, post-delivery follow-up) — migrate the three
remaining inline `icon + ' ' + label` compositions.** The first delivery
(PR #63) deliberately left `drilldown.js`'s four panel titles
(`drilldown.js:476,516,519,520` — TICKET/TIMELINE/GATES/EVIDENCE),
`ticketDetail.js`'s two headers (`:54,68` — DESCRIPTION/COMMENTS), and
`controllers/drilldown.js`'s `docTitle` composition (`:116`) out of scope,
flagged as a known follow-up. Per human fold-in direction (a real,
dashboard-answered decision — see ticket.md's "Additional Scope" and
workflow-state.md's provenance note), this change now also migrates those
seven call sites to `sectionHeader()`:
- `drilldown.js:476` (`icons.ticket + ' [1] TICKET'`) → `sectionHeader({
  icon: icons.ticket, label: '[1] TICKET' })`.
- `drilldown.js:516/519/520` (`timelineTitle`/`gatesTitle`/`evidenceTitle`)
  each compose a base `icon + ' [n] LABEL'` string, with `timelineTitle` and
  `gatesTitle` appending a further dynamic suffix (malformed-count / cycle
  number) AFTER that base. `sectionHeader({ icon, label: '[n] LABEL' })`
  replaces only the base composition; the dynamic suffix continues to be
  string-concatenated onto its result exactly as today — Decision 4's
  contract is scoped to the icon+label pair, not to a title's entire
  string, so this is not a widening of that contract.
- `ticketDetail.js:54/68` (`icons.description + ' DESCRIPTION'` /
  `icons.comments + ' COMMENTS' + optional count`) → same pattern:
  `sectionHeader({ icon, label })` for the base pair, with `:68`'s dynamic
  comment-count suffix still appended after, unchanged.
- `controllers/drilldown.js:116` (`icons.evidence + ' ' + (action.label ||
  action.ref || '(untitled)')`) → `sectionHeader({ icon: icons.evidence,
  label: action.label || action.ref || '(untitled)' })`.

Two call sites verified NOT to be part of this migration (both already
correctly excluded by `dashboard-iconography`'s existing "Icons are
additive" requirement, not by Decision 4): `drilldown.js:302`'s
`icons.pr + ' '` prefix and `drilldown.js:413`'s `icons.branch + ' ' +
(run.branch || ...)` are mid-row content prefixing a per-row dynamic value,
not a static section/pane header title — outside `sectionHeader`'s "icon +
static label" contract, unchanged by this change.

## Risks / Trade-offs

- [Risk] A screen's inline construction differs from the new widget's output
  in some subtle whitespace/colour detail not caught by reading the source →
  Mitigation: every widget extraction is verified against that screen's
  existing test fixtures/snapshots before and after the swap; the evaluator's
  spec-conformance pass re-runs the full existing test suite, which is the
  concrete check for "no behavior change." **(Design-gate round 5
  correction, fold-in scope):** this mitigation held for six of Decision 7's
  seven call sites (`drilldown.js`'s four panel titles and `ticketDetail.js`'s
  two headers all have direct existing assertions on their exact rendered
  strings — `test/drilldown.test.js:104-107`, `test/ticketDetail.test.js:
  78-96`), but NOT for `controllers/drilldown.js:116`'s `docTitle`
  composition — no existing test in the suite exercises that controller
  line at all. Task 7.0 adds that missing regression test, against the
  pre-swap composition, before task 7.4's swap lands, so this mitigation
  now genuinely holds for all seven sites rather than overstating coverage
  for the one it didn't.
- [Risk] Widening icon coverage to more screens could visually clutter a
  screen not designed with icon-prefixed headers in mind → Mitigation:
  `dashboard-iconography`'s own existing requirements ("Icons are additive,"
  "Icons never duplicate what STATUS_COLOUR already signals," "stay within
  the existing width budget") already govern every new application; the
  final-gate skeptic checks new usages against those requirements same as
  any other.
- [Risk] Touching four already-carefully-commented call sites (fleet
  confirm gates, drilldown confirm gate) for Decision 1 risks losing the
  load-bearing "checked BEFORE" ordering comments that document why one gate
  intercepts a keypress before another → Mitigation: only the two rendered
  *lines* move into `confirmLines()`; the gate-ordering logic in `handleKey`
  is untouched by this change, and those comments stay exactly where they are.

## Migration Plan

Pure refactor, no data/schema migration. Land as one change: add
`lib/ui/widgets/*.js` + tests, then swap each call site, verified by the
existing test suite passing unchanged plus new widget unit tests. No
feature flag or staged rollout needed — behavior is unchanged by
construction (Decisions 1-5 are extractions, not rewrites).

## Open Questions

None outstanding — every decision above was resolved by reading the actual
call sites during planning rather than left open for the executor to
discover.
