## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-metrics-escalation-history/spec.md` fresh, in full.
- **Verified round 1's Change Request 1 is genuinely fixed at the specific
  line it targeted.** Traced `lib/ui/watch.js:749-752` as it exists today
  (unmodified — this is a design-gate re-review, code changes come later):
  ```js
  if (S.mode === 'escalation') {
    const run = S.runs.find((r) => r.ticket === S.escalationTicket);
    if (!run || !run.escalation) backToFleet();
  }
  ```
  confirms round 1's finding still holds against current code. Design.md's
  new "Skeptic round 1 correction" (lines 200-214) proposes gating this on
  `S.mode === 'escalation' && !S.escalationHistoryItem` — traced this against
  `lib/ui/app-state.js:428-462` (`backToFleet()`) and
  `lib/ui/screens/escalation.js:330-343` (`render`/`routeHandleKey`, which
  derive `run` from `state.escalationTicket`, confirmed `null` for a
  historical view since Decision 5 never sets it) — the gate condition itself
  is logically correct **conditional on `S.escalationHistoryItem` actually
  being `null` whenever it's not genuinely showing a historical entry**. See
  Change Request 1 below — that precondition is not established by the
  revised design, which is a new, previously-unintroduced gap (this field is
  new this round).
- Traced the companion `banner.js` fix. `lib/ui/banner.js:99-102`
  (`suppressedOnOwnScreen`) confirmed unchanged; confirmed via `grep` that it
  is called from **two** sites in `watch.js` — `computeScreenRows()`
  (line 489, also feeds the fleet grid's own row budget at line 677) and
  `draw()` (line 775) — both with identical arguments. See Change Request 3.
- Traced Decision 1's `toOptions()`/`sub_questions` reuse fix against
  `lib/ui/reducer.js:90` (`toOptions`, currently unexported —
  `module.exports = { reduce, TIER2_KINDS, TIER3_KINDS, PHASE_ORDER }` at
  line 338) and the inline defensive `JSON.parse` at `reducer.js:190-197`.
  tasks.md 1.1 now requires exporting/lifting these rather than re-parsing —
  round 1's non-blocking note is now a real, actionable task. Sound.
- Traced Decision 4/5's render-precedence claim against the actual
  `renderEscalation`/`handleKey`/`render`/`routeHandleKey` code
  (`lib/ui/screens/escalation.js:86-343`): confirmed the `!run` branch
  (lines 96-99) is exactly what a historical view would fall into if
  `opts.historical` isn't checked first, confirmed `render()` already builds
  `run` from `state.escalationTicket` (safe `null` for historical per
  Decision 5), and confirmed `handleKey`'s existing `!run` branch already
  produces "only Escape handled" behaviour for free (design.md over-describes
  this as a new branch, but the claim itself is accurate, not broken).
- Traced Decision 2/3's focus-mode precedent against
  `lib/ui/screens/fleet/keys.js:222-332` and
  `lib/ui/controllers/fleet.js:80-262` (`applyJumpAction`,
  `focus-quickstart`/`move-quickstart-focus`/`exit-quickstart-focus`) —
  confirmed the digit-jump `case 'metrics': return null;` (keys.js:245) and
  the quickstart block's shape match design's description; confirmed the one
  deliberate divergence (metrics binds `↵` to open, quickstart suppresses
  `\r`) is explicit and correct in the design text even though the section
  header says "mirroring... exactly" (a labelling imprecision, not a defect).
- Found two new issues not present (or not yet triggerable) in round 1's
  review, because they follow from the round-1 fix's own new state field.
  See Change Requests 1 and 2 below.

### Verdict: REFUTE

### Change Requests

1. **`S.escalationHistoryItem` is never specified to be cleared, so a live
   escalation opened after a historical one (fully reachable within this
   feature's own flow, no `g`/`↵` needed) will render the wrong content and
   permanently disable the very poll-loop safety check round 1's fix just
   restored.**

   Design.md Decision 4 (line 197) introduces `S.escalationHistoryItem` as
   "a new, separate state field" but neither design.md nor tasks.md (3.1,
   3.4) specifies where it gets reset to `null`. Two real gaps:

   - `lib/ui/app-state.js:428-462`'s `backToFleet()` resets every other
     escalation-screen-local field (`escalationTicket`, `escalationReply`,
     `escalationNotice`, `escalationContextScroll`, `escalationSubIndex`) and
     the file explicitly documents this as a house discipline — see its own
     comments at e.g. lines 445-448 ("cleared here too means it can never
     leak into a later, unrelated screen") and 457-461 (same, for
     `S.settings`). `escalationHistoryItem` is not added to that list
     anywhere in design.md/tasks.md, breaking that documented discipline.
   - `lib/ui/controllers/escalation.js:97-123`'s `'open-escalation'` handler
     (the exact handler Decision 4 requires the STILL-LIVE branch to reuse
     "byte-for-byte... not a copy") resets `escalationReply`,
     `escalationNotice`, `escalationContextScroll`, `escalationSubIndex` —
     but nothing in design.md/tasks.md adds `S.escalationHistoryItem = null`
     to it either.

   Concrete failure sequence, fully inside this ticket's own new UI, no
   pre-existing code path needed: operator focuses METRICS, opens a
   *resolved* entry (`S.mode='escalation'`, `S.escalationHistoryItem=entryA`),
   presses Escape (`{type:'back'}` → `backToFleet()`, which per the above
   does **not** clear `escalationHistoryItem` since it's unmentioned),
   returns to the fleet, then opens a *still-live* entry from the same list
   (Decision 4's own STILL-LIVE branch: dispatches the literal
   `'open-escalation'` action). `S.mode='escalation'`, `S.escalationTicket=
   ticket`, but `S.escalationHistoryItem` is still `entryA` — untouched.
   Consequences, both traced against real code:
   - `render()` (`escalation.js:330-338`) will pass
     `historical: state.escalationHistoryItem` (truthy, stale `entryA`) to
     `renderEscalation`, which "takes precedence over deriving `esc` from
     `run.escalation`" per Decision 4 — the operator sees the **old,
     already-resolved question**, not the live, answerable one they just
     opened. This directly breaks AC2 ("routes to the same answerable
     escalation screen") even though the *action dispatched* is correct —
     the render is not.
   - The corrected poll-loop check (`S.mode === 'escalation' &&
     !S.escalationHistoryItem`) is now permanently `false` for this screen,
     so the "walk back to fleet when the run/its escalation disappears"
     safety net — the exact mechanism round 1's fix restored — is silently
     disabled for this genuinely-live escalation for as long as it's open.

   **Required revision:** design.md must add `S.escalationHistoryItem = null`
   to `backToFleet()`'s reset list (Decision 4 or a new sub-bullet), and to
   `'open-escalation'`'s handler (so the reused, "not a copy" live-open path
   truly starts from a clean slate every time) — tasks.md 3.1/3.4 must be
   updated to require both, with a regression test covering exactly the
   sequence above (open resolved entry → Escape → open a still-live entry →
   assert the live screen renders the live question, not the prior
   historical one, and that the poll-loop check is live again).

2. **Decision 4's own text contradicts itself on which sub-question a
   multi-part historical entry renders.**

   `design.md:166-169`: "using the historical entry's
   `question`/`options`/`subQuestions[0]` (... so the box just shows the
   **LAST** sub-question ...)". `subQuestions[0]` is the array's first
   element; the very next clause calls it "the LAST sub-question" — these
   are different elements for any entry with `subQuestions.length > 1`, and
   nothing else in Decision 1 or 4 disambiguates which is intended. tasks.md
   3.2 doesn't restate the specific index either, so the ambiguity isn't
   resolved downstream. A competent implementer could read this two ways and
   land on either the first-raised sub-question or the most-recently-raised
   one.

   **Required revision:** design.md must say, unambiguously, which index (or
   name it "the first" / "the most recent") the read-only box renders, and
   make the code-shape reference (`subQuestions[0]` or
   `subQuestions[subQuestions.length - 1]`) agree with the prose.

3. **The `banner.js` fix targets "watch.js's banner-suppression call site"
   (singular text), but the real call site exists twice, with identical
   arguments, in two different functions.**

   `grep -n "suppressedOnOwnScreen" lib/ui/watch.js` returns two hits:
   `computeScreenRows()` (line 489 — this also feeds the fleet grid's own row
   budget, `lib/ui/watch.js:677`) and `draw()` (line 775). Design.md's
   correction (lines 222-234) and tasks.md 3.4 both say "watch.js's
   banner-suppression call site" / "the call site" without noting there are
   two. If an implementer patches only the more prominent one (line 775, next
   to the poll-loop check being fixed in the same edit), `computeScreenRows()`
   at line 489 keeps calling the unpatched 3-arg form, and the historical
   view still bleeds the global escalation banner onto its own screen (round
   1's Change Request 2) whenever some other run has a live escalation —
   *and* `computeScreenRows()`'s row-budget math would disagree with
   `draw()`'s own about how many rows the banner is consuming, an inconsistency
   beyond the original bug.

   **Required revision:** design.md/tasks.md must call out both call sites by
   name (or, better, specify changing `suppressedOnOwnScreen`'s own signature
   to take the historical flag — e.g. `suppressedOnOwnScreen(mode,
   escalationTicket, liveEscalations, historicalItem)` — and require updating
   both watch.js call sites to pass `S.escalationHistoryItem`), so the fix
   can't land at only one of the two identical spots.

### Non-blocking notes

- Design.md's Decision 2 header says the metrics focus block "mirror[s]
  `focus === 'quickstart'` exactly," but the body correctly and explicitly
  lists one intentional divergence (`↵` bound to open, vs. quickstart's own
  suppression of `\r`). The content is accurate; only the header's "exactly"
  overstates it. Consider softening the header wording so a skim-reader
  doesn't take "exactly" too literally.
- Design.md's Decision 4 states `handleKey` "gains a matching early branch"
  for historical entries, but the existing `!run` branch
  (`escalation.js:279-282`) already produces exactly the described
  "only Escape handled" behaviour once `run` is `null` for a historical
  view — no new branch is strictly required there, only in `render()`/
  `renderEscalation`. Not a defect (the described behaviour is correct
  either way), just a minor inaccuracy in how much new code Decision 4
  implies is needed for `handleKey` specifically.
- The paired history entry shape (Decision 1) carries no `context` field
  (unlike live `run.escalation.context`), so a historical detail view will
  never show the context that was captured when the escalation was raised,
  even though the raw event has it. This isn't required by any of the
  ticket's three ACs, and is plausibly an intentional scope cut, but design.md
  doesn't say so explicitly — worth one line confirming this is deliberate so
  a future reader doesn't mistake it for an oversight.
