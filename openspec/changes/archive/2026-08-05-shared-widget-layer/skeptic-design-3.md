## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- **Round 2 fix (drilldown.js `confirm` branch) is correctly landed.** Read
  `lib/ui/screens/drilldown.js:584-608,633-646` fresh. The current (pre-change)
  code exactly matches design.md's "Design-gate round 2 finding": `footerRows =
  ['confirm-placeholder', 'confirm-placeholder']` for the `confirm` branch (a
  stand-in, not a real `hintLines` call), vs. genuine `f.hintLines(...)` calls
  for `evidenceFocused`/default. `belowRow` at line 608 currently reads
  `footerRows.length` uniformly across all three branches — exactly the bug
  design.md/tasks.md 3.3/spec.md's new scenario ("A non-footer row count is not
  routed through the footer widget") correctly target: only the
  `evidenceFocused`/default branches should read `.rows` from `footer()`; the
  `confirm` branch should derive its row count from `confirmLines(...).length`.
  tasks.md 3.3 and specs/dashboard-shared-widgets/spec.md's new scenario say
  exactly this, consistently. **This round's revision is sound.**

- **Round 1 fixes remain intact.** Re-verified independently:
  - `ticketdraft.js:58-67` — confirmed the field-rendering shape is a
    multi-line wrapped textarea (marker + bold header line + `textwrap.wrap`
    body lines + optional bare `'    ▏'` cursor line), not the single-line
    `label + ' › ' + value + '▏'` shape `inputLines` targets. Correctly
    excluded as a consumer (tasks.md 2.6, design.md Decision 2).
  - Footer-widget consumer list: grepped `escalation.js` (fixed
    `belowBoxRows += 1` constant, no `hintLines`), `ticketview.js` (fixed
    `CHROME_ROWS_BASE = 5` constant, no `hintLines`/`footerRows`), `docview.js`
    (fixed `DOC_CHROME_ROWS` constant, no `hintLines`), and
    `lib/ui/screens/fleet/sections.js` (height budget reads `tail.length`
    directly off the same array hints are pushed into). None re-derive a
    footer row count a second time. `launchplan.js:288` genuinely does:
    `const hintRows = f.hintLines(hints, cols); ... hintRows.length` used
    later in `belowBoxRows`. Matches design.md's claims exactly.

- **Decision 1 (confirm.js) target sites verified.** `fleet/sections.js:303,
  315, 327` push `f.dim('  y confirm clear   (any other key) cancel')` /
  `'  y confirm force-start...'` / `'  q confirm quit...'` — three near-
  identical two-line pushes, matching Decision 1's description.

- **Decision 2 (textinput.js) byte-for-byte claim re-verified.** Grepped all
  three claimed call sites: `fleet/sections.js:329-331`,
  `escalation.js:232-233`, `banner.js:58-60` — all three construct
  `'  ' + f.bold(label) + f.dim(' › ') + f.truncate(value || '', Math.max(0,
  cols - 14)) + '▏'` plus `'  ' + f.red(f.truncate(error, Math.max(0, cols -
  4)))` identically. Decision 2's byte-for-byte claim holds.

- **New issue found (not present in rounds 1-2's findings): the icon-coverage
  premise is factually wrong for fleet.** design.md's Context ("Icon
  coverage" bullet, lines 58-62) and proposal.md's "Why" (lines 36-40) both
  assert, as a "verified by reading every call site" fact, that
  `lib/ui/icons.js` "is required by `drilldown.js`, `launchpad.js`, and
  `ticketDetail.js` only — not `fleet.js`" and that fleet "never actually
  requires it." This is false. `lib/ui/screens/fleet/sections.js:8` does
  `const icons = require('../../icons');`, and the module already uses it at:
  - `sections.js:136`: `title: icons.quickStart + ' QUICK START'`
  - `sections.js:153`: `` title: `${icons.queue} QUEUED (${queueState.pending.length}, running ${queueState.maxConcurrent} at a time)` ``
  - `sections.js:180`: `title: icons.metrics + ' METRICS'`

  These are fleet's only three non-status-governed section titles (the other
  four — NEEDS YOU, FAILED, RUNNING, DONE — are correctly carved out by the
  "status-governed" exclusion tasks.md 4.3 already names). So **fleet already
  has icon coverage on every eligible section header today**, the opposite of
  what design.md/proposal.md claim.

### Verdict: REFUTE

### Change Requests

1. **Fix the false "fleet.js never requires icons.js" premise.** Correct
   design.md's Context "Icon coverage" bullet (lines 58-62) and proposal.md's
   "Why" (lines 36-40) to state that `fleet/sections.js` already requires
   `lib/ui/icons.js` and already icon-prefixes QUICK START, QUEUED, and
   METRICS (`sections.js:136,153,180`) via inline `icon + ' ' + label`
   composition — not that coverage is missing there.

2. **Fix task 4.3's mischaracterized scope.** tasks.md 4.3 currently reads
   "add icon coverage genuinely missing there today" for fleet, which is
   false per (1) — there is no missing coverage on fleet's non-status-governed
   headers. The actual required work for fleet (needed to satisfy
   specs/dashboard-iconography/spec.md's new scenario "An icon-and-label
   composition goes through the shared header widget," which forbids inline
   `icon + ' ' + label` composition at any of the ten named screens including
   `fleet.js`) is to **migrate** the three existing inline compositions at
   `sections.js:136,153,180` to call `sectionHeader({ icon: icons.quickStart,
   label: 'QUICK START' })` etc., rather than to add new glyphs. Reword task
   4.3 so an executor does not skip fleet (reasoning "nothing missing, nothing
   to do") or add duplicate/second icons to already-iconed titles.

3. **Reconcile the "six not-yet-covered screens" count in design.md Decision
   4** with tasks.md's actual seven-screen list (fleet, docview, ticketview,
   ticketdraft, escalation, settings, launchplan — tasks 4.3-4.9). Fleet isn't
   "not-yet-covered" per (1); the framing should distinguish "screens with no
   icon-prefixed headers at all" (six) from "fleet, which has existing inline
   icon+label compositions that need migrating to the widget" (one),
   consistent with the corrected task 4.3.

### Non-blocking notes

- All other Decisions (1, 2, 3-as-revised-in-round-2, 5, 6) and their target
  call-site claims were independently re-verified against source and hold up.
  Once the icon-coverage premise above is corrected, this design should be in
  good shape to proceed.
