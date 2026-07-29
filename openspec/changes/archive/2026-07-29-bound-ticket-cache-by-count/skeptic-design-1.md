## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/ticket-cache-bound/spec.md`, and `workflow-state.md` (round 1, no
  prior skeptic verdict — this is a first pass).
- Read ground truth: `lib/ui/linear.js` (full file), `lib/ui/cache.js` (full
  file), `lib/ui/watch.js` (`refreshLaunchPad`, `openLaunchPad`), the relevant
  slice of `lib/ui/screens/launchpad.js` (`headerLine`, `ticketsForEpic`),
  `config/concertino.schema.json` (`dashboard.launchPad`, `additionalProperties:
  false` on every object level), `docs/dashboard.md` (lines 360-420, the
  existing "Comments are capped" and "Configuration" sections),
  `test/linear.test.js` (full file) and `test/cache.test.js` (full file).
- Confirmed the measured numbers the design cites against real code: `PAGE_SIZE
  = 50`, `MAX_PAGES = 200` (10,000-ticket ceiling, matches proposal.md's "the
  previous unbounded-except-MAX_PAGES(10,000) ceiling"), `COMMENT_LIMIT = 50`,
  `OPEN_STATE_TYPES = ['backlog', 'unstarted', 'started']` — all match what
  proposal.md/design.md assert.
- Confirmed the existing `COMMENT_LIMIT` comment ("Comments are the one
  unbounded axis in the payload...") is in fact the overclaim Requirement 4
  targets — it implies comments drive cache size, which the ticket's
  measurement (0.6%) disproves. Task 1.2 correctly targets this.
- Confirmed `cache.js`'s `CACHE_SCHEMA_VERSION = 2` / strict-equality read gate
  and the existing `epics`-defaulting precedent design.md Decision 4 leans on
  (`epics: Array.isArray(parsed.epics) ? parsed.epics : []`, checked only
  after the schemaVersion gate already passed) — the "no version bump needed"
  argument holds against the real code, not just against a paraphrase of it.
- Confirmed `config/concertino.schema.json`'s `dashboard.launchPad` object is
  `additionalProperties: false` with only `enabled` today — task 4.1's
  planned addition of `backlog` is required, not optional, for the config to
  parse at all. Consistent with the design.
- Confirmed `watch.js#refreshLaunchPad` currently calls
  `linear.fetchTickets({ teamKey: team.key })` with no `stateTypes` — task
  3.1's planned change (pass `linear.stateTypesFromConfig(opts.config)`) is a
  real, needed wire-up, and `opts.config` is already in scope in that closure
  (used two lines above for `teamKeyFromConfig`).
- Re-ran the existing `fetchTickets stops at MAX_PAGES` test's logic by hand
  against the new `MAX_TICKETS=500` design: that test accumulates exactly 1
  ticket/page for 200 pages (200 total), which stays under the new 500 cap, so
  the existing test is unaffected by the new bound — no regression risk there.
- Read `docs/dashboard.md`'s existing "Comments are capped" section (lines
  396-406): it says "Comments are the only unbounded axis in the payload" and
  "A busy team is the case the cap exists for" — the exact same false claim
  the ticket set out to correct, in prose rather than code, plus a stale
  number ("the Concertino team's six open tickets... cache around 10 KB")
  that already disagrees with ticket.md's own measurement (7 tickets, 15.5 KB).

### Verdict: REFUTE

### Change Requests

1. **`docs/dashboard.md`'s "Comments are capped" section is not in tasks.md's
   doc-update scope, but it makes the exact claim Requirement 4 says the code
   must stop making.** Task 4.2 only says "document `MAX_TICKETS`, the
   truncation marker, and `dashboard.launchPad.backlog`... in the launch pad
   'Configuration' section" — it never mentions the pre-existing "Comments are
   capped" section (`docs/dashboard.md:396-406`), which currently states
   "Comments are the only unbounded axis in the payload" and "A busy team is
   the case the cap exists for." Leaving that section untouched means the
   shipped docs will directly contradict the corrected `COMMENT_LIMIT` comment
   in `lib/ui/linear.js` the same change just fixed — a reader who checks the
   docs gets the exact overclaim the ticket exists to kill. Add an explicit
   task (and spec/design coverage) to rewrite that section using the real
   measurement (ticket count/descriptions dominate, comments are ~0.6%), and
   correct its stale numbers (it says "six open tickets... ~10 KB"; ticket.md's
   own measurement is 7 tickets / 15.5 KB) while in there.

2. **The `truncated` rule (design.md Decision 3 / spec.md Requirement 2) is
   internally inconsistent with Decision 5's own "hard slice" model.**
   Decision 5 explicitly anticipates a page pushing the accumulated count
   *past* `MAX_TICKETS` ("slices the array down to exactly `maxTickets`
   (rather than keeping the last page's overshoot)") — i.e., overshoot within
   the cap-crossing page is a scenario the design itself expects to handle.
   But Decision 3 defines `truncated` purely as "true only when the cap was
   reached while Linear still had further pages" — i.e., based solely on that
   page's own `hasNextPage`. This misses the case where the cap-crossing page
   itself contains more nodes than fit under the cap (overshoot) *and*
   reports `hasNextPage: false` (Linear's true, full backlog is larger than
   `MAX_TICKETS` but happens to complete within that one page/connection). In
   that case real tickets are sliced off and discarded, which is truncation
   by any reasonable reading of the acceptance criterion ("a silently short
   list is worse than a visible..."), yet a literal implementation of
   Decision 3's rule (`truncated = hasNextPage-at-crossing-page`) would report
   `truncated: false`. With the shipped constants (`MAX_TICKETS=500`,
   `PAGE_SIZE=50`, an exact multiple) this cannot occur in production today,
   but it is a real, silent-failure-shaped gap that will resurface the moment
   either constant is revisited independently (which design.md's own "Risks"
   section says is expected: "a follow-up ticket can revisit the number").
   Fix the design to define `truncated` as: true when the crossing page's
   `hasNextPage` is `true`, **or** when the accumulated node count before
   slicing exceeds `maxTickets` (overshoot) — not `hasNextPage` alone — and
   add a fixture-based test for the overshoot-with-no-more-pages case so this
   is locked in rather than left to an implementer's literal reading of
   Decision 3.

### Non-blocking notes

- Decision 3's choice of a boolean `truncated` flag over an exact "N of M"
  total is well justified against Linear's actual API shape (no cheap total
  count) and matches what `cache.js`/`headerLine` can realistically carry —
  no objection there.
- Decision 4 (no cache schema version bump) checks out against the real
  `read()`/`write()` code and its existing `epics`-defaulting precedent.
- `stateTypesFromConfig` naming and call-site plan (`watch.js`) are consistent
  with the existing `teamKeyFromConfig` precedent already in `linear.js`.
