## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/run-archive/spec.md` in full.
- Confirmed `S.runs` population and its independence from `MAX_FINISHED`:
  `lib/ui/watch.js:624` (`S.runs = reduce(store.readAll(root, eventsCache),
  ...)`), `lib/ui/store.js:182-197` (`readAll` walks every ticket dir, no
  section cap), `lib/ui/screens/fleet/sections.js:26` (`MAX_FINISHED = 5`,
  a rendering-only cap). Matches proposal.md's/design.md's core "no new
  read path" claim.
- Confirmed `run.startedAt`/`run.harness` fields exist on the reduced run
  object (`lib/ui/reducer.js:41,65,108,113`) — grounds Decisions 3 and 5.
- Confirmed the drill-down's lookup is ticket-only and agnostic to whether a
  run is in a rendered fleet section: `lib/ui/controllers/drilldown.js:62`
  and `lib/ui/screens/drilldown.js:789,803`
  (`S.runs.find((r) => r.ticket === S.drillTicket)`). Grounds Decision 3's
  "reusing existing panels" claim.
- Confirmed the claimed-letters tally in `lib/ui/screens/fleet/keys.js` and
  grepped every `key === '<letter>'` site plus the two reserved-key
  constants (`CONFIRM_RESTORED_QUEUE_KEY = 'c'`,
  `CLEAR_QUEUE_KEY = 'C'`, `lib/ui/screens/fleet/sections.js:46,56`) and the
  cross-screen `RESERVED_KEY = 'g'` (`lib/ui/banner.js:30`) — `A` (capital)
  is genuinely unclaimed. Decision 1 is sound.
- Read `lib/ui/screens/fleet/search.js` in full and traced `matchesQuery`/
  `rowMatches`'s actual behavior on an empty query, then cross-checked
  against the existing `fleet-search` capability spec
  (`openspec/specs/fleet-search/spec.md:34`, "An empty query SHALL match
  nothing") — see Change Request 1 below; this contradicts design.md's own
  characterization of the same functions.
- Read `lib/ui/router.js` (the `SCREENS` registry) and
  `lib/ui/controllers/index.js` (the `CONTROLLERS` array) and traced
  `watch.js`'s actual render/key dispatch (`watch.js:819` `router.render(...)`,
  `watch.js:1235` `router.handleKey(...)`, `watch.js:1146-1168` `applyAction`
  delegating everything but `back`/`attach`/`attach-session` to
  `controllers.applyAction`) — see Change Request 2 below.
- Read `lib/ui/app-state.js`'s `sessionsData`/`sessionsSelected` fields,
  `currentState()`, and the "leaked staged state" reset block — confirms
  tasks.md 2.1-2.3's precedent is real for a single-cursor list, but see
  Change Request 3 for why sessions.js is the wrong precedent for this
  screen's full field set.
- Skimmed `lib/ui/screens/settings.js`'s header comment (multi-pane
  SECTIONS/FIELDS with its own local `focus`, `S.settings` as a nested
  session object) to compare against Decision 3's chosen state shape.
- Confirmed no implementation files exist yet
  (`lib/ui/screens/archive.js`, `lib/ui/controllers/archive.js`,
  `test/archive.test.js` all absent) — correctly a pre-implementation
  design-gate artifact set.
- Grepped for `TODO`/`TBD`/hand-waving markers in the change dir — none
  found.

### Verdict: REFUTE

### Change Requests

1. **Decision 2 / spec.md's "Live filtering..." requirement / tasks.md 3.4
   misstate `matchesQuery`/`rowMatches`'s actual empty-query behavior.**
   Both claim the archive screen's "empty substring matches every run"
   requirement is satisfied by "matching `rowMatches`'s own existing
   semantics of 'no query, no exclusion'" (spec.md lines 44-47) — but the
   real code does the opposite: `matchesQuery` (`lib/ui/screens/fleet/
   search.js:17-21`) returns `false` whenever `query` is null or
   whitespace-only, so `rowMatches` also returns `false` for every row on
   an empty query — i.e. calling it unmodified with `archiveQuery === ''`
   would match **nothing**, not everything. This is independently
   confirmed by the existing `fleet-search` capability spec itself
   (`openspec/specs/fleet-search/spec.md:34`, "An empty query SHALL match
   nothing"). The archive screen's desired behavior therefore requires an
   explicit bypass in the archive screen's *own* filter code — e.g. "if
   `archiveQuery` is empty/whitespace, every run passes the substring
   filter without calling `rowMatches` at all; otherwise call
   `rowMatches(run.ticket, run.changeName, archiveQuery)` unmodified" —
   not a property `rowMatches` already provides. Fix Decision 2, the
   "Live filtering" requirement's paragraph 1, and tasks.md 3.4 to state
   this bypass explicitly, so an implementer doesn't wire
   `rowMatches(ticket, title, archiveQuery)` straight through and end up
   with an archive screen that shows an empty list by default.

2. **proposal.md's "Impact" bullet and tasks.md 5.1 register the new mode
   in the wrong file.** Both say to add `'archive'` to "the render switch"
   in `lib/ui/watch.js`, "alongside the existing `'sessions'`/`'settings'`/
   `'drilldown'` cases." `watch.js` has no such per-mode switch — it calls
   `router.render(currentState(), opts)` uniformly (`watch.js:819`) and
   `router.handleKey(key, currentState())` uniformly (`watch.js:1235`).
   `'sessions'`/`'settings'`/`'drilldown'` are registered in
   `lib/ui/router.js`'s `SCREENS` object (`router.js:27-55`), not in
   `watch.js`. (`applyAction` routing, separately, is correctly identified
   by tasks.md 4.4 as `lib/ui/controllers/index.js`'s `CONTROLLERS` array —
   only the render-registration half is misattributed.) Correct
   proposal.md's Impact section and tasks.md 5.1 to point at
   `lib/ui/router.js`'s `SCREENS` map.

3. **Decision 3's chosen state shape has no field for which of the
   archive screen's several interactive controls currently has keyboard
   focus.** Decision 3 lists five flat fields (`archiveQuery`,
   `archiveHarnessFilter`, `archiveDateFrom`, `archiveDateTo`,
   `archiveSelected`), explicitly modeled on `S.sessions*`'s shape
   (`lib/ui/controllers/sessions.js`) — but the sessions screen has exactly
   one interactive element (a single list, one cursor), so it never needed
   a "what's currently focused" field. tasks.md 3.2/3.3 give the archive
   screen (at least) five interactive zones — substring input, harness
   selector, date-from, date-to, and the results list — and 3.3 explicitly
   requires "`Tab`/arrows move between filter fields and the list" and
   "typing updates the currently-focused filter field," but there is no
   state field anywhere in Decision 3 or tasks.md 2.1 to hold which zone is
   currently focused. An implementer has nowhere defined to store or read
   this. Add an explicit field (e.g. `archiveFocus`) to Decision 3 and
   tasks.md 2.1-2.3 — `settings.js`'s own local multi-pane focus tracking
   (nested inside its own `S.settings` session object, per its header
   comment) is the closer precedent here than `sessions.js`'s single-cursor
   shape.

4. **The interaction mechanism for the harness selector and date-range
   fields is unspecified.** tasks.md 3.2/3.3/4.2 name the actions
   ("harness selected/cleared," "date bound set/cleared") but never define:
   (a) what key(s) cycle/open the harness selection, (b) what text format
   the date-from/date-to fields accept and how that's parsed into the `ms
   epoch` value Decision 3 requires them to hold, or (c) what happens on
   invalid/unparseable date input. Unlike Decisions 1/2/4/5, which each
   resolve a genuinely open design question, this one is left to the
   implementer to invent from scratch — exactly the kind of ambiguity two
   different implementations could resolve incompatibly. Resolve as an
   explicit Decision in design.md (or at minimum spell out the key
   bindings/format/validation behavior in tasks.md 3.2/3.3) before this
   moves to execution.

### Non-blocking notes

- proposal.md/design.md's citation of `lib/ui/screens/fleet.js` in spec.md's
  Requirement 1 ("The fleet view (`lib/ui/screens/fleet.js`) SHALL bind
  `A`...") is technically accurate at the module-boundary level —
  `fleet.js` re-exports `keys.js`'s `handleKey` as `routeHandleKey`
  (`fleet.js:49,56`) — but proposal.md's own Impact section correctly cites
  `keys.js` directly; worth being consistent about which file is named
  where the ticket-facing spec.md and the implementation-facing proposal.md
  disagree on level of detail. Not blocking.
- Decision 2's "share the match predicate, not the target list" reasoning
  and Decision 4's "no navigation stack" reasoning are both well-grounded
  and consistent with the actual codebase (verified above) — no changes
  needed there.
