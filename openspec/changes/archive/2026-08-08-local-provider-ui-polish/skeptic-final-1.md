## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff scope** — `git diff main...HEAD --stat` shows exactly the 7 source
  files `files-modified.md` lists (`lib/cli/help.js`, `lib/cli/validate.js`,
  `lib/config.js`, `lib/ui/controllers/draft.js`, `lib/ui/screens/launchpad.js`,
  `lib/ui/ticket-provider.js`, `lib/ui/tickets/local.js`) plus their test
  files and openspec artifacts. `git diff main...HEAD -- lib/ui/linear.js`
  is empty — confirmed untouched, matching the design's explicit constraint.

- **AC / Item 1** (`fetching tickets from Linear…`) — read the diff of
  `lib/ui/screens/launchpad.js`: the line now reads `'fetching tickets…'`
  unconditionally. `grep -rn "fetching tickets from Linear" lib/ test/`
  returns nothing repo-wide. `test/launchpad.test.js`'s new test asserts
  `doesNotMatch(out, /Linear/)`. Traced and satisfied.

- **AC / Item 2** (human-readable local state names) — read the diff of
  `lib/ui/tickets/local.js`: a `STATE_NAMES` map (`backlog→Backlog`,
  `unstarted→Todo`, `started→In Progress`, `completed→Done`,
  `canceled→Canceled`) is added and `parseTicket` now sets
  `state: { name: STATE_NAMES[f.state], type: f.state }` — `state.type`
  unchanged. Verified `docs/dashboard.md`'s diff is empty (no change needed —
  it already advertised `Todo`/`In Progress`, confirmed by reading
  `docs/dashboard.md:412-413` directly). Checked the one other `state.name`
  consumer, `lib/ui/ticketDetail.js:30`
  (`ticket.state.name ? ticket.state.name : 'Todo'`) — degrades correctly
  under the new mapped names (previously fell through to the raw lowercase
  value being truthy and rendered as-is; now renders the proper label).
  `inlineStatus`'s `type === 'started'` override in `launchpad.js:131-132` is
  untouched and still branches on `state.type`, not `state.name`. Traced and
  satisfied.

- **AC / Item 3** (draft-gate alias resolution) — read the diff of
  `lib/ui/controllers/draft.js`: the raw `ctx.config.ticketProvider.kind`
  comparison is replaced with `ctx.deps.linear.kindFor(ctx.config || {})`.
  Independently confirmed `ctx.deps.linear` really is `ticket-provider.js`'s
  resolver by reading `lib/ui/watch.js:44` (`const linear =
  require('./ticket-provider')`) and the `deps:` object at line 509-516 that
  binds it onto `ctx.deps.linear`. Confirmed `kindFor` is exported from
  `ticket-provider.js`. `test/watch.test.js`'s new test drives a real
  `manual`-configured project through `watch()`, presses `n`, types free
  text, and asserts the local-specific message appears and the raw
  `"this project uses \"manual\""` message does not. Traced and satisfied.

- **AC / Item 4** (`validate --ticket` local support) — read the diffs of
  `lib/ui/tickets/local.js` (new `fetchOneTicket`), `lib/ui/ticket-provider.js`
  (new dispatch `fetchOneTicket(config, opts)`, exported), `lib/cli/validate.js`
  (`buildTicketHarnessCheck` now gates on `kind !== 'linear' && kind !==
  'local'` using the resolved kind, and calls `ticketProvider.fetchOneTicket`
  with `root` threaded from `cmdValidate`'s `out`), `lib/config.js:438`, and
  `lib/cli/help.js:42`.

  Independently reproduced end-to-end (not just trusting the evaluator's
  claim) in a scratch fixture:
  - `validate --ticket=CON-5` against a `local`-provider project with a
    seeded `tickets/CON-5.md` declaring `harness:codex` → printed
    `✓ ticket harness     CON-5 declares harness:codex — takes precedence
    over the project default and runtime detection`.
  - `validate --ticket=CON-999` (missing file) → clean `error: local: ticket
    "CON-999" was not found — expected tickets/CON-999.md`, exit 1, no raw
    exception/stack trace.
  - `validate --ticket=CON-5` against `ticketProvider.kind: "github"` →
    `--ticket live-checking is not supported for ticketProvider.kind
    "github"` (the new message text, naming the actual unsupported kind, not
    the old "only ... linear today" wording).
  - `validate --ticket=CON-5` against `ticketProvider.kind: "manual"` →
    same successful harness-declaration output as the `local` case (alias
    resolves).
  - `validate --help` → the `--ticket=ID` line now reads `"linear" or
    "local"/"manual"`, matching `lib/cli/help.js`'s diff.
  Traced and satisfied.

- **No regressions to Linear behavior** — `lib/ui/linear.js` diff is empty.
  The one remaining raw `provider.kind !== 'linear'` comparison
  (`lib/ui/linear.js:513`, inside its own `launchPadStatus`) is pre-existing,
  untouched, and safe: it's only reached after
  `ticket-provider.js:104-105`'s `moduleFor(config).launchPadStatus(
  canonicalConfig(config), env)` has already dispatched to the `linear`
  module using the alias-resolved kind — consistent with `tasks.md` 5.3's
  own note that this call site is allowed to read the raw config for that
  reason.

- **Tests re-run fresh, in this worktree** (not trusting the evaluator's
  pasted output as-is — reproduced it myself):
  ```
  npm test
  # tests 1681
  # pass 1681
  # fail 0
  ```
  Matches evaluation-1.md's claim exactly.

- **New tests are meaningful, not decorative** — read
  `test/launchpad.test.js`, `test/watch.test.js`, `test/tickets-local.test.js`,
  `test/validate.test.js` diffs directly. Each asserts the *new* string/value
  (`'Todo'` not `'unstarted'`, the local-specific message not the raw-kind
  one, the new unsupported-provider wording) and several assert the *old*,
  wrong behavior does NOT appear (`doesNotMatch(frame, /this project uses
  "manual"/)`), so they would fail against the pre-fix code, not just pass
  trivially alongside it.

- **UI/design judgment** — N/A per role instructions (no UI standard
  configured for this project; this ticket is dashboard/CLI text and data
  changes with no visual/styling surface). No dev-server verification
  required or attempted.

### Verdict: CONFIRM

All four ticket items trace to concrete, correct code changes; all four are
independently reproduced against the running CLI (not just the evaluator's
narrative); the full test suite (1681/1681) passes fresh in this worktree;
`lib/ui/linear.js` is confirmed byte-unchanged; and the one remaining raw
`provider.kind` comparison in the codebase is pre-existing and provably safe
given its dispatch context. Ships.

### Non-blocking notes

- None beyond what evaluation-1.md already noted (the `ticketDetail.js`
  `state.name` consumer isn't explicitly called out in `files-modified.md`,
  but I independently verified it degrades correctly under the new mapping —
  a documentation nicety, not a defect).
