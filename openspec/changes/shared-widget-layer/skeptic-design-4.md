## Skeptic Report — design gate (round 4)

### What I verified (with evidence)

This was a full fresh pass over `proposal.md`, `design.md`, `tasks.md`, both
spec deltas, and `ticket.md`, with every load-bearing claim re-checked
against the actual source in the worktree — not limited to re-checking round
3's finding.

- **Round 3's fix is correctly landed.** `proposal.md`'s "Why" (lines 36-46),
  `design.md`'s Context (lines 58-71) and Decision 4 (lines 193-207), and
  `tasks.md` task 4.3 all now correctly state that `fleet/sections.js:8`
  requires `lib/ui/icons.js` and already icon-prefixes QUICK START (`:136`),
  QUEUED (`:153`), and METRICS (`:180`) via inline `icon + ' ' + label`
  composition, and correctly reframe fleet's task as **migrating** those
  three inline compositions to `sectionHeader()` rather than adding missing
  coverage. Re-verified fresh: `grep -n "icons" lib/ui/screens/fleet/sections.js`
  shows exactly `:8` (require) and `:136,153,180` (usage) — matches.

- **Decision 1 (confirm.js) target sites.** Read `fleet/sections.js:296-327`
  fresh: three near-identical `tail.push('  ' + f.yellow(...)); tail.push(f.dim('  y confirm ...   (any other key) cancel'))` blocks (clear-queue, force-start, quit). Matches Decision 1.

- **Decision 2 (textinput.js) byte-for-byte claim.** Read all three claimed
  call sites fresh — `fleet/sections.js:329-331`, `escalation.js:231-233`,
  `banner.js:58-60` — all three build `'  ' + f.bold(label) + f.dim(' › ') +
  f.truncate(value || '', Math.max(0, cols - 14)) + '▏'` plus a `'  ' +
  f.red(f.truncate(error, Math.max(0, cols - 4)))` error line, identically.
  Confirmed.

- **Decision 3 (footer.js) consumer/exclusion list, re-derived independently.**
  `drilldown.js:583-608`: `footerRows` built via `f.hintLines` for
  `evidenceFocused`/default, a `['confirm-placeholder','confirm-placeholder']`
  stand-in for `confirm` (2 elements, matching `confirmLines()`'s fixed
  2-line contract), and `footerRows.length` read once at line ~608 into
  `belowRow` — matches design.md's round-2 finding and tasks.md 3.3 exactly.
  `launchplan.js:288-289`: `hintRows = f.hintLines(...)` then
  `hintRows.length` reused in `belowBoxRows` — matches. Grepped
  `escalation.js` (fixed `belowBoxRows` increments, no `hintLines`),
  `ticketview.js` (`CHROME_ROWS_BASE = 5` fixed constant, no
  `hintLines`/`footerRows`), `docview.js` (`DOC_CHROME_ROWS` fixed constant,
  `footerLine()` hand-built, no `hintLines`), and `fleet/sections.js`
  (`tail.length` read directly off the array hints are pushed into, no
  second re-derivation) — all four correctly excluded as claimed.

  **However**, I additionally found `lib/ui/screens/settings.js:242`:
  `for (const line of f.hintLines(hints, cols)) out.push(line);` — a 7th
  screen that also builds its footer via `f.hintLines`, never mentioned in
  design.md's Context ("of the six screens with a footer...") or Decision
  3's exclusion list (which names only `escalation.js`, `ticketview.js`,
  `docview.js`, and fleet as excluded, alongside drilldown/launchplan as
  included — six total). I independently confirmed `settings.js` has no
  `opts.rows`-based height budget at all (grepped the full `renderSettings`
  function: no `rows >`, `belowBoxRows`, `targetHeight`, or
  `reservedBelow`), so it does not duplicate a row-count re-derivation and
  Decision 3's actual scope conclusion (only `drilldown.js`/`launchplan.js`
  are consumers) is still correct in outcome — but the design's own
  "verified during planning, not assumed" claim of an exhaustive six-screen
  enumeration is factually incomplete: it missed a real 7th footer built via
  `f.hintLines`.

- **Decision 4/5/6 and icon-consumer claims.** Confirmed none of the six
  target screens (`ticketview.js`, `ticketdraft.js`, `escalation.js`,
  `settings.js`, `launchplan.js`, `docview.js`) currently `require` icons.js
  (grep across all six — no hits), matching the "genuinely missing coverage"
  claim.

- **Decision 5 (`emptyState()`) exemplar claim — found to be materially
  wrong.** `proposal.md`'s scoping note (line 63), `design.md` Decision 5
  (lines 209-215), `tasks.md` task 5.1, and
  `specs/dashboard-shared-widgets/spec.md`'s Requirement text (line 65) all
  describe the new `emptyState()` widget as "mirroring `launchpad.js`'s
  existing `teamNotFoundMessage` rendering," characterized in design.md as "a
  centered-ish, **dim-styled** short message." I traced `teamNotFoundMessage`
  to its actual definition and found two independent inaccuracies:
  1. It is defined in `lib/ui/watch.js:127` (`function
     teamNotFoundMessage(teamKey) { return 'no team with key "' + teamKey +
     '" — check ticketProvider.teamKey'; }`) — **not** in `launchpad.js` at
     all.
  2. Its actual render call site is `launchpad.js:328-329`: `if (lp.error) {
     out.push('  ' + f.red(f.truncate(lp.error, cols - 4))); }` —
     `teamNotFoundMessage`'s output is wrapped in **`f.red`** (the
     codebase's error-styling convention), not `f.dim`. It is an *error*
     message, not an *empty-state* message.

  The genuine dim-styled "nothing here" convention the widget should be
  modeled on does exist in the codebase — e.g. `fleet/sections.js:228`:
  `if (!runs.length) head.push(f.dim('  no active runs'));`, and
  `launchpad.js:318`: `out.push('  ' + f.dim('no tickets cached yet — press
  r to fetch'));` — but these are not the exemplar the design cites. This
  matters because tasks.md 5.1 tells the executor to match "`launchpad.js`'s
  existing `teamNotFoundMessage` styling," which, read literally, points at
  code that doesn't exist where claimed and isn't styled the way the widget
  is supposed to be styled — an executor who goes to verify against the
  named exemplar will find a contradiction between the instruction and the
  actual convention it should be modeling.

### Verdict: REFUTE

### Change Requests

1. **Correct the `emptyState()` exemplar.** In `proposal.md`'s scoping note
   (~line 63), `design.md` Decision 5 (~lines 209-215), `tasks.md` task 5.1,
   and `specs/dashboard-shared-widgets/spec.md`'s Requirement text (~line
   65), replace the "mirroring `launchpad.js`'s existing `teamNotFoundMessage`
   rendering" framing with the actual dim-styled empty-state convention it
   should model — e.g. `fleet/sections.js:228`'s `f.dim('  no active runs')`
   and/or `launchpad.js:318`'s `f.dim('no tickets cached yet — press r to
   fetch')` — and drop the `teamNotFoundMessage` reference entirely, since
   that function (a) lives in `watch.js`, not `launchpad.js`, and (b) is
   rendered via `f.red` as an error, not `f.dim` as an empty state.

2. **Account for `settings.js` in the footer-widget scope discussion.**
   `design.md`'s Context ("Footer height accounting" bullet and "of the six
   screens with a footer" framing) and Decision 3's exclusion list should
   explicitly name `settings.js` alongside `escalation.js`/`ticketview.js`/
   `docview.js`/fleet as a screen checked and found not to duplicate the
   footer row-count computation (it calls `f.hintLines` once at
   `settings.js:242` with no `opts.rows`-based height budget re-reading that
   result), rather than omitting it from the "verified during planning"
   enumeration entirely. This doesn't change any task's actual scope (the
   correct outcome — `settings.js` is not a `footer()` consumer — already
   holds), but the document's claim of exhaustive verification is currently
   inaccurate as written.

### Non-blocking notes

- All other Decisions (1, 2, 3's core drilldown/launchplan claims, 4, 6) and
  their target call-site claims were independently re-verified against
  source and hold up exactly as described. Once (1) and (2) above are
  corrected, this design should be sound to proceed — these are narrower,
  purely-documentation fixes than round 3's, with no task-instruction
  correctness impact from finding 2 and only a wording/citation impact from
  finding 1.
