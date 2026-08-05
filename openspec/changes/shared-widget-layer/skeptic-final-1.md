## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth re-established**: read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  both spec deltas (`specs/dashboard-shared-widgets/spec.md`,
  `specs/dashboard-iconography/spec.md`), `files-modified.md`, and `evaluation-1.md`
  (treated as claims, not fact) in the worktree at
  `/home/matt/Development/concertino/.concertino/worktrees/task/shared-widget-layer-polish/CON-71`.
  `git log` confirms a single commit `856d57d` on top of `main` (`568da55`).

- **Test suite, re-run fresh, not trusted from the evaluator's paste**:
  `node --test` → `tests 1392, pass 1392, fail 0, cancelled 0, skipped 0` (I ran this myself,
  not copied from `evaluation-1.md`). `npm test` (full suite incl. the bash script suites)
  exits 0. `git diff main...HEAD --stat -- test/` shows only 5 new files under
  `test/widgets/*.test.js` (141 new lines) — no existing test file edited or deleted, which is
  consistent with "existing screen tests keep passing unchanged."

- **AC1 ("New widgets are pure functions with their own unit tests; screens shrink
  accordingly")**: read all five widget files (`lib/ui/widgets/{confirm,textinput,footer,
  header,empty}.js`) — each is a pure function, no I/O/ambient state, matching design.md
  Decisions 1-5 exactly. Read all five test files — each exercises real shape/edge-case
  assertions (byte-for-byte expected strings, purity via `deepEqual` on repeated calls,
  wrap/truncation-width edge cases), not smoke tests. `git diff main...HEAD --stat` confirms
  every named call site (`fleet/sections.js`, `drilldown.js`, `escalation.js`, `banner.js`,
  `launchplan.js`, `docview.js`, `ticketview.js`, `ticketdraft.js`, `settings.js`) shrank by
  replacing inline blocks with widget calls. Met.

- **AC2 ("No behavior change to key bindings or event semantics; existing screen tests keep
  passing; facade exports preserved")**: `git diff main...HEAD -- <all 9 modified screen
  files> | grep -n "handleKey\|module.exports"` shows zero diff hunks touching any
  `handleKey` function body or any `module.exports` statement — the only `handleKey` string
  hits are inside untouched comments. Manually diffed every call site
  (fleet's 3 confirm gates + prompt + empty line, drilldown's confirm/footer branches,
  escalation's reply + tag/phase header, banner's reply, launchplan's title/footer/empty,
  docview's title, ticketview's header, ticketdraft's field headers, settings's
  section/field titles/empty states) against the widget's own contract and confirmed each
  swap is byte-for-byte equivalent (e.g. ran `node -e` reproducing `escalation.js`'s
  `sectionHeader({label: tag+'  '+phase})` against the pre-change inline expression —
  identical output). 1392/1392 tests green, 0 skipped. Met.

- **AC3 ("A new screen can be assembled from widgets + a controller without copying layout
  math from an existing screen")**: the five widgets (confirm/input/footer/header/empty)
  give a new screen reusable building blocks for the shapes the ticket names. Non-goals in
  design.md explicitly and deliberately leave `reservedBelow`/`belowBoxRows` height-budget
  arithmetic itself out of scope (only the footer's row-count sub-computation moves) — that
  scoping was reviewed across 4 design-gate skeptic rounds and is not something this final
  gate re-litigates. Reasonably met given the ticket's own scoping note.

- **Spec-delta accuracy — independently verified, found a real gap the evaluator flagged
  but passed anyway.** `specs/dashboard-iconography/spec.md`'s MODIFIED requirement adds,
  unqualified: *"Screens that compose an icon with a label SHALL do so via
  `lib/ui/widgets/header.js`'s `sectionHeader` rather than inlining `icon + ' ' + label`
  independently"* — this text fully replaces the corresponding requirement in
  `openspec/specs/dashboard-iconography/spec.md` once merged (confirmed by reading the
  current baseline spec — it's a straight requirement-body replacement, not additive). I
  independently re-ran the grep the evaluator's Phase 1 cited and confirmed it myself:
  `lib/ui/screens/drilldown.js:476,516,519,520` (four panel titles — TICKET/TIMELINE/
  GATES/EVIDENCE — each still `icons.X + ' [n] LABEL'`), `lib/ui/ticketDetail.js:54,68`
  (DESCRIPTION/COMMENTS, each still `icons.X + ' LABEL'`), and
  `lib/ui/controllers/drilldown.js:116` (`icons.evidence + ' ' + ...`) are all still inline
  `icon + ' ' + label` compositions, untouched by this change. `design.md`'s Decision 4 and
  `tasks.md`'s task 4.x deliberately and explicitly scope these out (verified across 4
  design-gate rounds) — that scoping decision itself is sound and I am not asking for it to
  be reversed. But the spec-delta *text* makes an unqualified, unscoped "SHALL" claim that
  is false the moment this change merges into the baseline `openspec/specs/` tree: a future
  reader of `dashboard-iconography`'s spec (human or agent) will be told every icon+label
  composition already goes through `sectionHeader`, when at least 7 call sites across 3
  files still don't.

### Verdict: REFUTE

### Change Requests

1. **Narrow `openspec/changes/shared-widget-layer/specs/dashboard-iconography/spec.md`'s
   modified requirement and its "An icon-and-label composition goes through the shared
   header widget" scenario (lines ~5, ~15-17) to match what this change actually delivers.**
   Either (a) scope the SHALL to the enumerated consumer set — the six named screens
   (`docview.js`, `ticketview.js`, `ticketdraft.js`, `escalation.js`, `settings.js`,
   `launchplan.js`) plus fleet's three migrated sections — and explicitly note
   `drilldown.js`'s four panel titles, `ticketDetail.js`'s DESCRIPTION/COMMENTS headers, and
   `controllers/drilldown.js`'s `docTitle` as known-remaining inline sites tracked by a
   fast-follow ticket, or (b) drop the unqualified "no screen SHALL inline `icon + ' ' +
   label` independently" framing entirely from this requirement and state it as a
   convention newly established for the six screens' consumer set, not a codebase-wide
   invariant. Either fix is a documentation-only change (no code/test touch required) and
   should not need a new design-gate round — it brings the spec delta in line with
   `design.md`'s own already-reviewed, already-correct scoping, which is the actual
   contract this change was built against.

### Non-blocking notes

- The two evaluator-flagged readability nitpicks (`footer.footer({...})` double-dot call
  style in `drilldown.js`/`launchplan.js`, and the `for...of` push loops in
  `fleet/sections.js` that could be `tail.push(...X(...))`) are cosmetic and correctly
  non-blocking — I would not hold up delivery on either even after fixing item 1 above.
- Widget purity, module boundary (one file per widget, 1:1 test files), and the
  `escalation.js`/`launchplan.js`/`settings.js`/`ticketdraft.js` no-fitting-icon passthrough
  decisions are all sound and correctly justified against `design.md`'s Decision 4/6 and
  `dashboard-iconography`'s restricted-glyph-vocabulary rule (no new glyph invented ad hoc).
