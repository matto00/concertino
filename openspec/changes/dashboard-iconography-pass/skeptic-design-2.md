## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `skeptic-design-1.md` in full to recover round 1's 3 change requests.
- Read the current `proposal.md`, `design.md`, `tasks.md`, and
  `specs/dashboard-iconography/spec.md` in full.
- Confirmed no code has actually changed since round 1: `git status
  --porcelain=v1` shows only the untracked `openspec/changes/` dir, `git diff
  --stat main...HEAD` is empty, and `lib/ui/icons.js` does not exist yet — so
  ground truth for the code (e.g. `launchpad.js`'s `ticketsTitle`) is
  unchanged from round 1 and round 1's citations still hold.
- **CR1 (ticketsTitle mislabeled as "tickets"):** confirmed resolved by
  deletion, not patching. `proposal.md`'s "Apply the new icons to" list no
  longer has a tickets-pane-title bullet (current list: branch row, drill-down
  panel titles, fleet headers, launch pad `EPICS` title, `ticketDetail.js`
  headers, `docview.js` title — 6 bullets, none mentioning `ticketsTitle`).
  `design.md`'s Decision 2 table row for `▤` now reads only "drill-down `[1]
  TICKET` panel title" (no launch pad row), and gained an explicit
  "Alternative considered... rejected once ground truth showed that title
  actually renders the currently-selected epic's name" note. `design.md`
  Non-Goals and `tasks.md` 4.1 both explicitly say "Do NOT touch
  `ticketsTitle`" with the same `launchpad.js:302-306` citation round 1 used.
  Re-confirmed against ground truth directly: `grep -n ticketsTitle
  lib/ui/screens/launchpad.js` still shows it feeding `layout.box`'s `title`
  from `f.truncate(...)` around the selected-epic-name construction, matching
  the citation.
- **CR2 (harness/speed metadata rows had no glyph/task):** confirmed resolved
  by scope removal. `proposal.md` line 11 now reads only "The drill-down's
  branch-name row (the ticket's named example)." — the "and its harness/speed
  metadata rows" clause is gone. `design.md` gained a dedicated Non-Goals
  bullet explaining why (a single icon on a multi-clause free-form string
  "reads as arbitrary"). `design.md`'s Decision 2 table still has no
  harness/speed entry, and `tasks.md` section 2 still has no task touching
  `harnessText`/`speedModelsText` — consistent (nothing promised, nothing
  owed).
- **CR3 (`ticketDetail.js` `metaLine` per-field icons had no glyph/task):**
  same pattern. `proposal.md` line 15's `metaLine` clause is now
  parenthetical and explicitly "out of scope for this pass; see design.md's
  Non-Goals." `design.md` gained a matching Non-Goals bullet citing the exact
  `ticketDetail.js:26-34` line range round 1 cited. `tasks.md` section 5 still
  covers only 5.1 (`DESCRIPTION`) and 5.2 (`COMMENTS`) — no orphaned
  `metaLine` task.
- Cross-checked `tasks.md` 7.3 (the diff-grep verification task) now names
  `harnessText`/`speedModelsText`, `ticketDetail.js`'s `metaLine`, and
  `launchpad.js`'s `ticketsTitle` explicitly as the spots most likely for an
  improvised glyph — this directly addresses round 1's non-blocking note
  about verifying task 7's grep would catch a regression there.
- Re-verified design.md's Decision 2 table (unchanged 11-glyph vocabulary)
  against `lib/ui/format.js`'s `WIDE` table (lines 174-208, re-read fresh)
  with the same Node one-liner as round 1
  (`0x2387,0x25A4,0x25AC,0x25C6,0x25A7,0x274F,0x270E,0x25A3,0x25B6,0x2261,0x25EB`)
  — none fall in any `WIDE` range; the "1 visible column" claim still holds.
- Checked remaining internal consistency: `tasks.md` 1.1's "11 named glyph
  constants" matches Decision 2's 11-row table exactly; the `Impact` section's
  5 modified files (`drilldown.js`, `fleet.js`, `launchpad.js`,
  `ticketDetail.js`, `docview.js`) match `tasks.md` sections 2-6 exactly.

### Verdict: CONFIRM

All three round-1 change requests are resolved, each via the same clean
approach (delete the unsupported scope item rather than invent glyph coverage
to paper over the gap), so `proposal.md`, `design.md`, and `tasks.md` are now
mutually consistent and every remaining scope item has both a Decision 2
glyph and a corresponding task. No code has been touched yet, so this is
still a pure planning-artifact revision — appropriate for a design gate.

### Non-blocking notes

- `specs/dashboard-iconography/spec.md`'s Requirement 1 text says "the single
  source of every icon glyph used across the **six** dashboard screens," but
  its own Scenario immediately below lists exactly 5 files
  (`drilldown.js`, `fleet.js`, `launchpad.js`, `ticketDetail.js`,
  `docview.js`), matching `design.md`/`proposal.md`/`tasks.md`'s consistent
  5-file scope everywhere else. This numeral looks like a leftover from
  before the ticketsTitle bullet was deleted from proposal.md's list (which
  round 1 counted as "six file-level scope items"). It's cosmetic — the
  operative Scenario clause names the 5 files explicitly and unambiguously,
  so no implementer reading this literally could be misled — but worth a
  one-word fix ("six" -> "five") the next time this file is touched, so it
  doesn't linger as a stale cross-reference.
