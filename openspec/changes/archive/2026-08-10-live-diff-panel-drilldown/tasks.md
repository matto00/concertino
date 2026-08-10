## 1. Icon and panel scaffolding

- [x] 1.1 Add a `changes` icon glyph to `lib/ui/icons.js` (Geometric Shapes/Dingbats/Misc
      Technical/Math Operators block only, per that file's own constraint — e.g. `◧` U+25E7).
- [x] 1.2 In `lib/ui/screens/drilldown.js`, extend `DRILL_PANELS` to
      `['ticket', 'timeline', 'gates', 'evidence', 'changes']` and update every place that assumes
      four panels (digit-key handling in `handleKey`, the `1`-`4` range check, footer hint text).

## 2. `watch.js`: per-poll diff computation (gated, non-pure)

- [x] 2.1 Add a small module (or inline helper in `watch.js`) that, given a worktree path, returns
      `{ stat: <parsed lines>, error: null }` or `{ stat: null, error: <message> }` via
      `execFileSync('git', ['diff', '--stat', '--no-color'], { cwd, encoding: 'utf8', timeout:
      2000 })` wrapped in try/catch — never throws.
- [x] 2.2 In `draw()`, gated on `S.mode === 'drilldown' && S.drillTicket` (same gate as the existing
      `drillTicketText`/EVIDENCE-index clamp block), resolve the current run, check
      `run.worktree && fs.existsSync(run.worktree)`, and compute `S.drillDiffStat` accordingly —
      `null`/a sentinel when the worktree is gone, the parsed stat output otherwise.
- [x] 2.3 Clamp a new `S.drillChangesIndex` selection state the same way `S.drillEvidenceIndex` is
      clamped today, using the current poll's file list length.
- [x] 2.4 Thread `S.drillDiffStat` (and the file list it implies) into `router.render()`'s opts,
      following `ticketText`'s existing threading pattern.

## 3. CHANGES panel rendering

- [x] 3.1 In `drilldown.js`, add a `changesLines(diffStat, width, opts)` pure function paralleling
      `evidenceLines()` — renders the stat list, one line per changed file, with a `▸ `/`  `
      selection-marker prefix identical to EVIDENCE's convention.
- [x] 3.2 Degradation strings, matching this screen's existing styling (`f.yellow`): "worktree
      removed — CHANGES is only available while a run's worktree exists" when the worktree is gone;
      "no changes" (or similar) when the worktree exists but the diff is empty; "diff unavailable"
      when the `git` call itself failed/timed out this poll.
- [x] 3.3 Wire CHANGES into `renderDrillDown()`'s panel layout as a third stacked pane in the right
      column, below EVIDENCE (see design.md Decision 6) and into the box title (`[5] CHANGES`, via
      `sectionHeader`).
- [x] 3.3a Extend `rightContentWidth()` to fold in the diff-stat lines' own widths, and raise
      `RIGHT_MAX` accordingly (design.md Decision 6) — verify `leftContentW`'s existing floor still
      protects TIMELINE at a narrow terminal width.
- [x] 3.3b Extend the right-column height reconciliation (`gatesBoxHeight + evidenceBoxHeightNatural`
      → include `changesBoxHeightNatural`) and add a `changesFocused` footer branch alongside
      `evidenceFocused` (design.md Decision 6) — do not fold it into the `evidenceFocused` branch,
      since the two panels' footer hint sets differ.
- [x] 3.4 Extend the footer hint logic: `1-5 jump`, `tab cycle` always shown; CHANGES-selection/open
      hints shown only while CHANGES is focused and has at least one file — the focus switch itself
      is never blocked (see design.md Decision 5/6), only the selection-cursor/hint activity is
      content-gated, mirroring `sections.js`'s "only advertise a key that currently does something"
      discipline.

## 4. Full-diff expansion via `docview`

- [x] 4.1 In `lib/ui/controllers/drilldown.js`, add an `open-diff-doc` action: given the selected
      file and the run's worktree, shell `git diff -- <file>` (`execFileSync`, bounded timeout,
      try/catch), truncate to `MAX_DIFF_LINES` with a trailing marker line if exceeded, and
      transition `S.mode = 'docview'` exactly like `open-evidence-doc` does (reusing `S.docBody`/
      `S.docTitle`/`S.docScroll`).
- [x] 4.2 In `drilldown.js`'s `handleKey`, dispatch `open-diff-doc` on the open key while CHANGES
      holds focus and a file is selected (mirroring the existing EVIDENCE `↵` dispatch).
- [x] 4.3 Verify `back-to-drilldown-from-doc`'s existing handler (unchanged) correctly restores
      CHANGES focus and `drillChangesIndex` on `esc` — no new handler needed if `S.mode`/`drillFocus`
      state already round-trips the way EVIDENCE's does; add a regression test if not.

## 5. Documentation

- [x] 5.1 Update `docs/dashboard.md`'s drill-down section: panel list (now five), the key table
      (`1`-`5`, updated `Tab` description), and a short paragraph on CHANGES' live-refresh/
      worktree-gone/truncation behavior, following the existing TICKET/EVIDENCE paragraph style.

## 6. Verification

- [x] 6.1 Add/extend unit tests for `changesLines()`, the diff-stat gating logic in `watch.js`
      (worktree present/absent/git-failure), `open-diff-doc`'s truncation behavior, and
      `handleKey`'s new `5`/open-key dispatch — following this codebase's existing test patterns for
      `evidenceLines`/`open-evidence-doc`.
- [x] 6.2 Run the full verification gate suite (lint/typecheck/tests) and fix any failures before
      handoff.
