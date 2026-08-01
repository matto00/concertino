## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Ground truth diff** — `git diff main...HEAD --stat` (23 files, +693/-13): `lib/ui/icons.js` (new), `drilldown.js`, `fleet.js`, `launchpad.js`, `ticketDetail.js`, `watch.js`, plus 7 test files and planning docs. Read the full diff of every non-test source file.

2. **AC / ticket-constraint tracing**
   - "Named example" (branch row, `drilldown.js:397`): `icons.branch + ' ' + (run.branch || f.dim('(no branch yet)'))` — covers both populated and fallback cases. Confirmed by `test/drilldown.test.js`'s two new tests, which I re-ran (pass).
   - "Degrade honestly / additive, never load-bearing" (ticket constraint): every application is `icon + ' ' + label`, never a substitution — verified in the diff for all 5 files; no label text was removed anywhere.
   - "Must not widen rows past the width-budget accounting, glyph measured not assumed" (ticket constraint): ran `node -e` against `lib/ui/format.js`'s real `visibleLength` for all 11 exported glyphs — every one returns exactly `1`. Confirmed `format.js`/`layout.js` have zero diff hunks (`git diff main...HEAD -- lib/ui/format.js lib/ui/layout.js` empty).
   - "Coordinate with STATUS_COLOUR, icon must not duplicate state" (ticket constraint): NEEDS YOU/RUNNING/FAILED/DONE headings and gate/phase-pipeline `✓`/`✗`/`○`/`●` markers have no diff hunks touching them; `test/fleet.test.js`/`test/drilldown.test.js` assert this negatively and I reran both (pass).
   - Proposal's full application list (branch row, TICKET/TIMELINE/GATES/EVIDENCE panel titles, QUICK START/QUEUED/METRICS, EPICS pane title, DESCRIPTION/COMMENTS, evidence-reader title) — traced each to a diff hunk; all present, all correctly scoped (e.g. `launchpad.js`'s `ticketsTitle` deliberately untouched, confirmed by both the diff and a new negative test).
   - Stray-glyph check (tasks.md 7.3): independently grepped all 11 glyphs (`⎇▤▬◆▧❏✎▣▶≡◫`) across `lib/**/*.js` excluding `icons.js` — zero matches.

3. **The flagged deviation (task 6.1, docview.js → watch.js)** — independently reproduced, not taken on faith:
   - Read `openspec/specs/docview/spec.md:57-60`: pre-existing "docview's exports are generic and reusable, not caller-specific" requirement, explicitly listing "tickets, evidence" as forbidden references.
   - Read `docview.js`'s header comment — independently states the same constraint.
   - Read `test/docview.test.js`'s pre-existing test `'bodyBox and renderDocView never mention ticket/evidence concepts in their own source'` — scans the two exports' source via regex `/evidence/i`; a literal `icons.evidence` call site inside `renderDocView` would trip it.
   - Confirmed via diff that `docview.js` has zero hunks — the fix genuinely lives entirely in `watch.js`'s `'open-evidence-doc'` handler (`lib/ui/watch.js:1630`: `docTitle = icons.evidence + ' ' + (action.label || action.ref || '(untitled)')`).
   - Grepped `docTitle` assignments in `watch.js`: exactly one non-null assignment site (line 1630) and two `= null` resets — so this is genuinely the single real assignment point, not one of several the executor cherry-picked.
   - The icon still rides inside `renderDocView`'s existing `f.truncate(title, cols)` budget since it's part of the `title` string as a whole — confirmed by `test/docview.test.js`'s new truncation test, reran, passes, and manually traced the truncation logic in `docview.js`.
   - Verdict on the deviation: sound, well-documented (both in the diff comment and `files-modified.md`'s dedicated "Deviation" section), and does not violate `dashboard-iconography`'s own spec delta (its scenario only requires the glyph be sourced from `icons.js`, not that the assignment textually live inside `docview.js`).

4. **Fresh gate re-run** (not trusted from evaluator's paste):
   - `npm test` in the worktree → exit 0. Ran `node --test` directly (matching what `npm test` invokes): `995 tests, 995 pass, 0 fail` — matches the evaluator's claimed count exactly, independently reproduced.
   - All 16 bash script-test suites in the `npm test` chain completed with "N passed, 0 failed" (emit-event, persist-evidence, gather-escalation-context, assert-phase, start-servers, watch-smoke, doctor-artifacts, ticket-pattern, escalation-loop, sync-core-resolution, harness-identity, resolve-speed, cleanup, doctor-base-branch, auditor-render, check-merge-readiness) — read the full tail of the log, not just the exit code.

5. **Test quality spot-check** — read the new test blocks in `icons.test.js`, `drilldown.test.js`, `fleet.test.js`, `launchpad.test.js`, `ticketDetail.test.js`, `docview.test.js`, `layout.test.js`. Each icon application has both a positive (icon + unchanged label present) and, where relevant, a negative (STATUS_COLOUR-governed section / right-pane title carries no icon) assertion. These are meaningful — they'd catch a dropped label or a misplaced icon, not just presence-of-any-string.

6. **UI/design judgment** — N/A for this project (no design standard configured, per task instructions); skipped dev-server/screenshot steps accordingly. Read the rendered-output assertions in the tests as a substitute check on visual placement (icon-space-label ordering, truncation-with-ellipsis behaviour) — consistent with the codebase's existing `gateLine` convention (`icon + ' ' + name`) cited in design.md Decision 3.

7. **Non-blocking doc drift** (noted by evaluator, confirmed): `proposal.md:30`'s Impact list still says `docview.js` modified and omits `watch.js` — stale relative to the deviation. `files-modified.md` is accurate. Not blocking; ships fine as-is, worth a touch-up before/at archive.

### Verdict: CONFIRM

### Non-blocking notes
- `proposal.md`'s Impact section (line 30) should be updated to list `lib/ui/watch.js` instead of `lib/ui/screens/docview.js`, matching the justified deviation already correctly recorded in `files-modified.md`.
