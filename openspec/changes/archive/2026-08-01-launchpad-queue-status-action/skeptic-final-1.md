## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth re-established**: read `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/launchpad-queue-status/spec.md`, and the full
  `git diff main...HEAD` (14 files, `lib/ui/screens/launchpad.js` +60/-4,
  `lib/ui/watch.js` +43/-6, plus tests and openspec artifacts only — no scope
  creep, confirmed `lib/ui/queue.js`/`lib/ui/screens/fleet.js`/`lib/ui/format.js`
  have zero diff, per `git diff main...HEAD --stat -- lib/ui/screens/fleet.js
  lib/ui/queue.js lib/ui/format.js` returning nothing).

- **AC1 (distinct `⏳ queued` status)**: traced to
  `lib/ui/screens/launchpad.js:114-133` — `inlineStatus(ticket, runs,
  queueState)` checks `queueState.pending`/`inFlight` after the live-run
  check, before the Linear-state fallback, matching design.md Decision 1's
  precedence exactly. `ticketRow` (`launchpad.js:218-224`) styles it with
  `f.STATUS_COLOUR.queued` (dim) vs. `▲ running`'s `STATUS_COLOUR.running`
  (cyan) — confirmed in `lib/ui/format.js:43-51` these are genuinely
  different entries. A dedicated test
  (`test/launchpad.test.js`: `'ticketRow renders "⏳ queued" ... distinct from
  "▲ running"'s cyan'`) asserts the actual ANSI codes (`\x1b[2m` present,
  `\x1b[36m`/`\x1b[38;5;80m` absent) — this is a real visual-distinctness
  check, not just a string-content check.

- **AC2 (single-ticket "add to queue" action)**: traced `q` key binding
  (`launchpad.js:505`, tickets-pane-gated) through to `watch.js`'s
  `add-to-queue` case (`watch.js:1775-1799`), confirmed byte-for-byte
  structural match against the pre-existing `quickstart-add` case
  (`watch.js:1363-1390`): resolves `currentTicket(lp)` fresh, no-ops via
  `isSelectable` re-check, extracts `.identifier` string (never the ticket
  object), calls `queue.createQueue`/`queue.enqueueOne` — no direct
  `submitTicket`. Confirmed no new queuing mechanism: `lib/ui/queue.js` has
  zero diff.

- **Constraint (selectability refusal must extend to queued)**: read
  `isSelectable` (`launchpad.js:150-158`) — now refuses both `▲ running` and
  `⏳ queued`. Verified all four call sites design.md Decision 4 names are
  threaded with `queueState`: `toggle-select` (`watch.js:1757`), `select-all`
  (`watch.js:1765`), `open-launchplan`'s re-check (`watch.js:1853`), and —
  the easiest one to miss — `confirm-launch`'s "third and final refusal"
  (`watch.js:2028-2029`, `startable`/`skipped` filters immediately before
  `queue.createQueue()`). Confirmed `quickStartEligible` (`watch.js:696-705`)
  is legitimately left two-arg: it has its own separate `inQueue` filter
  (`watch.js:697-699`), matching the proposal's explicit non-goal.

- **Tests actually run, fresh, by me** (not trusted from the evaluator's
  claim alone):
  - `npm test` → exit 0, `tests 1014 / pass 1014 / fail 0 / cancelled 0`, all
    16 chained bash suites also passed — reproduces the evaluator's exact
    reported numbers.
  - `node --test test/watch.test.js` → 58/58 pass, including all 5 new
    end-to-end `add-to-queue` tests (create, append via `enqueueOne`, no-op
    on already-running, no-op on already-queued, and the
    `confirm-launch`-duplicate-queue race test).
  - `node --test test/launchpad.test.js` → 90/90 pass.
  - Read the new tests in both files in full: they assert on observable
    state (`spawnCalls`, `queueCache.read()`, rendered ANSI/text output), not
    reimplementations of the logic under test — e.g. the duplicate-queue
    race test drives a real `q` → `space` → `L` → `\r` keypress sequence
    through a real `watch()` loop (fake tmux session, no fake queue logic)
    and asserts CON-90 never reaches a second `queue.createQueue()` call.
  - No lint script/config exists in this repo (`package.json`'s `scripts`
    confirmed — `test` only, no `lint`), matching both the evaluator's and
    my own finding; nothing to re-run there.

- **No debug leftovers / scope creep**: `grep` for
  `console\.|debugger|TODO|FIXME|XXX` in both changed source files turns up
  only two pre-existing, unrelated `console.error` calls in `watch.js` (tmux
  detection, quit-with-jobs warning) — not introduced by this diff.

- **`q` key safety** (design.md Decision 2's own claim, independently
  verified rather than trusted): `fleet.js`'s `q`-quit binding
  (`fleet.js:1088`, `:1213`) is inside `fleet.js`'s own `handleKey`; `router.js`
  (`:24-33`) dispatches by `mode` to exactly one screen's `handleKey` at a
  time, so `launchpad.js`'s `q` binding is never reachable while `fleet.js`'s
  is active, and vice versa — the reuse is genuinely safe, not just asserted
  safe.

- **Exports/wiring** (tasks 5.1/5.2): `module.exports`
  (`launchpad.js:545-552`) still exports `inlineStatus`/`isSelectable`/
  `selectableIdentifiers`/`ticketRow` under the same names (signatures only
  changed, as tasks.md predicted); `render()`/`routeHandleKey()`
  (`launchpad.js:529-543`) already pass `state.queueState` through, confirmed
  by reading the functions directly.

- **UI/design judgment**: N/A per role instructions — no UI review configured
  for this project, no design standard document, dev-server steps skipped.
  This is a terminal-UI (ANSI/tmux) change, not a browser UI change; the
  colour-distinctness and hint-line-truncation-precedence concerns that would
  normally be my domain were verified above via direct ANSI-code assertions
  and code reading instead.

### Verdict: CONFIRM

Both ticket ACs are traced to real, tested code. The constraint most likely
to be silently dropped — extending the queued-refusal all the way through
`confirm-launch`'s re-check — was specifically checked and is present, with
an end-to-end regression test that would actually fail if that threading
were reverted. Test counts and pass/fail were independently reproduced, not
taken on the evaluator's word. No scope creep, no second queuing mechanism,
no dead code.

### Non-blocking notes
- Same one the evaluator flagged: task 7.2's "queuing via `q` ends up
  visible identically in `fleet.js`'s QUEUED section" has no dedicated
  fleet.js-rendering assertion. Low-risk (the `add-to-queue` case writes the
  identical `queueState` shape `confirm-launch` already produces, and
  `fleet.js`'s QUEUED section doesn't know how a queue entry originated) but
  worth a follow-up assertion for a future reader's benefit.
