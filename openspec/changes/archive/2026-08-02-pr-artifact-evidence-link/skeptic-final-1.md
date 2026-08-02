## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Scope of the actual change.** `git log --oneline main..HEAD` shows two commits on this
  branch: `969ad1c` (CON-57, a separately-shipped settings screen already sitting on the branch,
  merged via PR #56 before CON-55 execution started) and `c30e917` (the CON-55 work itself).
  I reviewed `git show --stat c30e917` and `git show c30e917 -- <file>` per-file rather than
  `git diff main...HEAD` (which would conflate the two), and confirmed the CON-55 commit touches
  exactly: `core/roles/orchestrator.md`, `lib/ui/icons.js`, `lib/ui/screens/drilldown.js`,
  `lib/ui/watch.js`, the change's own openspec artifacts, and `test/drilldown.test.js` /
  `test/watch.test.js` — matching evaluation-1.md's own scope claim and the ticket's five ACs,
  nothing beyond.

- **AC1 (`pr` event emitted at PR creation, `url`/`label` fields).** Read
  `core/roles/orchestrator.md:537-553`: Phase 3 Delivery step 4 runs `gh pr create`; the new step 5
  emits `scripts/concertino/emit-event.sh pr ticket=$TICKET_ID role=orchestrator url="$PR_URL"
  label="<short label>"` immediately after, before step 6 ("post PR link to ticket"). I manually
  invoked `scripts/concertino/emit-event.sh pr ticket=SKEPTIC-SCRATCH-CON55 role=orchestrator
  url="https://github.com/example/repo/pull/1" label="PR: test"` from the worktree and inspected
  the resulting line in the **main checkout's** `.concertino/runs/SKEPTIC-SCRATCH-CON55/events.jsonl`
  (the script resolves the main checkout via `git rev-parse --git-common-dir`, by design — see the
  script's own header comment): `{"t":...,"kind":"pr","project":"concertino",
  "ticket":"SKEPTIC-SCRATCH-CON55","role":"orchestrator","url":"https://github.com/example/repo/pull/1",
  "label":"PR: test"}` — confirms the generic `k=v` writer needs no change to accept an arbitrary
  `pr` kind, and no `ref` field is written (matches the `evidence-telemetry` spec's "no ref" scenario).
  Cleaned the scratch run dir up afterward.

- **AC2 (recognized + rendered distinctly).** Read `lib/ui/screens/drilldown.js`:
  `evidenceItems()` filters `ev.kind === 'evidence' || ev.kind === 'pr'` (line ~245);
  `evidenceLines()` prefixes a `pr`-kind entry with `icons.pr + ' '` instead of the plain `▸ `/`  `
  selection-marker prefix (line ~298); `describeEvent()` gains `case 'pr': return { label: 'PR
  opened', detail: ev.url || '' }`. `icons.js` adds `pr: '⏏'` (U+23CF, Miscellaneous Technical
  block) — matches the file's own documented `Emoji_Presentation=No` glyph-class constraint.

- **AC3 (Enter opens OS browser instead of docview).** `handleKey()`'s `drillFocus === 'evidence'`
  branch (line ~703) now checks `ev.kind === 'pr'` first and returns `{ type: 'open-external-url',
  ticket, url, label }`; `watch.js` adds `openInBrowser(url)` (`execFileSync('xdg-open', [url], {
  stdio: 'ignore' })`, no internal catch) and a `case 'open-external-url':` handler (line ~1943)
  that calls it inside try/catch, leaving `mode` untouched either way (never transitions to
  `docview`).

- **AC4 (file-based Enter unaffected).** The `evidence`-kind branch of `handleKey()` is untouched
  (still returns `open-evidence-doc` with the original `ref`/`label` fields). Confirmed by
  `test/drilldown.test.js`'s `'↵ on a selected file-based entry is unaffected by a pr entry also
  being present'` and `test/watch.test.js`'s end-to-end `'Enter on a file-based evidence entry
  still opens docview...'`, both of which I ran (see below) rather than took on faith.

- **AC5 (graceful failure, visible message).** `open-external-url`'s handler catches any throw
  from `openInBrowser` and sets `drillNotice = 'could not open ' + action.url + ' in a browser: '
  + e.message`. Confirmed `drillNotice` is actually rendered on screen: `drilldown.js:605-606`
  renders `notice` (sourced from `state.drillNotice`, wired at `render()`'s call site,
  `drilldown.js:754`) in red via `f.red(...)` — this is the same path the pre-existing
  `restart-confirmed` failure handler already uses (`watch.js:2008`), so no new UI plumbing was
  invented.

- **Tests — ran them myself, not trusting the evaluator's paste.**
  `node --test test/drilldown.test.js test/watch.test.js` → 174/174 pass, including all 5 new
  `drilldown.test.js` CON-55 cases and all 7 new `watch.test.js` CON-55 cases (3 unit tests for
  `openInBrowser`'s success/non-zero-exit/missing-binary paths using a PATH-shadowed fake
  `xdg-open` — never touching the real `/usr/bin/xdg-open` on this box — plus 4 end-to-end
  `watch()` tests driving real keypresses through a fake session/stdin harness).
  Full `npm test` (1199 `node --test` cases + all `test/scripts/*.test.sh` suites) → `tests 1199,
  pass 1199, fail 0`, exit 0. No regressions anywhere in the suite.

- **openspec validate.** `openspec validate pr-artifact-evidence-link --strict` → `Change
  'pr-artifact-evidence-link' is valid` (re-ran it myself; matches tasks.md 6.4's note about the
  correct flag).

- **Orchestrator renumbering sanity.** Read `core/roles/orchestrator.md:525-655` in full: the new
  step 5 pushes the old steps 5/6 to 6/7 within Phase 3 Delivery; checked every other `step N`
  cross-reference in the file (`grep -n "step 5\|step 6\|step 7"`) and confirmed the only other
  hits are to a *different* numbered list (the "Triaging a suggested follow-up" sub-procedure's own
  step 5, and Phase 4's own step 5) — no dangling reference was broken by the insert.

- **Design-doc decisions actually implemented, not just claimed.** Spot-checked each of design.md's
  6 decisions against the diff: Decision 1 (distinct `pr` kind, not an `evidence` variant) ✓,
  Decision 2 (merge into one list, event order preserved, last-wins semantics needing no dedup
  code) ✓, Decision 3 (new `open-external-url` action, `open-evidence-doc` untouched) ✓, Decision 4
  (`execFileSync`-based, synchronous, one helper in `watch.js`) ✓, Decision 5 (icon replaces the
  selection marker entirely for `pr` entries, selection still visible via `f.bold`) ✓ — confirmed
  the code comment above `prefix = ev.kind === 'pr' ? icons.pr + ' ' : (...)` matches this exactly,
  Decision 6 (emission point at Phase 3 step 4→5) ✓.

- **Root-cause note in evaluation-1.md/files-modified.md.** This ticket adds a feature rather than
  fixing a bug, so `systematic-debugging.md`'s regression-test requirement doesn't apply in the
  usual sense; the one debugging note recorded (a test-harness shebang pitfall, not a product bug)
  is honestly scoped as such and doesn't misrepresent itself as a product fix.

- **No UI/design-standard review applicable.** This project has no configured design standard and
  the ticket is a TUI-only change (no dev server / web UI to screenshot); the evaluator marked
  Phase 3 N/A for the same reason, which I independently confirm — there is no `scripts/concertino/
  start-servers.sh`-style web view here to judge visually.

### Verdict: CONFIRM

### Non-blocking notes
- (Pre-existing, not introduced by this change, already flagged by both the skeptic design gate
  and the evaluator) `tasks.md` 6.4 and `core/roles/orchestrator.md:468` reference `openspec
  validate --change <name>`, a flag the installed CLI doesn't accept. Worth a small repo-wide
  follow-up ticket; out of scope here.
