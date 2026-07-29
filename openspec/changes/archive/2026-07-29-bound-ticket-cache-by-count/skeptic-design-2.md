## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read round 1's report (`skeptic-design-1.md`) and re-read, cold, all planning
  artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/ticket-cache-bound/spec.md`, `workflow-state.md`.
- Re-read ground truth in full/relevant part: `lib/ui/linear.js`,
  `lib/ui/cache.js`, `lib/ui/watch.js` (`refreshLaunchPad`),
  `lib/ui/screens/launchpad.js` (`headerLine`, `ticketsForEpic`),
  `config/concertino.schema.json`'s `dashboard.launchPad` object,
  `docs/dashboard.md` lines 350-427, `test/linear.test.js`,
  `test/cache.test.js`.

**Change request 1 (docs/dashboard.md's "Comments are capped" section
omitted) — resolved.** Confirmed by direct read:
- `docs/dashboard.md:396-406` still carries the original overclaim
  ("Comments are the only unbounded axis in the payload", "A busy team is the
  case the cap exists for") and the stale figure ("six open tickets... ~10
  KB") — expected, since this is the design phase and no code/docs have
  changed yet.
- `tasks.md` task 4.3 now explicitly targets this exact section by quoting
  both phrases verbatim and names the correct replacement figure (7 tickets /
  15.5 KB, matching `ticket.md`'s own measurement).
- `spec.md`'s "COMMENT_LIMIT is documented as insurance, not the size
  control" requirement now names `docs/dashboard.md`'s section explicitly and
  has a "Docs reflect measured reality" scenario asserting it doesn't claim
  comments are "the only unbounded axis" and that figures match
  `ticket.md`.
- `proposal.md`'s Impact section (line 51-55) now lists the
  "Comments are capped" section rewrite alongside the "Configuration"
  section doc task.
- All four artifacts (proposal, design references via task 1.2, tasks 4.2/4.3,
  spec) now triangulate on the same fix — no longer a gap.

**Change request 2 (`truncated` inconsistent with Decision 5's overshoot
case) — resolved.** Confirmed by direct read:
- `design.md` Decision 3 now defines `truncated` as true when *either* the
  crossing page's `hasNextPage` was `true` *or* that page's own nodes
  overshot `maxTickets` before slicing — explicitly citing this as "Decision
  5's overshoot case."
- `tasks.md` task 1.4 restates the same disjunction verbatim as the
  implementation instruction, so an implementer cannot literal-read their way
  back to the narrower (buggy) rule round 1 flagged.
- A new task 5.3a requires a fixture test for exactly the gap case round 1
  identified: a cap-crossing page that overshoots `maxTickets` but reports
  `hasNextPage: false`, asserting `truncated: true` and exactly `maxTickets`
  tickets returned. It correctly instructs using a small `maxTickets` fixture
  (rather than the real 500) so a single page can exercise the case — sound,
  since `fetchTickets` already accepts `opts.maxTickets` per task 1.4.
- `spec.md` now has a matching scenario ("Truncated fetch is flagged
  (cap-crossing page overshoots)") plus the counter-scenario ("Exactly-at-the-
  cap... with no overshoot... `truncated` is `false`") — both conditions of
  the disjunction are independently pinned down, not just the OR as prose.

**Fresh pass — no new issues found.**
- Every acceptance criterion in `ticket.md` traces to a concrete
  decision/task/scenario: ticket-count bound → Decision 1/task 1.1;
  `backlog:false` opt-out, default preserves today's behavior → Decision
  2/tasks 1.3, 3.1, 4.1, spec's "default preserves today's behaviour"
  scenario; truncation visibility → Decision 3/5, tasks 1.4/1.5/3.2;
  `COMMENT_LIMIT` comment stops overclaiming → task 1.2 + spec Requirement 4;
  fixture-only tests → tasks 5.1-5.5a, all named against `test/linear.test.js`
  / `test/cache.test.js`, no network calls described anywhere.
- Verified `lib/ui/watch.js:369-387` (`refreshLaunchPad`) still calls
  `linear.fetchTickets({ teamKey: team.key })` with no `stateTypes`, and
  `opts.config` is in scope in that closure (used at line 375 for
  `teamKeyFromConfig`) — task 3.1's planned wiring is real and unblocked.
- Verified `config/concertino.schema.json`'s `dashboard.launchPad` object
  today has only `enabled` under `additionalProperties: false` — task 4.1's
  planned `backlog` boolean addition is required for the config to parse a
  project that sets it, consistent with the design.
- Verified `test/cache.test.js:165-169` ("write of an empty result is
  legal") currently asserts a `deepEqual` without a `truncated` field — task
  5.5's explicit call-out to update this assertion is correct and necessary
  once task 2.2 lands the new default.
- Re-ran `openspec validate bound-ticket-cache-by-count --strict` (the
  correct CLI form; the tool's own `--help` confirms `--change` is not a
  valid flag) — passes clean. Task 6.2 in `tasks.md` still literally reads
  `openspec validate --change bound-ticket-cache-by-count`, which is the same
  non-working flag form that recurs across several archived changes in this
  repo (`validate-phase-values`, `event-log-retention-caching`,
  `agent-merge-role`, `fleet-view-queued-section`) — an established,
  non-blocking house typo that past executors have caught and substituted the
  correct positional form for without incident (see
  `escalation-context-payload/tasks.md`'s own note calling this out). Not
  worth a third round over; flagged as a non-blocking note.

### Verdict: CONFIRM

Both round-1 change requests are resolved with matching evidence across
design.md, tasks.md, and spec.md, and the fresh pass surfaced no new
contradictions, placeholders, or AC gaps. The design is sound enough to
implement.

### Non-blocking notes

- `tasks.md` task 6.2's literal `openspec validate --change
  bound-ticket-cache-by-count` invocation uses a flag (`--change`) the
  installed CLI (`openspec 1.2.0`) rejects (`--help` confirms only
  `--changes`/positional `item-name` are valid); the correct form is
  `openspec validate bound-ticket-cache-by-count --strict`, which passes as
  verified above. This exact typo is a recurring pattern across several
  already-shipped changes in this repo and has never blocked delivery — the
  executor should just run the working form when it reaches task 6.2.
