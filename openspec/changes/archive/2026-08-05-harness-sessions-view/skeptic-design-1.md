## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/harness-sessions/spec.md` in full.
- Cross-checked every concrete code reference the design makes against the
  actual source in the worktree:
  - `lib/ui/harness.js` — `cliLabel()` exists and maps `claude-code -> claude`
    as claimed (design.md Decision 2).
  - `lib/ui/ticket.js` — `TICKET_RE` exists as claimed (design.md Decision 6).
  - `lib/ui/session.js` — `createSession()`, `attach(ticket)`, `kill(ticket)`
    shapes match what Decision 7's `attachTarget`/`killTarget` are meant to
    generalise.
  - `lib/ui/router.js` — `SCREENS` registry shape matches Decision 8's plan
    for registering the `sessions` screen.
  - `lib/ui/controllers/settings.js` — confirmed as a reasonable shape
    analogue for the new `controllers/sessions.js`.
  - `lib/ui/controllers/drilldown.js` (`case 'confirm-action'`, `case
    'kill-confirmed'`) and `lib/ui/control.js` (`killConfirmed`) — read the
    actual delegation target Decision 7 proposes reusing.
  - `lib/ui/watch.js` (`applyAction`, `doAttach`, poll timer at line 754) —
    confirmed `'attach'` is handled inline and reusable from any screen, and
    that no `tickCount` variable exists yet (a small, undocumented addition
    Decision 1's every-3rd-tick auto-refresh will need — not itself a
    problem).
  - `lib/ui/app-state.js` — confirmed there is **no** central "allowed mode"
    list of any kind; `mode` is an unconstrained string, gated only by
    `router.js`'s `SCREENS` registry. `PHASE_ORDER` (grepped in
    `lib/ui/reducer.js:20`) governs `run.phase`, an entirely different field.
- Traced the acceptance criteria in `ticket.md` against `specs/harness-sessions/spec.md`'s
  requirements/scenarios one by one.
- Read `lib/ui/reducer.js`'s `emptyRun()`/`TIER2_KINDS` and
  `lib/ui/screens/drilldown.js`'s `isLive()` to check whether the "managed,
  no-telemetry" (CON-77) delegation path Decision 6/7 relies on is actually
  reachable given CON-77 already ships `run.spawn`.

### Verdict: REFUTE

### Change Requests

1. **Decision 6's cwd-based "managed" branch misclassifies a freelance
   session and Decision 7 then delegates its attach/kill to the wrong
   process — this is a safety bug, not a cosmetic one.**

   Decision 6 classifies a session as Concertino-managed via *either* (a) a
   tmux window-name match inside Concertino's own tmux session, *or* (b) cwd
   falling under a `.concertino/worktrees/<ticket>` path. Branch (b) has no
   requirement that the *specific discovered process* be the Concertino run's
   own tmux-window process — only that its cwd happens to sit inside that
   ticket's worktree. But the ticket's own motivating scenario is exactly a
   developer running "a couple of Concertino runs" *and* "an interactive
   Claude Code window someone is poking at by hand" side by side — and the
   single most likely place to poke by hand is the very worktree a
   Concertino run is already using (to check a file, run a test, etc.). That
   freelance session gets classified `managed:<ticket>` by branch (b) alone,
   with no tmux ancestry to Concertino's session at all.

   Decision 7 then dispatches, for *any* row classified managed, the exact
   ticket-scoped actions `{type:'attach',ticket}` -> `doAttach` ->
   `session.attach(ticket)` and `{type:'confirm-action',action:'kill'} ->
   {type:'kill-confirmed',ticket}` -> `control.killConfirmed(ticket, S.runs,
   session)` -> `session.kill(ticket)` (`lib/ui/session.js`'s `attach`/`kill`
   target the *canonical* `concertino:<ticket>` tmux window — not the pid the
   sessions-view row actually represents).

   Concretely: an operator sees a stray/freelance harness process in the
   sessions view (cwd-matched into a live ticket's worktree), selects it, and
   presses `k` -> `y` expecting to kill *that* process. What actually
   happens is the *live Concertino delivery run for that ticket* gets killed
   (`session.kill(ticket)` kills the `concertino:<ticket>` tmux window) while
   the freelance process the operator was actually looking at is untouched.
   This is the opposite of "actionable and not just observable" (ticket
   scope) — it is actionable against the wrong target, silently. It also
   directly undermines the ticket's own AC "The view distinguishes
   Concertino-managed sessions from freelance ones" — this branch conflates
   "cwd looks like it belongs to a ticket" with "is the ticket's own managed
   process," which are not the same claim.

   `specs/harness-sessions/spec.md`'s own "A freelance session is never
   mistaken for a managed one" scenario dodges this exact case: its GIVEN is
   "cwd is not under a Concertino worktree path," which is precisely the
   condition that does **not** trigger the bug — the scenario set never
   exercises the actual ambiguous case (freelance process, cwd under a
   worktree, no tmux ancestor to Concertino's session).

   Required revision: attach/kill for a session classified managed *only* via
   cwd (no confirmed tmux ancestry to Concertino's own session) must not
   silently delegate to the ticket-scoped `attach`/`kill-confirmed` actions,
   since those target the canonical window, not the discovered pid. Either
   (a) fold cwd matching into the tmux-ancestry check as a secondary
   confirmation rather than an independent classification OR-branch, so
   "managed" only ever means "this discovered process IS (or is the tmux
   ancestor of) the ticket's own window process," or (b) keep cwd-based
   labeling for *display* purposes but route that row's attach/kill through
   the freelance pid-based actions (`attach-session`/`kill-session`), which
   are the only actions that actually target the specific process shown.

2. **The delegated managed-kill path has no wiring to `sessionsError`, and
   drilldown's own `kill-confirmed` handler silently swallows a
   `not-live` failure — contradicting the spec's own failure-surfacing
   requirement for this screen.**

   `lib/ui/controllers/drilldown.js:171-175` (`case 'kill-confirmed'`) does:
   ```
   ctx.deps.control.killConfirmed(action.ticket, S.runs, ctx.session);
   S.drillConfirm = null;
   S.drillNotice = null;
   return true;
   ```
   — it discards `killConfirmed`'s return value entirely and always clears
   `drillNotice` to `null`, regardless of whether the kill actually happened
   (`control.killConfirmed` returns `{killed:false, reason:'not-live'}` when
   `findRun(ticket, runs)` is null or `!isLive(run)` — e.g. a worktree whose
   ticket has no live run in `S.runs` at all, which is exactly reachable
   through change request 1's cwd-only classification of a stale/completed
   ticket's worktree). Design.md Decision 7 says the sessions screen dispatch
   for a managed row is "the exact same actions the drill-down already
   dispatches today... routed through the same `applyAction` handling in
   `watch.js`" with no modification called out. That means a delegated kill
   that silently no-ops writes to `S.drillNotice` (a field the sessions
   screen never renders per Decision 8's own state list — only
   `sessionsError` is), not `S.sessionsError`. The operator gets no feedback
   at all. This directly contradicts `specs/harness-sessions/spec.md`'s own
   requirement "A kill failure is surfaced, not silently dropped" — the
   scenario there is scoped to the freelance non-tmux path, but the design
   offers no equivalent guarantee (or even acknowledgment of the gap) for the
   delegated managed path, which is exactly where change request 1's
   misclassification also lands. Required revision: either route a
   delegated-but-failed kill's signal into `sessionsError` explicitly, or
   have the sessions controller check `control.killConfirmed`'s return value
   itself rather than reusing `applyAction`'s `'kill-confirmed'` handling
   verbatim.

3. **Ambiguous confirm-state field for a managed row's `k`-then-`y` flow.**
   Decision 7 says a managed row's `k` dispatches the *literal* `{type:
   'confirm-action', action:'kill'}` (which the drilldown controller writes
   into `S.drillConfirm`), while Decision 8 separately adds
   `sessionsKillConfirm` "mirrors `forceStartConfirm`'s shape for the same
   y-confirm UX" without stating it applies only to the freelance path. As
   written, an implementer following Decision 8 in isolation could build
   `sessions.js`'s own render/handleKey to read only `sessionsKillConfirm`
   for every row — in which case a managed row's confirm prompt (driven by
   `drillConfirm`, per Decision 7) would never render, and the `y` keypress
   the sessions screen's own `handleKey` is watching for would not know to
   emit `kill-confirmed` at all. Required revision: design.md should say
   explicitly that the sessions screen's own render/handleKey read
   `state.drillConfirm` for a managed row's confirm state and
   `state.sessionsKillConfirm` for a freelance row's — two different fields
   backing what is otherwise presented as one uniform interaction — so this
   is a stated decision rather than something an implementer has to infer
   correctly from two separately-written decisions.

### Non-blocking notes

- Decision 8's app-state.js bullet says to add `mode: 'sessions'` "to the
  allowed set (in whatever central list, e.g. `PHASE_ORDER`... governs mode
  transitions)". No such list exists in `app-state.js` today — `mode` is an
  unconstrained string; the only real gate is `router.js`'s `SCREENS`
  registry (already called out separately, correctly, in the same Decision
  8). Worth tightening the prose so an implementer doesn't go looking for a
  nonexistent whitelist; the actual work in `app-state.js` is just adding the
  new session-local fields and their `backToFleet()` reset, nothing about a
  "mode allow-list."
- `/proc/<pid>/comm` is kernel-truncated to 15 bytes and, for a shebang'd
  script (many Node-based CLIs), may not always literally equal the binary
  names the recognition list expects depending on how the CLI is installed
  (a global npm shim vs. a direct executable script). None of `claude`,
  `codex`, `opencode`, `hermes`, `copilot`, `qwen` exceed 15 chars so
  truncation itself is not a problem today, but worth a one-line
  acknowledgment in design.md's Decision 3 given it is the single mechanism
  every other decision builds on — not blocking since "best-effort,
  degrades to invisible" is already the accepted failure mode.
