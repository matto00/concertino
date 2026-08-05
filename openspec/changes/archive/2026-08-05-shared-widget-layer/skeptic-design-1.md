## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/dashboard-shared-widgets/spec.md`, `specs/dashboard-iconography/spec.md`,
  `workflow-state.md`.
- Confirmed `lib/ui/layout.js` already exports `box`, `hsplit`, `selectionWindow`
  (`lib/ui/layout.js:73,131,155`) and `lib/ui/screens/docview.js` already exports
  `windowBody`/`clampScroll`/`scrollDelta` — the Context section's "already
  resolved" framing for scrollable viewports is accurate.
- Confirmed `lib/ui/icons.js`'s header comment lists `drilldown.js, fleet.js,
  launchpad.js, ticketDetail.js, docview.js` as consumers (icons.js:3-9), and
  `grep -rl "require(.*icons.)" lib/ui/` shows actual requirers are
  `ticketDetail.js`, `controllers/drilldown.js`, `screens/launchpad.js`,
  `screens/drilldown.js`, `screens/fleet/sections.js` only — `docview.js` is
  named but does not require it, `fleet.js` itself doesn't (only its
  `fleet/sections.js` submodule does). This matches the design's claim.
- Confirmed the confirm-dialog shape (Decision 1) is a byte-for-byte match at
  both named call sites: `lib/ui/screens/fleet/sections.js:301-303` (clear-queue)
  and `lib/ui/screens/drilldown.js:634-639` (kill/restart) both push
  `'  ' + warning` then `f.dim('  ' + confirmHint)`.
- Checked Decision 2 (`textinput.js`/`inputLines`) against all four named call
  sites: `fleet/sections.js:329-331`, `escalation.js:232-233`,
  `banner.js:58-60` do match the claimed `'  ' + f.bold(label) + f.dim(' › ') +
  f.truncate(value, cols-14) + '▏'` shape (plus a `'  ' + f.red(...)` error
  line). **`ticketdraft.js`'s field rendering does not match at all** — see
  Change Request 1.
- Checked Decision 3 (`footer.js`) against all six named call sites
  (fleet, drilldown, escalation, launchplan, ticketview, docview) by grepping
  for `hintLines`/`footerRows`/`belowRow`/`belowBoxRows`/`reservedBelow` in
  each file. Only `drilldown.js:584-608` and `launchplan.js:289` genuinely
  exhibit the claimed "call `f.hintLines`, then separately re-derive
  `.length`" duplication. The other three/four do not — see Change Request 2.

### Verdict: REFUTE

### Change Requests

1. **Decision 2 (`textinput.js`) misdescribes `ticketdraft.js`'s field
   rendering — it is not the claimed shape.** Design.md (lines 18-22, 91-98)
   and tasks.md task 2.4 assert `ticketdraft.js`'s draft fields render the
   same `label + ' › ' + truncated-value + '▏'` single-line shape as fleet's
   prompt/escalation's reply/banner's reply, and that extracting `inputLines`
   is a "byte-for-byte extraction... verified by reading each" call site.
   Reading `lib/ui/screens/ticketdraft.js:58-67` shows this is false: each
   field renders as a multi-line wrapped textarea — `marker + f.bold('[' +
   key + '] ' + label)` header line, then N `textwrap.wrap(text,
   innerWidth)` body lines, then a bare `'    ▏'` cursor line when active
   (no label, no `' › '` separator, no single truncated value). There is no
   line in `ticketdraft.js` that matches `inputLines`'s output shape at all.
   `specs/dashboard-shared-widgets/spec.md`'s textinput requirement (line 21)
   names `ticketdraft.js`'s draft fields as a consumer of this exact shape,
   which cannot be satisfied by a pure extraction — applying `inputLines`
   here would require dropping the wrapped multi-line body and active-field
   marker (an unplanned, unreviewed behavior change that breaks this
   ticket's own "no behavior change to key bindings or event semantics" /
   "byte-identical output" acceptance criteria and would visibly regress the
   ticket-draft screen). Required revision: remove `ticketdraft.js`'s field
   rendering as an `inputLines` consumer from design.md Decision 2, tasks.md
   2.4, and the `dashboard-shared-widgets` spec's textinput requirement (or
   scope it down to just `ticketdraft.js:71`'s single error line, which does
   match the errorLine shape), and if the intent was genuinely to unify
   the wrapped-field shape too, design that as its own decision with a
   verified byte-for-byte read of the actual code, the way Decisions 1/2
   were done for the other sites.

2. **Decision 3 (`footer.js`) overstates the "re-derives the row count"
   duplication — true for only 2 of the 6 named screens.** Design.md
   (lines 23-28) and tasks.md 3.3-3.5 / spec.md's footer requirement (line
   37) commit `fleet, drilldown, escalation, launchplan, ticketview, docview`
   to reading `rows` off the new `footer()` widget instead of "re-deriving
   `f.hintLines(...).length`" a second time. Reading each file:
   - `drilldown.js:584-608` and `launchplan.js:289` genuinely do this
     (`footerRows = f.hintLines(...)` then `footerRows.length` reused in
     `belowRow`/height math) — legitimate targets.
   - `escalation.js`'s footer (lines 241-249) is a single hardcoded
     `f.dim(...)` line, never built via `f.hintLines`; its
     `belowBoxRows += 1; // footer line` (line 211) is a correct fixed
     constant, not a duplicated re-derivation of anything computed
     elsewhere.
   - `ticketview.js`'s footer (line 99, `f.dim('  esc back')`) and viewport
     budget (`CHROME_ROWS_BASE = 5`, line 27) are likewise fixed constants —
     the file has zero references to `hintLines`/`footerRows`/`belowRow` at
     all (confirmed by grep).
   - `docview.js`'s footer (`footerLine()`, lines 162-177) is a hand-built
     single line combining `esc back` with an optional scroll-position
     range; `DOC_CHROME_ROWS` (line 40) is a fixed constant. Zero
     `hintLines` references in the file.
   - fleet's height budget reads `tail.length` directly off the array the
     footer hints are already pushed into (`fleet/render.js:156,234`), not a
     second independent computation — `fleet/sections.js:357-359`'s own
     comment states this is the intentional pattern ("callers budget on
     tail.length"), so there is no duplicated `.length` re-read to fix here
     either.
   Forcing `escalation.js`/`ticketview.js`/`docview.js`/fleet through
   `footer()` as currently specified would mean converting their fixed,
   hand-built single-line footers into `f.hintLines`-wrapped multi-hint
   footers — a real rendering/behavior change nowhere described in this
   design, and one that risks the "byte-identical output"/"no behavior
   change" acceptance criteria the rest of this ticket is built on. Required
   revision: re-scope tasks.md 3.3-3.5 and the footer requirement's screen
   list in `specs/dashboard-shared-widgets/spec.md` to the two screens that
   actually exhibit the duplication (`drilldown.js`, `launchplan.js`), or, if
   the four others are meant to genuinely adopt `f.hintLines`-based footers
   too, write that as its own decision with the same before/after rigor
   Decisions 1/2 used (what the new footer content/wording is per screen,
   confirmed against existing tests/fixtures) rather than folding it silently
   into "own the row count."

### Non-blocking notes

- Decision 2's stated `errorLine` formula (`f.red(f.truncate(error,
  Math.max(0, cols - 4)))`, design.md line 95) omits the `'  '` indent that
  3 of its 4 named call sites actually use (`fleet/sections.js:331`,
  `escalation.js:233`, `banner.js:60` all prefix with `'  ' + f.red(...)`).
  Once Change Request 1 is resolved, correct the formula to match the real
  shape (`'  ' + f.red(...)`) so it stays byte-for-byte accurate.
