## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket acceptance criteria addressed explicitly:
  - Freelance session (harness/cwd/age) — `lib/ui/discovery.js` +
    `lib/ui/screens/sessions.js` row rendering.
  - CON-77 no-telemetry managed window still labelled — `discovery.js`'s
    `classify()` (tmux-ancestry + `TICKET_RE` on window name only, no
    `S.runs` dependency), matching `design.md` Decision 6 and
    `specs/harness-sessions/spec.md`'s "no telemetry" scenario.
  - Managed vs. freelance distinguished, including the cwd-under-worktree
    edge case resolved to freelance + `nearTicket` display-only hint
    (`discovery.js:159-187` equivalent logic, `classify`/`nearTicketHint`).
  - Discovery best-effort/non-blocking — every `/proc`/tmux step
    independently try/caught (`discovery.js` throughout); gated to the
    sessions screen only (`watch.js`'s `sessionsAutoRefreshDue`), never on
    the fleet's unconditional 1s tick.
- No AC silently reinterpreted; no scope creep — diff is confined to the
  files `proposal.md`'s Impact section named, plus their tests.
- `tasks.md`: all 20 items marked `[x]`, matching what's actually
  implemented (spot-checked several against the diff: 1.1-1.7 discovery,
  2.1-2.3 session.js additions, 3.1-3.3 screen/controller, 4.1-4.5 wiring —
  including the two skeptic-flagged non-blocking notes from
  `skeptic-design-2.md` (controller registration in `controllers/index.js`,
  and threading `ctx.session.name` into `discover()`), both of which the
  implementation does correctly).
- No regressions to existing behavior: `git diff main...HEAD` touches no
  existing screen's own requirements; `drilldown.js`'s `'kill-confirmed'`
  case and its own state fields (`drillNotice`) are untouched — the sessions
  controller deliberately does not reuse that case, exactly as `design.md`
  Decision 7 specifies.
- No API/schema changes — this is a purely additive UI feature (no
  telemetry wire-shape changes), consistent with `design.md`'s own Migration
  Plan.
- Planning artifacts reflect final implemented behavior — spot-checked
  `specs/harness-sessions/spec.md`'s scenarios against the actual code paths
  (classification, version caching, attach/kill split); all match.

### Phase 2: Code Review — FAIL

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE`, default speed):
`npm test` — **1550 passed, 0 failed**, exit code 0.

No canonical code-quality standard is configured for this project beyond
what's already enforced by the test suite; reviewed against DRY/readability/
modularity/type-safety/security/error-handling/test-quality/dead-code/
over-engineering:

- DRY: attach/kill genuinely delegate to existing functions for managed rows
  (`control.killConfirmed`, the existing `'attach'` action) — no duplicate
  implementation. `session.js`'s new `attachTarget`/`killTarget` mirror
  `attach()`/`kill()`'s shape without copy-pasting logic verbatim beyond what
  the different addressing scheme requires. Shared widgets (`confirmLines`,
  `emptyState`, `f.hintLines`) are reused, not reimplemented.
- Readable/modular: `discovery.js` is cleanly decomposed into single-purpose
  functions (`enumerateProcesses`, `listTmuxPanes`, `findTmuxAncestor`,
  `classify`, `resolveVersion`) each independently exported for testing.
  Screen/controller split follows the existing `settings.js`/`drilldown.js`
  precedent exactly.
- Type-safety/security: no untyped escape hatches; `execFileSync`/
  `process.kill` targets are resolved from `/proc` reads or a live
  `tmux list-panes` row, never unvalidated external input.
- No dead code: no TODO/FIXME/console.log/debugger found in any new or
  modified file (`grep` clean).
- Tests meaningful: `test/discovery.test.js` (17 cases) exercises every
  classification/caching/degrade-gracefully scenario the spec calls out,
  including the specific reordering/misclassification cases
  `skeptic-design-1.md`'s change requests raised; `test/sessions.test.js`
  (26) and `test/controllers-sessions.test.js` (15) cover render/dispatch
  splits; `test/watch.test.js` adds a real end-to-end `v`-opens/
  `Escape`-closes test plus unit coverage of `sessionsAutoRefreshDue`.

**Change Request — a pending managed-row kill confirm can be silently
retargeted to a different session by the sessions screen's own background
auto-refresh, and then killed on the next `y` press:**

- `lib/ui/screens/sessions.js:93` (render) and `:125-126` (`handleKey`) both
  resolve the confirming/confirmed session as `sessions[selected]` —
  re-derived from the **current** `state.sessionsData` array and
  `state.sessionsSelected` index — every time, rather than from a value
  captured when the `k` confirm was first opened
  (`lib/ui/screens/sessions.js:148`, `{ type: 'confirm-action', action:
  'kill' }` — no ticket/pid captured).
- `lib/ui/controllers/sessions.js:47-53` (`refreshSessions`) unconditionally
  replaces `S.sessionsData` with a fresh `discover()` result on the bounded
  3-tick auto-refresh (`watch.js`'s poll timer, `design.md` Decision 1) — it
  does not check for, or preserve identity across, a pending
  `state.drillConfirm === 'kill'` confirm on a managed row.
- Concretely: operator selects a managed row for ticket `CON-90`, presses
  `k` (confirm-action, per `sessions.js:148`) and pauses to read the
  confirmation prompt; a routine 3-second auto-refresh runs in the
  background and the discovered process list reorders (a new harness
  process appeared/exited, or `/proc` readdir order simply shifted) such
  that the same array index now holds a *different* managed session, e.g.
  `CON-91`; the render (`sessions.js:93`) now shows "kill CON-91?" — or, if
  the operator doesn't notice the ticket id changed in the prompt and
  presses `y`, `handleKey` (`sessions.js:126`) returns `{ type:
  'kill-session-managed', ticket: sess.ticket }` where `sess.ticket` is now
  `CON-91`, not the `CON-90` the operator actually intended to kill —
  `controllers/sessions.js`'s `killManagedConfirmed` then kills the wrong
  live run.
- This is precisely the class of bug `design.md` Decision 7's own freelance
  branch explicitly identifies and fixes ("captures the target at the moment
  'k' was pressed... never on whatever row happens to be selected when it
  fires (a refresh could have reordered the list in between)" —
  `lib/ui/controllers/sessions.js:113-115`'s comment on
  `kill-session-confirm`), but the fix was applied only to the freelance
  path (`S.sessionsKillConfirm = { pid, tmux }`, captured at `k`-press time)
  and not to the managed path, which still resolves its target from the
  live list at `y`-press time.
- **Fix**: capture the confirming ticket at `k`-press time for a managed row
  too (e.g. a new `S.sessionsConfirmTicket`, set alongside/instead of
  relying on `drillConfirm` for target resolution — `drillConfirm` can stay
  as the boolean gate, matching `design.md`'s own stated reason for reusing
  it), and have both the render (`sessions.js:93`) and the `y`-key dispatch
  (`sessions.js:125-126`) read that captured value rather than
  `sessions[selected]`. No test in `test/sessions.test.js` or
  `test/controllers-sessions.test.js` currently exercises a refresh landing
  between confirm-open and `y`-press, so this gap slipped through both the
  design-skeptic rounds (which reviewed `design.md`'s text, where this
  asymmetry between the two branches isn't called out) and the implementer's
  own tests.

### Phase 3: UI Review — N/A

No UI review configured for this project (per role instructions); dev-server
steps skipped.

### Overall: FAIL

### Change Requests

1. `lib/ui/screens/sessions.js` (render at `:93`, `handleKey` at `:125-126`
   and `:148`) and `lib/ui/controllers/sessions.js` (`refreshSessions` at
   `:47-53`): capture the managed row's target ticket at `k`-press time
   (mirroring the freelance branch's own `S.sessionsKillConfirm = { pid,
   tmux }` capture, e.g. a new `S.sessionsConfirmTicket`), and resolve the
   confirming/confirmed session from that captured value rather than
   re-deriving it from `sessions[state.sessionsSelected]` on every render
   and on the `y` key — a background auto-refresh reordering
   `state.sessionsData` between the confirm prompt opening and the operator
   pressing `y` must never retarget a pending kill to a different session.
   Add a regression test (in `test/sessions.test.js` and/or
   `test/controllers-sessions.test.js`) that opens a managed-row kill
   confirm, simulates a refresh that changes the array order/contents, and
   asserts the kill still targets the originally-confirmed ticket.

### Non-blocking Suggestions

- None beyond the change request above — code quality, test coverage
  breadth, and spec/design fidelity are otherwise solid.
