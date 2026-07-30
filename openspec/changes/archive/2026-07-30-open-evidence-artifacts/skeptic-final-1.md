## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket ACs traced to code, not just tasks.md claims**:
  1. "Selecting an evidence entry opens it in a reader screen — reusing `ticketview`'s bounded/
     scrollable pane rather than duplicating" → `lib/ui/screens/docview.js` exports `bodyBox`
     (shared box-only core) and `renderDocView` (full-screen composition); `lib/ui/screens/ticketview.js`
     line 77 calls `docview.bodyBox` directly, its old `pane()` helper removed. Confirmed via
     `git diff main...HEAD -- lib/ui/screens/ticketview.js`. This matches the ticket's own Notes
     section ("a shared `docview` screen taking `{title, body}`... with `ticketview` becoming a
     caller"), so this is not a deviation from the ticket's intent.
  2. Scrollable — `docview.js`'s `clampScroll`/`scrollDelta`/`windowBody`, plus a live smoke test
     (below) that actually scrolled a 60-line document and revealed previously-hidden content.
  3. `esc` returns to drill-down with same entry selected — `watch.js`'s
     `back-to-drilldown-from-doc` case leaves `drillFocus`/`drillEvidenceIndex` untouched; confirmed
     live (see smoke test output: `mode after esc= drilldown drillFocus still= evidence index= 0`).
  4. Missing file says so — `watch.js`'s `open-evidence-doc` case try/catches `fs.readFileSync`,
     degrading to `f.yellow('file not found: ' + ref)`; confirmed live against a real nonexistent
     path (smoke test: `missing file render includes "file not found"? true`).
  5. Markdown → plain text, control bytes stripped — confirmed live: a real file with `# Heading`,
     `**markdown**`, and a raw `\x07` byte rendered as `Heading`, `markdown` (no asterisks), and the
     control byte gone from the terminal output.
  6. No key advertised unless bound — `drilldown.js`'s footer branches on `evidenceFocused`:
     unfocused shows `↵ attach`/`k kill`/`r restart` (unchanged), focused shows `↑/↓ select`/`↵ open`/
     `esc back` only, and `handleKey` actually refuses `k`/`r`/`\r`(attach) while focused (not merely
     unadvertised) — verified by reading `lib/ui/screens/drilldown.js:558-627` and
     `test/drilldown.test.js`'s footer-hint tests.

- **Live end-to-end smoke test** (not just unit tests) — wrote and ran a script driving the actual
  `router.handleKey`/`docview.render`/`drilldown.evidenceItems` functions against a real run object
  with a real evidence file and a deliberately-missing one: `\t` → focus, `\r` → open, markdown/
  control-byte stripping visible in the rendered box, `j` → scroll, `\x1b` → back to drilldown with
  focus/selection preserved, then opening the missing entry → "file not found" inside the reader.
  All behaved exactly as designed.

- **Two documented deviations, checked against spec.md rather than task prose**:
  1. `scrollDelta(key, viewportRows)` (two-arg) vs. the design's one-arg mention — the design's own
     prose requires `{ lines: ±viewportRows }` for page keys, which is only computable with
     `viewportRows` in hand; the one-arg signature as literally written could not implement its own
     spec. The two-arg form is required by the design's own semantics and both callers already have
     `viewportRows` at the call site (`docview.js`'s own `handleKey`, `ticketview.js`'s
     `routeHandleKey`). Reasonable, non-scope-changing correction.
  2. Single "showing X-Y of N" row vs. task 1.7's literal "more below/above" phrasing — read
     `windowBody`/`footerLine` (`docview.js:90-99`, `145-159`): both share `contentRows =
     viewportRows - 1`, so the box's rendered window and the footer's reported range always agree,
     including at the document's true last line. spec.md's actual requirement ("a visible indication
     that more content exists") is generic, not prescriptive about a specific glyph/direction — this
     satisfies it and is a genuine internal-consistency improvement (a two-directional reservation
     would either drop the true last line or show a false "more below" at max scroll, per the
     documented reasoning, which I verified against the arithmetic directly). Confirmed by
     `test/docview.test.js`'s "scrolled past the end clamps to the document's true last line" test.
  Neither deviation is a quiet scope change; both are disclosed in `files-modified.md`, documented
  in-code, and spec-compliant.

- **Verification gates re-run myself, fresh**:
  - `node --test` (from `WORKTREE_PATH`): `tests 748, pass 748, fail 0` — reproduced twice
    identically. (Note: `evaluation-1.md` claims "121 passed" for plain `node --test`; my own run
    twice showed 748. This is a discrepancy in the evaluator's own report — but since my
    independently-reproduced result is a clean 748/748 pass with 0 failures, the underlying PASS
    conclusion still holds; flagging only as a non-blocking accuracy note on the evaluator's report,
    not a code defect.)
  - `npm test` (full suite incl. all `test/scripts/*.sh`): completed, all suites reporting
    `N passed, 0 failed`.
  - `openspec validate open-evidence-artifacts --strict`: "Change 'open-evidence-artifacts' is valid".

- **No regressions**:
  - `git diff main...HEAD --stat -- lib scripts` touches exactly `router.js`, `screens/docview.js`
    (new), `screens/drilldown.js`, `screens/ticketview.js`, `watch.js` — `launchpad.js` is untouched,
    so `ticketview.js`'s reachability via `↵` from the launch pad (`open-ticketview` handler,
    unchanged) and the `launchpad-detail-pane` spec's shared-renderer commitment
    (`ticketDetail.buildDetailLines`, also untouched) both hold trivially.
  - Default (unfocused) drill-down `↵`/`k`/`r` bindings are byte-identical to before this change —
    confirmed by reading `handleKey`'s control flow (the `\t`/evidence-focus branches sit strictly
    before the pre-existing `↵ attach`/`isLive` `k`/`r` branches, which are otherwise untouched) and
    by `test/drilldown.test.js`'s "default focus... advertised, evidence keys are not" test.
  - `ticketview.js`'s short-content case is tested byte-identical with/without a `rows` budget
    (`test/ticketview.test.js`), satisfying design.md's own stated risk about the refactor changing
    visual output for content that already fit.

### Non-blocking notes
- `watch.js`'s `ticketviewScroll` is never reset to `0` in the `open-ticketview` case, unlike
  `docScroll`'s explicit reset on `open-evidence-doc` — confirmed by reading `watch.js:1163-1172`.
  Opening ticket B right after scrolling ticket A down carries A's offset over (harmlessly clamped
  to B's own max on the next `draw()`, never out of range or erroring, but B may open pre-scrolled).
  Not a violation of any ticket AC or design.md/tasks.md requirement (this scroll state didn't exist
  before this change, and nothing in the planning artifacts specifies reset-on-open), so non-blocking
  — but worth a quick follow-up (`ticketviewScroll = 0` alongside `lp.viewingTicket = t.identifier`).
- `evaluation-1.md`'s "121 passed" figure for plain `node --test` does not match my own reproduced
  748/748 — worth the evaluator double-checking their own reported test counts in future cycles,
  though it did not change the correctness conclusion here.

### Verdict: CONFIRM
