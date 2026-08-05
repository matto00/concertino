## New files

- `lib/ui/discovery.js` — the discovery module: `/proc`-based process enumeration matched against configured `harnesses` + `RECOGNISED_EXTRA_BINARIES`, tmux-wide (`-a`) cross-reference with a bounded 6-hop pid-ancestry walk, once-per-binary-path cached version probing, and Concertino-managed/freelance classification (tmux-ancestry-confirmed only, per design.md Decision 6's revision).
- `lib/ui/screens/sessions.js` — the sessions screen: `render`/`routeHandleKey`, following the router seam every other screen uses. Renders harness/version/cwd/tmux-location/age/owner per row, with a managed row's confirm reading `state.drillConfirm` (gate) + `state.sessionsConfirmTicket` (target) and a freelance row's reading `state.sessionsKillConfirm` (`{ pid, tmux }`, both gate and target) — both targets captured at `k`-press time, never re-derived from `sessions[selected]` (evaluator cycle-1 fix, see below).
- `lib/ui/controllers/sessions.js` — the sessions controller: `open()`/`refresh()`/`moveSelection()`, and the attach/kill dispatch split (managed delegates to `control.killConfirmed`/the existing `attach` action; freelance uses the new `session.killTarget`/SIGTERM path, surfacing failures via `S.sessionsError`).
- `test/discovery.test.js` — discovery module tests against injected `fs`/`execFileSync`/tmux fakes (never a real `/proc` or tmux server).
- `test/sessions.test.js` — sessions screen render/handleKey tests.
- `test/controllers-sessions.test.js` — sessions controller tests against a fake `ctx`.

## Modified files

- `lib/ui/session.js` — added `attachTarget(sessionName, windowId)`/`killTarget(sessionName, windowId)`, the sessions view's own generalised (non-ticket-scoped) attach/kill.
- `lib/ui/router.js` — registered the `sessions` screen in `SCREENS`.
- `lib/ui/app-state.js` — added `sessionsData`/`sessionsSelected`/`sessionsKillConfirm`/`sessionsConfirmTicket`/`sessionsError` state, exposed them through `currentState()`, reset them in `backToFleet()`.
- `lib/ui/screens/fleet/keys.js` — added the `v` key -> `{ type: 'open-sessions' }`.
- `lib/ui/controllers/index.js` — registered the sessions controller in `CONTROLLERS`.
- `lib/ui/watch.js` — required `discovery`/the sessions controller/`session.js`'s new `attachTarget`/`killTarget` (routed through `ctx.deps` for the require-cache-fake technique this file documents); added `sessionsAutoRefreshDue(mode, tickCount)` (exported, pure, directly unit-tested — the poll timer's own every-3rd-tick gate); wired the gated auto-refresh into the poll timer, ahead of `draw()`; added `doAttachTarget()` (the freelance-attach twin of `doAttach()`) and special-cased `'attach-session'` in `applyAction`, mirroring `'attach'`; added `sessions: 'SESSIONS'` to `SCREEN_LABELS`.
- `test/session.test.js` — added coverage for `attachTarget`/`killTarget`.
- `test/router.test.js` — added coverage for the sessions screen routing through the router.
- `test/watch.test.js` — added `sessionsAutoRefreshDue` unit tests and an end-to-end `v`-opens/`Escape`-closes sessions-screen test against a real `watch()` loop with faked session/discovery modules.

## tasks.md / manual verification

- `openspec/changes/harness-sessions-view/tasks.md` — all 20 tasks marked complete.
- Manual verification (task 5.2) was run against the real environment (real `/proc`, a real tmux server) rather than only the fakes above:
  - `discovery.discover({ sessionName: 'concertino', config: { harnesses: ['claude-code'] } })` correctly found this very executor's own live Concertino-managed session (pid, harness `claude`, version `2.1.222 (Claude Code)`, tmux `concertino:CON-78`, `managed: true`, `ticket: 'CON-78'`) with no run.start-derived telemetry consulted at all — the CON-77 scenario the ticket is prompted by.
  - A freelance non-tmux process (a fake `hermes` binary, `RECOGNISED_EXTRA_BINARIES`) was discovered with pid/cwd/age, `managed: false`.
  - A freelance process inside an unrelated tmux session (`adhoc-test`) was discovered with `tmux: { session: 'adhoc-test', window: 'scratch-window', ... }`, `managed: false`.
  - A freelance process inside a tmux session named similarly to, but distinct from, Concertino's own (`concertino-manual-test`, ticket-shaped window `CON-999`) still classified `managed: false` — confirms the session-name check is exact equality, not a prefix/substring match.
  - `session.killTarget(sessionName, windowId)` was run against both real freelance tmux windows above and confirmed (via `tmux list-panes -a`) to remove exactly those windows, leaving the real `concertino` session's own windows untouched.
  - All manual-verification tmux sessions/processes were torn down afterward; the real `concertino` session was never touched.

## Cycle 2 — evaluator change request 1

Evaluator's cycle-1 report (`evaluation-1.md`): a pending managed-row kill
confirm could be silently retargeted to a different session if the sessions
screen's background auto-refresh replaced/reordered `state.sessionsData`
between the `k` press (opening the confirm) and the `y` press (confirming),
because both render and `handleKey` re-derived the confirming/confirmed
session as `sessions[selected]` live, instead of capturing it at `k`-press
time — the freelance path already captured correctly
(`S.sessionsKillConfirm = { pid, tmux }`); the managed path did not.

- `lib/ui/screens/sessions.js` — render (`managedConfirming`/the confirm
  label) and `handleKey` (the confirm-gate check, the `y`/other-key
  dispatch, and `k`'s own confirm-open dispatch) now read/act on
  `state.sessionsConfirmTicket` (new) instead of `sess.ticket` re-derived
  from `sessions[selected]`. `k` on a managed row now dispatches a new,
  sessions-owned `open-managed-kill-confirm` (carrying the ticket captured
  right there) instead of drilldown's generic `confirm-action`; any
  other key while confirming now dispatches a new `cancel-managed-kill-confirm`
  instead of drilldown's generic `cancel-confirm`. The freelance render's
  confirm label was also switched from `sess.pid` to the already-captured
  `state.sessionsKillConfirm.pid` — the same bug class, found while fixing
  the managed path, in code being touched anyway.
- `lib/ui/controllers/sessions.js` — added `open-managed-kill-confirm`
  (sets `S.drillConfirm = 'kill'` as the boolean gate, per design.md
  Decision 7's stated reason for reusing it, and `S.sessionsConfirmTicket`
  as the captured target) and `cancel-managed-kill-confirm` (clears both).
  `openSessions()`/`killManagedConfirmed()` reset/clear
  `S.sessionsConfirmTicket` alongside the fields they already reset/cleared.
- `lib/ui/app-state.js` — added `sessionsConfirmTicket` to the state
  container, `currentState()`, and `backToFleet()`'s reset list.
- `test/sessions.test.js` — updated the managed-confirm tests for the new
  action names/captured field, and added the evaluator-requested regression
  test: a managed-row confirm opened for `CON-90`, then `sessionsData`
  replaced with a different managed session at the same index (`CON-91`) —
  asserts both the render and the `y`-key dispatch still target `CON-90`.
  Also added the equivalent freelance-render regression (the captured `pid`,
  not the reordered row's `pid`, is what the label shows).
- `test/controllers-sessions.test.js` — updated for the new action names,
  and added the controller-layer version of the same regression: opens a
  managed confirm for `CON-90`, dispatches `refresh-sessions` (a real
  `discover()` fake returning a different session at index 0), asserts the
  captured target and the confirm gate both survive the refresh unchanged,
  then asserts the eventual kill targets `CON-90`, never the session the
  refresh put at that index.

Verification (fresh, cycle 2): `npm test` — 1558 tests, 0 failed, exit code
0 (`node --test`'s own 1558/1558, plus every shell-script gate in the
`npm test` chain green).
