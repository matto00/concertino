## Context

Concertino's dashboard (`lib/ui/watch.js` + the screen/controller/router
seam in `lib/ui/screens/*` / `lib/ui/controllers/*` / `lib/ui/router.js`)
currently only knows about two things: Concertino runs (evidenced by
`.concertino/runs/<TICKET>/events.jsonl`, rendered by the fleet screen) and
windows inside Concertino's own tmux session (`lib/ui/session.js`'s
`createSession()`, named `concertino` by convention). A `claude`/`codex`/
`opencode` session started by hand in another terminal, or a Concertino
launch whose window exists but never got as far as `run.start` (CON-77,
`spawn-visibility`), is invisible to the first lens and only partially
visible to the second (only if it happens to be inside Concertino's own tmux
session).

Environment constraint: this project runs on Linux only (see `env` — Arch
Linux); `/proc` is always available in the target environment, but the
design still degrades gracefully rather than assuming it, since a future
non-Linux run of the dashboard binary must not crash.

## Goals / Non-Goals

**Goals:**
- Enumerate live harness processes system-wide (not just inside Concertino's
  own tmux session), classify each as Concertino-managed or freelance, and
  show the info the ticket calls out: harness, version (best-effort), cwd,
  tmux location (when any), age, managed/freelance + ticket.
- Reuse the drill-down's existing attach/kill *functions* for a
  Concertino-managed session (same `session.attach`/`control.killConfirmed`
  call sites, never a second implementation) while still surfacing a failed
  kill on the sessions screen itself, rather than silently reusing a result
  handler that was written for a different screen's own state fields.
- Never let discovery slow or block the fleet's own 1s poll tick.

**Non-Goals (mirrors the ticket's own "Explicit non-goals"):**
- Cost/usage tracking (CON-61).
- Remote/multi-machine discovery.
- Reconstructing another harness's conversation content from its session
  files — visibility only (harness/cwd/age/model), never content.
- Per-poll version/liveness probing of every process — version is fetched
  lazily and cached per resolved binary path, not per pid, not per poll.

## Decisions

### Decision 1 — Discovery runs only while the sessions screen is open

`lib/ui/discovery.js` exports a single `discover(opts)` that does the actual
process/tmux enumeration. It is never called from the fleet's unconditional
`setInterval(..., POLL_MS)` tick in `watch.js`. It is called:
- once, synchronously, when the sessions screen is entered (`open-sessions`
  action), and
- on every 3rd poll tick thereafter while `S.mode === 'sessions'` (a `tickCount
  % 3 === 0` guard next to the existing `if (running) S.runs = draw();`
  line), i.e. roughly every 3s, not every 1s — a full `/proc` sweep plus a
  `tmux list-panes -a` shell-out is cheap but not free, and nothing about
  a sessions view needs 1s-fresh data, and
- on the `r` key while the screen is open (manual refresh, same convention
  the launch pad's own refresh already uses).

Alternative considered: run discovery unconditionally on every poll tick
regardless of screen, so switching to the sessions screen never shows stale
data. Rejected — this is exactly the "never blocks or slows the poll loop"
acceptance criterion; gating on `S.mode === 'sessions'` makes the cost zero
for every user who never opens the screen, which is the common case.

### Decision 2 — Harness recognition list

A session is a "harness process" if its `/proc/<pid>/comm` basename matches
either (a) the CLI binary for one of the project's own configured
`harnesses` (via `harness.js`'s existing `cliLabel()` — e.g. `claude-code` ->
`claude`), or (b) a small static "recognised extras" list:
`['hermes', 'copilot', 'qwen']`, per the ticket's own examples. This list
lives as an exported constant in `discovery.js` (`RECOGNISED_EXTRA_BINARIES`)
so it is one place to extend later, not scattered across the module.

Alternative considered: make the extras list configurable in
`concertino.config.json`. Rejected for v1 — the ticket explicitly frames
process enumeration as "v1", and a config knob for a handful of binary names
is easy to add later without touching discovery's shape; shipping a static
list first keeps the change reviewable.

### Decision 3 — Process enumeration mechanics

For each numeric entry in `fs.readdirSync('/proc')`:
- Read `/proc/<pid>/comm` (cheap, small, no exec needed). Skip pids whose
  comm doesn't match the recognition list from Decision 2. Every read is
  wrapped in try/catch — a pid that exits between `readdir` and `readFile`,
  or one this user can't read, is silently skipped, never a crash.
- For a match, read `/proc/<pid>/cwd` via `fs.readlinkSync` (best-effort;
  EACCES for another user's process is caught and the session still appears,
  with `cwd: null`).
- Approximate the process's start time (age) from `fs.statSync('/proc/<pid>').mtime`
  — the standard Linux trick of using the `/proc/<pid>` directory's own
  mtime as a process-start proxy (the directory is created at fork/exec and
  never subsequently modified). This is an approximation, documented as such
  in the module's header comment, not a claim of exactness; it is
  sufficient for an "age" column.
- Read `/proc/<pid>/cmdline` (NUL-separated) for the full command, used only
  to resolve the binary's absolute path for version-probing (Decision 5),
  never rendered as raw content (matches the ticket's "visibility only, not
  reconstructing content" non-goal in spirit — the sessions view shows a
  harness label, not a transcript).

Alternative considered: shell out to `ps -eo pid,etimes,args --no-headers`
once instead of iterating `/proc` directly. Rejected — `ps`'s own output
format for `args` is truncated/platform-variable and still requires the same
per-pid `/proc/<pid>/cwd` readlink for cwd, so it buys nothing over reading
`/proc` directly while adding a subprocess dependency `/proc` doesn't need.

Caveat (skeptic design round 1, non-blocking note): `/proc/<pid>/comm` is
kernel-truncated to 15 bytes, and a shebang'd script (common for Node-based
CLIs depending on how they're installed — a global npm shim vs. a direct
executable) may not literally equal the binary names Decision 2's
recognition list expects. None of `claude`, `codex`, `opencode`, `hermes`,
`copilot`, `qwen` exceed 15 characters, so this is not a problem for the
list as it stands today, but it is the single mechanism every later decision
in this document builds on, so it is worth this explicit acknowledgment: a
future addition to the recognition list must stay within the 15-byte
`comm` limit or accept that it degrades to "invisible" (the same
already-accepted best-effort failure mode as every other unreadable field in
this design) rather than matching.

### Decision 4 — tmux cross-reference is session-wide, not just Concertino's

`discovery.js` calls `tmux list-panes -a -F '#{session_name}\t#{window_name}\t#{window_id}\t#{pane_pid}\t#{pane_dead}'`
(the `-a` flag is what makes this "all sessions", not just the `concertino`
one — this is the literal "tmux-wide enumeration" option the ticket calls
out). For each harness pid found in Decision 3, walk up its parent chain via
`/proc/<pid>/stat` field 4 (`ppid`), up to 6 hops, checking membership
against the pane-pid set on each hop; the first match attaches that pane's
`session_name:window_name` (and `window_id`, kept for kill/attach targeting)
to the session record. A harness process with no tmux ancestor within 6 hops
is reported with `tmux: null` (started directly in a non-tmux terminal, or
nested deeper than this walk bothers to check).

Alternative considered: match by cwd instead of pid ancestry (a pane's
current working directory happens to often match). Rejected — a pane's cwd
drifts as the user `cd`s around after launching the harness, and two
different tmux windows can share the same repo cwd; pid ancestry is the
actual causal relationship and does not drift.

### Decision 5 — Version is probed once per binary path, cached for the process lifetime

The first time discovery sees a given resolved absolute binary path (from
`/proc/<pid>/exe` readlink, falling back to the first `cmdline` token when
`/proc/<pid>/exe` isn't readable), it spawns `execFileSync(path, ['--version'],
{ timeout: 300, encoding: 'utf8' })` in a try/catch and caches the trimmed
stdout (or `null` on any failure/timeout) in an in-memory `Map` keyed by that
path, for the lifetime of the dashboard process. Every subsequent sighting of
a session running that same binary path reads the cache — no repeat spawn.
This bounds the worst case (many distinct harness binaries seen for the
first time in one discovery pass) while making the steady state (the same
one or two CLIs, over and over) free.

Alternative considered: never probe version at all (out of scope), only show
the harness name. Rejected — the ticket's acceptance criteria and scope
explicitly ask for "harness + version"; the cache makes the cost of
including it negligible after the first sighting.

### Decision 6 — Concertino-managed vs. freelance classification (revised — skeptic design round 1, change request 1)

A discovered session is Concertino-managed, with a resolved ticket id,
**only** when its tmux cross-reference (Decision 4) resolves to
`session_name === session.name` (the Concertino tmux session, e.g.
`concertino`) AND the window name matches the project's ticket-id pattern
(`lib/ui/ticket.js`'s existing `TICKET_RE`) — the ticket id is that window
name, directly, no telemetry required (this is exactly the CON-77 case: a
window with no `run.start` yet still classifies as managed because the
window name alone is enough, and does not require a matching object in
`S.runs`). This is the **only** classification path: "managed" means "this
discovered process is the ticket's own tmux-window process," never merely
"looks related to a ticket."

Everything else is freelance — **including** a freelance process whose `cwd`
happens to sit inside a `.concertino/worktrees/<ticket>` path (e.g. a
developer poking around by hand in the same worktree a Concertino run is
using). `cwd` is still read and rendered (Decision 3) for every session, and
when a freelance session's cwd falls under a worktree path whose trailing
segment matches `TICKET_RE`, the sessions view labels it "near ticket
`<id>`'s worktree" as **display-only** context — it has no bearing on
classification and, critically, no bearing on which attach/kill action path
Decision 7 selects for that row. This closes the misclassification the
original draft had: cwd alone used to be sufficient to classify a session as
managed, which then routed its attach/kill through the ticket-scoped actions
(targeting the canonical window, not the discovered pid) — a freelance
process sitting in a live ticket's worktree could have its kill silently
kill the unrelated live run instead. Cwd is now purely informational; only
confirmed tmux ancestry to Concertino's own session decides "managed."

Alternative considered (the skeptic's own option (b)): keep cwd-based
labeling as an independent "managed" classification, but route those rows'
attach/kill through the freelance pid-based actions regardless of the
managed label. Rejected in favor of the simpler fix above — a row labeled
"managed" that is attached/killed through the *freelance* path would still
read as a confusing halfway state ("why does a managed row use the freelance
kill?"); folding cwd into pure display context keeps "managed" meaning
exactly one thing everywhere it appears (label AND action routing), which is
easier to reason about and to test.

### Decision 7 — Attach/kill: delegate for managed, minimal new path for freelance (revised — skeptic design round 1, change requests 2 and 3)

For a Concertino-managed session (a resolved ticket id, Decision 6 as
revised — tmux-ancestry-confirmed only), the sessions screen's Enter/`k`
keys dispatch to the **same underlying functions** the drill-down already
uses, so this is still "no separate attach/kill implementation" in the sense
that matters (no second `session.attach`/`session.kill` call site is
written) — but the dispatch and result-handling are explicit, not a verbatim
reuse of `applyAction`'s `'kill-confirmed'` case, because that case
(`lib/ui/controllers/drilldown.js`'s `case 'kill-confirmed'`) discards
`control.killConfirmed`'s return value and always clears `S.drillNotice` —
a field the sessions screen never renders (see Decision 8's state list,
which is `sessionsData`/`sessionsSelected`/`sessionsKillConfirm`/
`sessionsError`, not `drillNotice`). Reusing that case verbatim would mean a
delegated kill that fails (`control.killConfirmed` returns `{killed: false,
reason: 'not-live'}` — e.g. the ticket's own run already ended) gives the
operator no feedback at all on the sessions screen, contradicting this
change's own "kill failure is surfaced, not silently dropped" requirement.

So:
- Attach: `{ type: 'attach', ticket }`, unchanged, routed through the exact
  same `applyAction` handling `watch.js` already has (`doAttach` ->
  `session.attach(ticket)`) — attach has no failure-result to lose, so
  verbatim reuse is safe here.
- Kill: the sessions controller calls `control.killConfirmed(ticket, S.runs,
  session)` itself (the exact same function `drilldown.js`'s case calls) and
  inspects the return value: on `{killed: true}` it proceeds exactly as the
  drill-down path would (clearing confirm state, letting the next discovery
  refresh reflect the now-dead window); on `{killed: false, reason}` it sets
  `S.sessionsError` to a one-line message derived from `reason`, so the
  operator sees why nothing happened, on the same screen they issued the
  kill from.
- **Confirm-state field**: a managed row's `k` still writes `S.drillConfirm`
  (not a new field) for its confirm prompt — the sessions screen's own
  `render`/`handleKey` reads `state.drillConfirm` for a managed row's confirm
  state (mirroring the drill-down's own prompt exactly) and
  `state.sessionsKillConfirm` (Decision 8) for a freelance row's. These are
  two different fields for two different row kinds, stated explicitly here
  so an implementer does not have to infer it from Decision 8 alone.

For a freelance session, there is no `ticket` and no run object, so those
actions don't apply. Two new, deliberately minimal actions are added instead:
- `attach-session` — only offered when a tmux `session:window_id` is known
  (Decision 4); runs `spawnSync('tmux', ['attach', '-t', session + ':' +
  windowId], { stdio: 'inherit' })`, the same shape `session.js`'s own
  `attach()` uses, generalised to an arbitrary session name via a new
  `session.js` export `attachTarget(sessionName, windowId)`. A session with
  no tmux ancestor is never offered attach — there is no PTY to reattach to,
  and the sessions screen renders this explicitly ("not attachable") rather
  than silently omitting the hint.
- `kill-session` — behind the same `y`-confirm convention as the drill-down's
  own kill (`confirm-action` -> a literal `y` to proceed). When a tmux
  `session:window_id` is known, kills via `tmux kill-window -t
  <session:window_id>` (a new `session.js` export `killTarget(sessionName,
  windowId)`); otherwise (no tmux ancestor) falls back to
  `process.kill(pid, 'SIGTERM')`, wrapped in try/catch (ESRCH if it already
  exited, EPERM if owned by another user — both surfaced as a one-line
  failure notice on the sessions screen, never a crash).

Alternative considered: build one generic "target" abstraction shared by
drill-down and the sessions screen from the start. Rejected as unnecessary
churn on a screen (`drilldown.js`) with its own already-shipped, tested
behavior — Decision 7 gets the reuse the ticket actually asks for (managed
sessions delegate, nothing is reimplemented for them) without touching
drill-down's own code at all.

### Decision 8 — Screen/controller/router wiring

- `lib/ui/router.js`: add `sessions: { render: sessions.render, handleKey:
  sessions.routeHandleKey }` to `SCREENS`, matching every existing entry's
  shape exactly.
- `lib/ui/app-state.js`: `mode` is an unconstrained string in `app-state.js`
  today — there is no central "allowed mode" list to add `'sessions'` to
  (corrected — skeptic design round 1, non-blocking note: an earlier draft
  of this document pointed at `PHASE_ORDER`, but that governs `run.phase` in
  `reducer.js`, an entirely different field for an entirely different
  purpose). The only real gate is `router.js`'s `SCREENS` registry
  (previous bullet). So the actual work here is adding the new
  session-local state: `sessionsData` (the last
  `discover()` result, or `null` before the first refresh),
  `sessionsSelected` (cursor index), `sessionsKillConfirm` (mirrors
  `forceStartConfirm`'s shape for the same y-confirm UX), `sessionsError` (a
  one-line message from a failed kill/attach, cleared on next refresh).
  `backToFleet()` resets all of these to their initial values, same
  discipline every other screen's own per-visit state already follows there.
- `lib/ui/screens/fleet/keys.js`: add `if (key === 'v') return { type:
  'open-sessions' };` alongside the existing `open-settings`/`open-launchpad`
  bindings (`v` chosen because it, and `w`, are the only unclaimed lowercase
  letters at the fleet screen's top level — see the letters already bound:
  `a c d f h H j k l L m n N p P q r s S t y`).
- `lib/ui/controllers/sessions.js`: the new controller, mirroring
  `controllers/settings.js`'s shape — `open()` calls `discovery.discover()`
  once synchronously and sets `S.mode = 'sessions'`; `refresh()` re-runs it;
  `moveSelection(delta)`; and, per Decision 7's revision, an explicit
  `killManagedConfirmed(ticket)` that calls `control.killConfirmed` itself
  and sets `S.sessionsError` on a `{killed: false}` result (rather than
  reusing `applyAction`'s `'kill-confirmed'` case verbatim) alongside the
  freelance-only `attachFreelance()`/`killFreelanceConfirmed()`.
- `lib/ui/watch.js`: the bounded auto-refresh from Decision 1, plus wiring
  the new actions into the existing `applyAction` dispatch, next to the
  other screens' own action handling:
  - `open-sessions`, `refresh-sessions`, `move-sessions` — screen-level, no
    ambiguity.
  - `attach` (managed row, Enter) — dispatched and handled exactly as
    `doAttach` already handles it for the drill-down; no sessions-specific
    branch.
  - `confirm-action`/`action:'kill'` (managed row, `k`) — dispatched exactly
    as the drill-down already dispatches it, writing `S.drillConfirm`, per
    Decision 7's confirm-state-field bullet.
  - `kill-session-managed` (managed row, `y` on the resulting confirm) — new,
    routes to `controllers/sessions.js`'s `killManagedConfirmed(ticket)`
    rather than the drill-down's own `'kill-confirmed'` case, so the result
    is checked and `S.sessionsError` can be set on failure (Decision 7).
  - `attach-session` / `kill-session-confirm` / `kill-session-confirmed` —
    freelance-only, new, per Decision 7's freelance bullets.

## Risks / Trade-offs

- [Risk] `/proc` reads for another user's process (EACCES) hide fields
  (cwd, exe path) but must not hide the *session itself* — an operator
  running the dashboard as a different user than a freelance session would
  otherwise see nothing at all for it. → Mitigation: every per-field read is
  independently try/caught (Decision 3); a session with an unreadable cwd
  still appears, with `cwd: null` rendered as "unknown" rather than the
  session being dropped.
- [Risk] The `mtime`-as-start-time approximation (Decision 3) can be wrong
  for a process whose `/proc/<pid>` entry was touched by something other than
  its own creation (rare on Linux, but not a documented kernel guarantee). →
  Mitigation: called out explicitly as an approximation in the module's own
  header comment and in this document; age is a UX nicety here, not
  something any acceptance criterion or gate depends on being exact.
  Non-Goals for this change explicitly exclude anything to do with cost or
  precise timing.
- [Risk] pid-ancestry walking (Decision 4) is bounded at 6 hops as a cheap
  guard against a pathological process tree; a harness nested deeper than
  that inside a tmux pane would show `tmux: null` (freelance-looking) even
  though it is, in fact, tmux-backed. → Mitigation: 6 hops covers every
  realistic shell -> harness nesting depth (shell -> harness is 1 hop;
  shell -> wrapper script -> harness is 2); documented as a bound, not a
  guarantee, same spirit as the mtime approximation above.
- [Risk] `execFileSync(..., ['--version'])` (Decision 5) could hang past its
  300ms timeout for a binary that doesn't support `--version` cleanly (opens
  a REPL, waits on stdin). → Mitigation: `timeout` + `stdio: ['ignore', ...]`
  on the probe call ensures Node kills it and the promise/call rejects into
  the catch, caching `null` rather than blocking; this is a one-time cost
  per binary path, never repeated once cached (even a `null` result is
  cached, so a broken binary is only ever probed once per dashboard run).
- [Trade-off] Discovery only refreshes while the sessions screen is open
  (Decision 1) — switching to it always shows data that is up to ~3s stale
  from a moment ago, not the instant it opens plus zero. Judged acceptable:
  the screen already does a synchronous `discover()` on open (Decision 1's
  first bullet), so the very first frame is fresh; only the auto-refresh
  cadence afterward trades freshness for poll-loop cost.

## Migration Plan

No data migration — this is a purely additive UI feature with no persisted
state format change. Existing `workflow-state.md`/`events.jsonl` shapes are
untouched. Rollback is a plain revert (no schema to unwind).

## Open Questions

None outstanding — the design choices above resolve every ambiguity the
ticket's own "Discovery — the hard part" section flagged as worth
evaluating, in the order it suggested (process enumeration first, tmux-wide
enumeration folded in as the cross-reference for tmux location, per-harness
session-file parsing explicitly deferred as the ticket's own "richer, but
per-harness and version-fragile" framing already argues for deferring it
past v1).
