## 1. Discovery module

- [x] 1.1 Create `lib/ui/discovery.js`: process enumeration via `/proc`
  matched against the project's configured `harnesses` (via
  `harness.js`'s `cliLabel()`) plus `RECOGNISED_EXTRA_BINARIES = ['hermes',
  'copilot', 'qwen']` (design.md Decision 2/3). Every per-pid read
  (`comm`, `cwd`, `cmdline`, `exe`, `stat`) independently try/caught.
- [x] 1.2 Add age approximation via `fs.statSync('/proc/<pid>').mtime`
  (design.md Decision 3), documented as an approximation in the module's
  header comment.
- [x] 1.3 Add tmux-wide cross-reference: `tmux list-panes -a -F
  '#{session_name}\t#{window_name}\t#{window_id}\t#{pane_pid}\t#{pane_dead}'`
  plus bounded (6-hop) pid-ancestry walk via `/proc/<pid>/stat` ppid field
  to attach a `session:window` label (design.md Decision 4).
- [x] 1.4 Add version probing: resolve absolute binary path from
  `/proc/<pid>/exe` (fallback: first `cmdline` token), probe once per path
  via `execFileSync(path, ['--version'], { timeout: 300, encoding: 'utf8'
  })`, cache result (including failure) in an in-memory `Map` for the
  process lifetime (design.md Decision 5).
- [x] 1.5 Add Concertino-managed vs. freelance classification (design.md
  Decision 6, revised — skeptic design round 1): a session is managed
  **only** when its tmux cross-reference resolves to the dashboard's own
  tmux session name AND the window name matches `ticket.js`'s existing
  `TICKET_RE`; no dependency on `S.runs` telemetry for this case. A cwd
  under `.concertino/worktrees/<ticket>` is never sufficient on its own —
  compute it as a separate, display-only `nearTicket` hint field on the
  session record, never folded into the managed/freelance classification
  itself.
- [x] 1.6 Export a single `discover(opts)` entry point returning the full
  session list, with every internal step wrapped so a missing source
  (`/proc` absent, `tmux` not installed) degrades to an empty/partial
  result rather than throwing.
- [x] 1.7 `test/discovery.test.js`: cover version-cache reuse (Decision 5),
  a session with an unreadable `cwd` still appearing (Decision 3's own
  scenario), classification of a managed-but-no-telemetry window
  (Decision 6's own scenario), a freelance process whose cwd sits inside a
  live ticket's worktree still classifying as freelance (Decision 6's
  revised scenario — the skeptic's change request 1), and `discover()`
  never throwing when a source is unavailable — inject fakes for
  `fs`/`execFileSync`/tmux calls rather than depending on the real `/proc`
  or a real tmux server.

## 2. Generalised attach/kill in session.js

- [x] 2.1 Add `attachTarget(sessionName, windowId)` to `lib/ui/session.js`,
  mirroring `attach()`'s existing shape (`spawnSync('tmux', ['attach',
  '-t', sessionName + ':' + windowId], { stdio: 'inherit' })`).
- [x] 2.2 Add `killTarget(sessionName, windowId)` to `lib/ui/session.js`,
  mirroring `kill()`'s existing try/catch shape via `tmux kill-window`.
- [x] 2.3 `test/session.test.js`: extend with coverage for both new
  exports (mirroring the existing `attach`/`kill` test coverage for the
  ticket-scoped versions).

## 3. Sessions screen + controller

- [x] 3.1 Create `lib/ui/screens/sessions.js`: `render(state, opts)` and
  `routeHandleKey(key, state)`, following the shape every other screen
  module in `lib/ui/screens/` already exports (see `settings.js` as the
  closest analogue — a screen with no per-ticket sub-state beyond a
  cursor and a confirm flag). Renders: harness, version (or "unknown"),
  cwd (or "unknown", plus the display-only "near ticket `<id>`'s
  worktree" hint from task 1.5 when set on a freelance row), tmux
  location (or "not in tmux"), age, managed (ticket id) vs. freelance, and
  per-row hints for attach/kill matching drilldown.js's own hint-list
  convention (`↵ attach`, `k kill`, only shown when applicable per
  design.md Decision 7 — including omitting `↵ attach` for a freelance
  row with no tmux location). A managed row's confirm state reads
  `state.drillConfirm`; a freelance row's reads
  `state.sessionsKillConfirm` (design.md Decision 7's confirm-state-field
  bullet — these are deliberately two different fields).
- [x] 3.2 Create `lib/ui/controllers/sessions.js`: `open()` (runs
  `discovery.discover()` synchronously, sets `S.mode = 'sessions'`),
  `refresh()`, `moveSelection(delta)`, and the attach/kill dispatch split
  from design.md Decision 7 (revised — skeptic design round 1, change
  requests 2 and 3): a managed row's attach dispatches the existing
  `attach`/`confirm-action` actions verbatim (unchanged, no result to
  lose); a managed row's confirmed kill calls a new
  `killManagedConfirmed(ticket)` that calls `control.killConfirmed` itself
  and sets `S.sessionsError` on a `{killed: false}` result — it does
  **not** reuse `applyAction`'s `'kill-confirmed'` case, which discards
  that result; `attachFreelance()`/`killFreelanceConfirmed()` (new) for a
  freelance session per Decision 7's freelance bullets.
- [x] 3.3 `test/screens/sessions.test.js` and
  `test/controllers-sessions.test.js` (naming to match the existing
  `controllers-drilldown.test.js` precedent): cover render of a managed
  vs. freelance row (including the freelance-with-near-ticket-hint case),
  the not-attachable freelance case, the attach/kill dispatch split
  (managed attach -> existing action type; managed kill ->
  `killManagedConfirmed` with `S.sessionsError` set on a `{killed: false}`
  result; freelance -> new action types), and that a managed row's
  confirm state is read from `state.drillConfirm` while a freelance row's
  is read from `state.sessionsKillConfirm`.

## 4. Wiring

- [x] 4.1 `lib/ui/router.js`: register `sessions` in `SCREENS`.
- [x] 4.2 `lib/ui/app-state.js`: `mode` is an unconstrained string (no
  central allow-list to update — design.md Decision 8's corrected note);
  add `sessionsData`, `sessionsSelected`, `sessionsKillConfirm`,
  `sessionsError` initial state; reset all four in `backToFleet()`.
- [x] 4.3 `lib/ui/screens/fleet/keys.js`: add the `v` key -> `{ type:
  'open-sessions' }`, alongside the existing `open-settings`/
  `open-launchpad` bindings.
- [x] 4.4 `lib/ui/watch.js`: wire `open-sessions`/`refresh-sessions`/
  `move-sessions` and the managed-row actions (`attach`,
  `confirm-action`/`kill`, `kill-session-managed`) and freelance-row
  actions (`attach-session`/`kill-session-confirm`/
  `kill-session-confirmed`) into the existing `applyAction` dispatch per
  design.md Decision 7/8's revised wiring list; add the bounded
  (every-3rd-tick) auto-refresh gated on `S.mode === 'sessions'` next to
  the existing `if (running) S.runs = draw();` line in the poll timer
  (design.md Decision 1) — never on an unconditional tick.
- [x] 4.5 `test/router.test.js`, `test/watch.test.js`: extend with
  coverage for the new `sessions` mode routing and the gated auto-refresh
  (a fleet-mode tick performs no discovery; a sessions-mode tick performs
  discovery only on the 3rd tick).

## 5. Verification

- [x] 5.1 Run the full existing test suite (`npm test`) — zero
  regressions in any currently-passing test.
- [x] 5.2 Manually verify (documented in the executor's own evidence, not
  a new script): a freelance `claude`/`codex` session started by hand in
  a plain terminal appears in the sessions view with harness/cwd/age; a
  Concertino-launched window with no telemetry yet appears labelled with
  its ticket; attach/kill both work for a managed session (delegating)
  and for a freelance tmux-backed session (new minimal path).
