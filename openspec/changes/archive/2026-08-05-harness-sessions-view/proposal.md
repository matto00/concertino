## Why

The dashboard only ever models a Concertino delivery run — a ticket id backed
by `.concertino/runs/<TICKET>/events.jsonl`. A working session usually has
several harness processes alive at once (a couple of Concertino runs, an
interactive `claude`/`codex`/`opencode` window someone is poking at by hand),
and only the first category is visible today. "What is running right now,
and what is it costing me" cannot be answered from the dashboard — the exact
question CON-77 exposed, where a launched-but-not-reporting run was
indistinguishable from a launch that never happened.

## What Changes

- Add a **sessions** view: a second, lower-level lens beside the run-centric
  fleet, opened from the fleet screen (`v`) and closed back to it (`Escape`).
- Add a discovery module (`lib/ui/discovery.js`) that enumerates live harness
  processes via `/proc` (matched against each project's configured
  `harnesses` plus a small recognised-extras list — `hermes`, `copilot`,
  `qwen`), cross-references them against tmux's full window list (not just
  Concertino's own tmux session) to attach a `session:window` label where one
  exists, and classifies each session as Concertino-managed (tied to a live
  ticket, by tmux window name or worktree cwd) or freelance.
- Per session, surface what can be established cheaply and truthfully:
  harness, best-effort version (probed once per resolved binary path and
  cached for the dashboard process's lifetime, never per-poll), cwd/repo,
  tmux location when any, age, and Concertino-managed vs. freelance
  (with ticket id when managed).
- Attach/kill from the sessions view: a Concertino-managed session delegates
  to the exact same attach/kill actions the drill-down already issues today
  (no parallel implementation); a freelance tmux-backed session gets a
  minimal tmux attach/kill of its own; a freelance non-tmux process can only
  be killed (`SIGTERM`), never attached (no PTY to reattach to).
- Discovery runs only while the sessions screen is open (entering the screen,
  a bounded auto-refresh cadence while it stays open, and a manual `r`
  refresh) — never on the fleet's own per-second poll tick — and every
  discovery step is wrapped so a missing source (non-Linux, no tmux, a
  permission-denied `/proc/<pid>` read) degrades to an empty/partial result
  rather than throwing or blocking.

## Capabilities

### New Capabilities

- `harness-sessions`: process/tmux discovery of harness sessions (Concertino-managed and freelance), the sessions screen and its controller, and the router/key wiring that opens it from the fleet.

### Modified Capabilities

(none — no existing capability's requirements change; the fleet screen gains
a new key binding but its own existing requirements are unaffected)

## Impact

- New files: `lib/ui/discovery.js`, `lib/ui/screens/sessions.js`,
  `lib/ui/controllers/sessions.js`, plus their tests.
- Modified files: `lib/ui/router.js` (register the `sessions` screen mode),
  `lib/ui/app-state.js` (add `mode: 'sessions'` support and its own session
  state), `lib/ui/screens/fleet/keys.js` (add the `v` key), `lib/ui/watch.js`
  (wire the bounded refresh into the poll loop, gated on `S.mode ===
  'sessions'`), `lib/ui/session.js` (a small generalised attach/kill helper
  for a `session:window` pair outside Concertino's own tmux session).
- No changes to any delivery-workflow role file, no changes to telemetry
  wire shape, no changes to any existing spec's requirements.
