## Skeptic Report — design gate (round 0, skeptic-design-1.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`, and
all three spec deltas (`launchpad-local-parity`, `ticket-draft`,
`validate-ticket-local-provider`) in full.

The design is unusually well-grounded: nearly every factual claim it makes about
the existing codebase cites a specific file/line, and I independently verified
each one against the actual source rather than trusting the prose:

- **Item 1** — `lib/ui/screens/launchpad.js:326` does contain
  `'  ' + f.dim('fetching tickets from Linear…')` unconditionally inside
  `if (lp.refreshing) { ... }`. Confirmed by reading the file directly.
- **Item 2** — `lib/ui/tickets/local.js:113` does set
  `state: { name: f.state, type: f.state }` (both raw). `lib/ui/linear.js:352-353`
  does carry the exact comment quoted in the ticket ("`state.type` is what code
  branches on; `state.name` is what a human reads"). `docs/dashboard.md` (around
  line 412) does advertise `Todo` / `In Progress`. `lib/ui/screens/launchpad.js:131-132`
  (`inlineStatus`) confirms the `type === 'started'` override is independent of
  `state.name` and only `backlog`/`unstarted`/`completed`/`canceled` tickets are
  affected by the fix, exactly as Decision 2 claims — I also checked
  `lib/ui/ticketDetail.js:30`, an unmentioned but real second consumer of
  `state.name`, and it degrades safely (`ticket.state.name ? ... : 'Todo'`) under
  the change with no further work needed.
- **Item 3** — `lib/ui/controllers/draft.js:24-30` contains the exact raw
  `provider.kind !== 'linear'` comparison and the exact fallback message text
  quoted in the ticket. Line 138 does call `ctx.deps.linear.teamKeyFromConfig`,
  confirming `ctx.deps.linear` is already reachable in this file.
  `lib/ui/watch.js:21-27,44` confirms `const linear = require('./ticket-provider');`
  and the header comment documenting that `ctx.deps.linear` is deliberately named
  after `linear.js` but is actually `ticket-provider.js`'s resolver.
  `lib/ui/ticket-provider.js` exports `kindFor` (line ~43), matching the design's
  proposed fix with no new plumbing.
- **Item 4** — `lib/cli/validate.js:9,19,21-24` confirms
  `buildTicketHarnessCheck` imports `fetchOneTicket` directly from
  `lib/ui/linear` and gates on the raw `tp.kind !== 'linear'`, exactly as
  described. `lib/ui/linear.js:293-309`'s `fetchOneTicket` returns
  `{ id, identifier, labels }`, the shape the design says the new
  `local.fetchOneTicket` must match. `lib/ui/tickets/local.js:252-256`'s
  `createTicket` does reject with a `'local: ...'`-prefixed message, confirming
  the style precedent the design cites. `lib/ui/tickets/local.js`'s `parseTicket`
  (already exported) is directly reusable for a single-file read as proposed.
  `lib/config.js:438` and `lib/cli/help.js:41-42` both do carry a
  Linear-only framing (wording differs slightly between the two files, but both
  make the same "linear only" claim the design set out to fix — not a
  contradiction).
- `ticket-provider.js`'s `fetchTickets` (lines ~139-143) and `moduleFor`/
  `canonicalConfig` dispatch pattern the design proposes mirroring for the new
  `fetchOneTicket` is real and matches the description given.
- Cross-checked every acceptance criterion in `ticket.md` against `tasks.md`:
  each of the four items has a task group, and `tasks.md` §5 adds verification
  tasks (full suite, both-provider `validate` smoke test, and a grep sweep for
  any remaining raw `provider.kind` comparison left outside the allowed seams).
  No AC is left uncovered by a task.
- Grepped the change's own markdown files for `TODO`/`TBD`/"figure out
  later"/"placeholder" — the only hits are the literal string `Todo` (the state
  label itself), not unresolved work markers.
- Confirmed all four referenced test files that `tasks.md` expects to extend
  already exist: `test/tickets-local.test.js`, `test/watch.test.js`,
  `test/validate.test.js`, `test/launchpad.test.js`.
- Checked for internal contradictions across proposal/design/spec deltas: none
  found. The three "New/Modified Capabilities" named in `proposal.md` line up
  1:1 with the three spec delta directories that actually exist on disk.

### Verdict: CONFIRM

The plan is sound, appropriately scoped to the ticket's four items, makes no
unverified claims about the existing code (I checked the load-bearing ones and
all held up), leaves no AC uncovered, and introduces no placeholders or deferred
decisions that would block implementation. Decisions 1-4 each name and reject a
concrete alternative with a stated reason, which is a good sign this was actually
thought through rather than asserted.

### Non-blocking notes

- `lib/cli/help.js:41-42`'s actual wording ("also live-fetches that ticket
  (ticketProvider.kind \"linear\" only)") differs slightly from the phrasing
  `ticket.md` quotes ("only implemented for ticketProvider.kind linear today"),
  which is `lib/config.js:438`'s wording, not `help.js`'s. Both convey the same
  "Linear only" claim, so this doesn't change the fix, but the executor should
  read the actual `help.js` text (not the ticket's paraphrase) before editing it.
- `proposal.md`'s Impact section doesn't mention `lib/ui/ticketDetail.js`, which
  also reads `state.name` (line 30). I confirmed it needs no change — it already
  falls back safely — but it's worth a one-line note in the executor's own
  files-modified.md that this file was checked and intentionally left alone,
  so a future reviewer doesn't have to re-derive that.
