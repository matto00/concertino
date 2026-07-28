'use strict';

// The poll loop. Everything stateful lives here so the reducer and the screens
// stay pure: idle tracking needs memory across polls, keyboard handling needs
// raw mode, and which screen is on top is itself state — the router only
// dispatches on it, never remembers it.

const { execFileSync } = require('child_process');
const store = require('./store');
const { reduce } = require('./reducer');
const { createSession, hasTmux } = require('./session');
const router = require('./router');
const { submitTicket } = require('./prompt');
const control = require('./control');
const linear = require('./linear');
const cache = require('./cache');
const queue = require('./queue');
const launchpadScreen = require('./screens/launchpad');
const launchplanScreen = require('./screens/launchplan');

const POLL_MS = 1000;
const IDLE_SAMPLE_MS = 2000;

// A cheap content hash. We never parse the pane — only ask "did anything
// change" — so this works identically for Claude Code, Codex, or a local model.
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function clear() {
  process.stdout.write('\x1b[2J\x1b[H');
}

// What `n` runs. Config wins; otherwise it follows the harness the project is
// already rendered for, so a fresh project needs no dashboard config at all.
function defaultLaunchCommand(config) {
  const harnesses = Array.isArray(config.harnesses) ? config.harnesses : [];
  const bin = (harnesses.includes('codex') && !harnesses.includes('claude-code'))
    ? 'codex' : 'claude';
  return bin + ' "/concertino-deliver {{TICKET}}"';
}

// One stdin chunk is not one key. In raw mode it usually is, but a paste — or
// any piped stdin, where the whole script arrives in a single read — delivers
// several at once, and an exact compare against the chunk then matches nothing.
// Split into keys so both paths run the same handler.
//
// An escape sequence must survive as ONE key: arrow keys arrive as `\x1b[A`, and
// splitting per character would deliver a bare `\x1b` — which cancels the
// prompt — followed by a literal `[A` typed into it.
function splitKeys(chunk) {
  const keys = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === '\x1b' && (chunk[i + 1] === '[' || chunk[i + 1] === 'O')) {
      let j = i + 2;
      // CSI/SS3 runs to its final byte, @ through ~.
      while (j < chunk.length && !(chunk.charCodeAt(j) >= 0x40 && chunk.charCodeAt(j) <= 0x7e)) j++;
      keys.push(chunk.slice(i, Math.min(j + 1, chunk.length)));
      i = j + 1;
    } else {
      keys.push(chunk[i]);
      i++;
    }
  }
  return keys;
}

async function watch(opts) {
  const root = opts.root;
  const cfg = (opts.config && opts.config.dashboard) || {};
  const session = createSession(cfg.tmuxSession || 'concertino');

  if (!hasTmux()) {
    console.error('concertino watch: tmux not found on PATH.');
    console.error('Install it (e.g. `pacman -S tmux`, `brew install tmux`, `apt install tmux`) and retry.');
    process.exitCode = 1;
    return;
  }

  session.ensure();

  const launchCommand = cfg.launchCommand || defaultLaunchCommand(opts.config || {});

  // ticket -> { hash, since }
  const idle = new Map();
  let runs = [];
  let selected = 0;
  let lastSample = 0;
  let running = true;

  // Every piece of screen state lives here, never in a screen module — that is
  // the whole point of the router seam (see lib/ui/router.js). `mode` picks
  // which screen is on top; the rest are the sub-states individual screens
  // read out of it.
  let mode = 'fleet';
  let prompt = null;                // null, or { value, error } while `n` is open
  let escalationTicket = null;      // which run's escalation the screen shows
  let escalationReply = null;       // null, or { value, error } while typing 't'
  let escalationNotice = null;      // a write failure ("already answered", ...)
  let drillTicket = null;           // which run the drill-down screen shows
  let drillConfirm = null;          // null, or 'kill'|'restart' awaiting a 'y'
  let drillNotice = null;           // a restart-spawn failure, surfaced on screen

  // The launch pad's own state. Deliberately NOT reset by backToFleet(): the
  // cache, the current epic/ticket selection and the sequential/parallel
  // choice all survive a trip back to the fleet and a later re-entry on `N`,
  // which is what "instant, offline browsing" (design doc, "Ticket cache")
  // actually means in practice — re-opening the launch pad mid-session must
  // not lose your in-progress selection or force a re-read of a cache that
  // has not gone stale. `launchPad` itself stays null until `N` is pressed
  // for the first time, so a session that never opens it pays nothing.
  let launchPad = null;
  // A point-in-time snapshot built fresh every time `L` is pressed (ports,
  // base commit, concurrency, harness) — unlike launchPad, this is cheap to
  // throw away and rebuild, so cancelling or confirming both null it out.
  let launchPlan = null;
  // The queue runner (lib/ui/queue.js). null whenever nothing is queued.
  //
  // Judgement call: this is IN-MEMORY ONLY, not written to disk. If the
  // dashboard is killed or crashes mid-batch, any ticket that had not yet
  // been handed to submitTicket() is silently forgotten — there is no
  // "resume the batch" on the next `concertino watch`. This is a deliberate
  // trade for this slice, not an oversight:
  //   - every run this queue HAS already launched is fully durable regardless
  //     (tmux window + .concertino/runs/<ticket>/events.jsonl survive the
  //     dashboard exactly like a run started with the single-ticket `n`
  //     prompt always has) — nothing already running is ever lost;
  //   - only the un-started TAIL of a batch (queued, not yet running) can be
  //     dropped, and only across a dashboard restart during that batch;
  //   - persisting the pending tail durably would mean reconciling a queue
  //     file against live tmux/event-log state on every restart (was a
  //     "queued" ticket launched by hand in the meantime? was it cancelled?
  //     is the cached ticket data it was queued against now stale?) — real
  //     complexity with no usage data yet on how often this actually happens.
  // If restarts-mid-batch turn out to be common, the fix is a
  // `.concertino/cache/queue.json` next to linear.json, written on every
  // queue.tick() and read back at startup — the same durable-cache pattern
  // this file already uses for tickets, just applied to pending launches.
  let queueState = null;
  let queueNotice = null;           // a queued ticket's submitTicket failure

  function currentState() {
    return {
      mode, runs, selected, prompt, escalationTicket, escalationReply, escalationNotice,
      drillTicket, drillConfirm, drillNotice, launchPad, launchPlan, queueNotice,
    };
  }

  function backToFleet() {
    mode = 'fleet';
    escalationTicket = null;
    escalationReply = null;
    escalationNotice = null;
    drillTicket = null;
    drillConfirm = null;
    drillNotice = null;
  }

  function backToLaunchPad() {
    mode = 'launchpad';
    launchPlan = null;
  }

  // Gate status + team key are re-derived from config/env each time the
  // launch pad is (re)opened rather than cached across the whole watch()
  // call — config does not change mid-session, so this is cheap, and it
  // keeps openLaunchPad() the single place that decides "enabled or not".
  function openLaunchPad() {
    if (!launchPad) {
      launchPad = {
        status: linear.launchPadStatus(opts.config || {}, process.env),
        cache: cache.read(root),
        pane: 'epics',
        epicIndex: 0,
        ticketIndex: 0,
        selected: new Set(),
        mode: 'parallel',
        refreshing: false,
        error: null,
        viewingTicket: null,
        project: (opts.config && opts.config.project && opts.config.project.name) || '',
        defaultConcurrency: cfg.maxConcurrent || 2,
      };
    }
    mode = 'launchpad';
  }

  // Fire-and-forget: sets `refreshing` synchronously (before its first
  // `await`, so the very next draw() — including the one applyAction
  // triggers immediately after this returns — already shows "fetching…"),
  // then updates the cache once the network call settles. The 1-second poll
  // timer picks up the result on its own; nothing here needs to force an
  // extra redraw.
  async function refreshLaunchPad() {
    const lp = launchPad;
    if (!lp) return;
    lp.refreshing = true;
    lp.error = null;
    try {
      const team = linear.teamKeyFromConfig(opts.config || {}, process.env);
      if (!team.key) throw new Error('no ticketProvider.teamKey configured — see config-reference.md');
      const result = await linear.fetchTickets({ teamKey: team.key });
      cache.write(root, result, Date.now());
      lp.cache = cache.read(root);
      lp.epicIndex = 0;
      lp.ticketIndex = 0;
    } catch (e) {
      lp.error = 'refresh failed: ' + String((e && e.message) || e).split('\n')[0];
    } finally {
      lp.refreshing = false;
    }
  }

  function sampleWindows(now) {
    const windows = session.listWindows();
    const takeSample = now - lastSample >= IDLE_SAMPLE_MS;
    if (takeSample) lastSample = now;

    return windows.map((w) => {
      if (!w.alive) return { ticket: w.ticket, alive: false, idleMs: null };

      let entry = idle.get(w.ticket);
      if (!entry) {
        // First sight of this window. Seeding `since` from `now` would report
        // zero idle for everything on the first poll — so a run wedged for six
        // hours reads as healthy at exactly the moment you opened the dashboard
        // to find it, and `idle 11m` would mean "you have been watching for 11
        // minutes". tmux has been tracking the window's real last activity all
        // along, so start from that; it also survives a dashboard restart.
        entry = {
          hash: null,
          since: w.activity != null ? Math.min(w.activity * 1000, now) : now,
        };
        idle.set(w.ticket, entry);
      }

      if (takeSample) {
        const h = hash(session.capture(w.ticket));
        // Only a refinement on top of the tmux seed: the first sample has no
        // previous hash to differ from, and treating that as activity would
        // throw the seed away and put us straight back at zero.
        if (entry.hash !== null && entry.hash !== h) entry.since = now;
        entry.hash = h;
      }

      return { ticket: w.ticket, alive: true, idleMs: Math.max(0, now - entry.since) };
    });
  }

  function draw() {
    const now = Date.now();

    // The queue runner advances on every poll, independent of which screen
    // is on top — a batch launched from the launch pad must keep feeding the
    // fleet whether or not the human is still looking at it. tick() decides
    // WHICH tickets to start now (see queue.js) against the FLEET SNAPSHOT
    // FROM THE PREVIOUS DRAW — this has to run before reduce() below, not
    // after: submitTicket's session.spawn is synchronous, so any window it
    // opens is already live by the time sampleWindows() looks at tmux a few
    // lines down, and the newly-launched ticket appears in THIS frame rather
    // than waiting a full extra poll to show up (the `n` prompt gets this for
    // free since its spawn happens before the draw() that follows it; the
    // queue has to earn it explicitly since its spawn happens INSIDE draw()).
    if (queueState) {
      const result = queue.tick(queueState, runs);
      for (const ticket of result.toLaunch) {
        const launched = submitTicket(ticket, result.queue.launchCommand || launchCommand, session);
        if (!launched.spawned) queueNotice = launched.error;
      }
      queueState = queue.isIdle(result.queue) ? null : result.queue;
    }

    runs = reduce(store.readAll(root), sampleWindows(now), now);
    if (selected >= runs.length) selected = Math.max(0, runs.length - 1);

    // The escalation screen tracks its run by ticket, not by a snapshot taken
    // when it was opened, so it always reflects the latest poll. If that run's
    // escalation has cleared — answered, timed out, or the run itself is gone
    // — there is nothing left to show here; fall back to the fleet rather than
    // render a dead screen. This is also what makes "the row clears" visible:
    // once `emit-event.sh --await` notices `answer.json` and logs
    // `escalation.answered`, the very next poll walks the human back out.
    if (mode === 'escalation') {
      const run = runs.find((r) => r.ticket === escalationTicket);
      if (!run || !run.escalation) backToFleet();
    }

    clear();
    // `rows` matters as much as `cols`: the screen is cleared and rewritten
    // every second, so output taller than the terminal scrolls the header and
    // NEEDS YOU off the TOP — the one thing that must always be visible.
    process.stdout.write(router.render(currentState(), {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 0,
      now,
    }) + '\n');
    return runs;
  }

  runs = draw();
  const timer = setInterval(() => { if (running) runs = draw(); }, POLL_MS);

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  await new Promise((resolve) => {
    // One way out, whether it was asked for or forced on us.
    let quitting = false;
    const quit = () => {
      quitting = true;
      clearInterval(timer);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      clear();
      resolve();
    };

    // `concertino watch < /dev/null` hits EOF before any 'data' ever fires, so
    // a quit path that only lives in the keypress handler never runs and the
    // poll loop spins forever. Same failure as the piped-newline hang, reached
    // from the other side: there, the chunk arrived and did not match; here, no
    // chunk arrives at all. A closed stdin can send no further keys, so there
    // is nothing left to wait for.
    stdin.on('end', quit);
    stdin.on('close', quit);

    // Hand the terminal to tmux, then take it back on detach — a process
    // action, independent of whichever screen is on top, so both fleet and
    // escalation route their `attach` action through this same function.
    function doAttach(ticket) {
      running = false;
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      try {
        session.attach(ticket);
      } finally {
        // If attach throws we must still hand the terminal back. Without this
        // the terminal is left in raw mode and `running` stays false, so the
        // dashboard is wedged and only a kill recovers it.
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        running = true;
      }
    }

    // Writes answer.json and reports what happened — never throws (see
    // store.writeAnswer). A confirmed write heads back to the fleet: there is
    // nothing left to do on this screen, and the row itself clears once
    // `emit-event.sh --await` notices the file and logs `escalation.answered`
    // (the dashboard deliberately does not emit that event a second time —
    // see store.js). A refusal stays on the escalation screen and is shown,
    // not swallowed — but what happens to a typed reply depends on *why* it
    // was refused. "already answered" (reason: 'answered') means this
    // decision is genuinely moot, so clearing it is correct. Any other
    // failure (reason: 'error' — a permissions/IO problem) has nothing to do
    // with what the human typed; discarding it there would make someone who
    // wrote a long free-text reply retype it after a transient failure, so
    // when there is a reply in flight, keep its value and surface the error
    // inline on that reply instead of clearing it. (An option-key answer, e.g.
    // pressing 'a' for approve, has no typed text to lose — that path has no
    // `escalationReply` at all, so the error still needs the banner.)
    function answerEscalation(ticket, value) {
      const result = store.writeAnswer(root, ticket, value);
      if (result.ok) {
        backToFleet();
      } else if (result.reason === 'answered') {
        escalationReply = null;
        escalationNotice = result.error;
      } else if (escalationReply) {
        escalationReply.error = result.error;
      } else {
        escalationNotice = result.error;
      }
    }

    // Interprets an action returned by a screen's (pure) handleKey. Screens
    // never mutate state themselves — this is the one place state changes,
    // which is what keeps every screen testable as (state, opts) -> string.
    function applyAction(action) {
      if (!action) return false;
      switch (action.type) {
        case 'move':
          selected = Math.max(0, Math.min(selected + action.delta, runs.length - 1));
          return true;

        case 'open-prompt':
          prompt = { value: '', error: null };
          return true;

        case 'cancel-prompt':
          prompt = null;
          return true;

        case 'prompt-backspace':
          prompt.value = prompt.value.slice(0, -1);
          return true;

        case 'prompt-type':
          // Stale error text from a previous failed submit must not linger
          // once the user starts correcting their input.
          prompt.value += action.char;
          prompt.error = null;
          return true;

        case 'submit-prompt': {
          // submitTicket validates the ticket shape before it ever reaches
          // session.spawn — see lib/ui/ticket.js for why that matters — then
          // attempts the spawn. Either way, a failure is reported on the
          // prompt and left open rather than taking the dashboard down.
          const result = submitTicket(action.value, launchCommand, session);
          if (result.spawned) prompt = null;
          else prompt.error = result.error;
          return true;
        }

        case 'open-escalation':
          mode = 'escalation';
          escalationTicket = action.ticket;
          escalationReply = null;
          escalationNotice = null;
          return true;

        case 'back':
          backToFleet();
          return true;

        case 'open-reply':
          escalationReply = { value: '', error: null };
          return true;

        case 'cancel-reply':
          escalationReply = null;
          return true;

        case 'reply-backspace':
          escalationReply.value = escalationReply.value.slice(0, -1);
          return true;

        case 'reply-type':
          escalationReply.value += action.char;
          escalationReply.error = null;
          return true;

        case 'submit-reply':
          answerEscalation(action.ticket, action.value);
          return true;

        case 'answer':
          answerEscalation(action.ticket, action.value);
          return true;

        case 'open-drilldown':
          mode = 'drilldown';
          drillTicket = action.ticket;
          drillConfirm = null;
          drillNotice = null;
          return true;

        case 'confirm-action':
          drillConfirm = action.action;
          return true;

        case 'cancel-confirm':
          drillConfirm = null;
          return true;

        // Process actions — go straight to tmux, no agent cooperation needed,
        // so they work even on a run with zero telemetry (see the design
        // doc's "Control plane" section). Once killed, the window dies and
        // the next poll's reducer pass reports the run as failed on its own —
        // this handler does not need to fake that transition itself.
        //
        // Both cases delegate to control.js, which re-derives the run from
        // the current `runs` (this poll's latest observation, not a stale
        // snapshot from when the confirmation opened) and refuses to act at
        // all once it is no longer live — the second of two independent
        // liveness checks (drilldown.js's handleKey is the first). Restart
        // additionally refuses before killing anything when the ticket isn't
        // spawnable, so a window the dashboard never spawned (adopted on
        // startup, fails TICKET_RE) is never destroyed without a replacement
        // being possible.
        case 'kill-confirmed':
          control.killConfirmed(action.ticket, runs, session);
          drillConfirm = null;
          drillNotice = null;
          return true;

        // Restart reuses submitTicket — the exact path the `n` prompt uses,
        // template substitution included — rather than re-deriving the launch
        // command here. A failed respawn is reported on screen, not swallowed.
        case 'restart-confirmed': {
          const result = control.restartConfirmed(action.ticket, runs, session, launchCommand, submitTicket);
          drillConfirm = null;
          drillNotice = result.spawned ? null : result.error;
          return true;
        }

        case 'attach':
          doAttach(action.ticket);
          return true;

        // --- launch pad --------------------------------------------------

        case 'open-launchpad':
          openLaunchPad();
          return true;

        case 'move-launchpad': {
          const lp = launchPad;
          if (!lp) return true;
          if (lp.pane === 'epics') {
            const total = ((lp.cache && lp.cache.epics) || []).length;
            lp.epicIndex = Math.max(0, Math.min(lp.epicIndex + action.delta, Math.max(0, total - 1)));
            lp.ticketIndex = 0; // the ticket list just changed under it
          } else {
            const total = launchpadScreen.ticketsForEpic(lp).length;
            lp.ticketIndex = Math.max(0, Math.min(lp.ticketIndex + action.delta, Math.max(0, total - 1)));
          }
          return true;
        }

        case 'switch-pane':
          if (launchPad) launchPad.pane = action.pane;
          return true;

        case 'toggle-select': {
          const lp = launchPad;
          if (!lp) return true;
          const t = launchpadScreen.ticketsForEpic(lp)[lp.ticketIndex];
          if (t) {
            if (lp.selected.has(t.identifier)) lp.selected.delete(t.identifier);
            else lp.selected.add(t.identifier);
          }
          return true;
        }

        case 'select-all': {
          const lp = launchPad;
          if (!lp) return true;
          for (const t of launchpadScreen.ticketsForEpic(lp)) lp.selected.add(t.identifier);
          return true;
        }

        case 'set-mode':
          if (launchPad) launchPad.mode = action.mode;
          return true;

        case 'refresh-launchpad':
          refreshLaunchPad(); // fire-and-forget; see its own comment
          return true;

        case 'open-ticketview': {
          const lp = launchPad;
          if (!lp) return true;
          const t = launchpadScreen.ticketsForEpic(lp)[lp.ticketIndex];
          if (t) {
            lp.viewingTicket = t.identifier;
            mode = 'ticketview';
          }
          return true;
        }

        case 'back-to-launchpad':
          backToLaunchPad();
          return true;

        // The confirm gate. Ports, base commit and the ordered ticket list
        // are all computed HERE, once, from the current config/cache/git
        // state — the plan screen itself stays pure and just renders this
        // snapshot (see launchplan.js's own header comment on why ports can
        // be shown with nothing run yet).
        case 'open-launchplan': {
          const lp = launchPad;
          if (!lp || !lp.selected.size) return true;
          const byId = new Map((lp.cache.tickets || []).map((t) => [t.identifier, t]));
          const tickets = Array.from(lp.selected).map((id) => byId.get(id)).filter(Boolean);
          if (!tickets.length) return true;

          const harnesses = (Array.isArray(opts.config && opts.config.harnesses) && opts.config.harnesses.length)
            ? opts.config.harnesses.map((h) => (h === 'claude-code' ? 'claude' : h))
            : ['claude'];
          const seqMode = lp.mode === 'sequential';
          const concurrency = seqMode ? 1 : Math.max(1, cfg.maxConcurrent || 2);

          let commitSha = null;
          try {
            // `stdio: ['ignore','pipe','ignore']` is deliberate, not
            // decoration: execFileSync's default stdio inherits the CHILD's
            // stderr straight onto this process's own stderr even when the
            // call throws and is caught here — verified by running it
            // against a non-repo directory. Silently degrading to "no commit
            // shown" must not mean leaking `fatal: not a git repository...`
            // onto the terminal underneath a screen that is otherwise pure.
            commitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
              { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          } catch (e) { /* not a git repo, or no commits yet — render without it */ }

          launchPlan = {
            tickets,
            mode: lp.mode,
            concurrency,
            harness: harnesses[0],
            harnesses,
            baseBranch: (opts.config && opts.config.project && opts.config.project.baseBranch) || 'main',
            commitSha,
            worktreeBase: (opts.config && opts.config.worktree && opts.config.worktree.base) || '.concertino/worktrees',
            // A custom launchCommand override has no per-harness variants to
            // cycle through — 'h' is simply not offered in that case (see
            // launchplan.js's handleKey, gated on harnesses.length > 1).
            launchCommand: cfg.launchCommand || (harnesses[0] + ' "/concertino-deliver {{TICKET}}"'),
            portsCfg: (opts.config && opts.config.worktree && opts.config.worktree.ports) || {},
          };
          mode = 'launchplan';
          return true;
        }

        case 'cancel-launchplan':
          backToLaunchPad();
          return true;

        case 'cycle-concurrency':
          if (launchPlan) launchPlan.concurrency = launchplanScreen.cycleConcurrency(launchPlan.concurrency);
          return true;

        case 'cycle-harness': {
          const plan = launchPlan;
          if (!plan || !plan.harnesses || plan.harnesses.length < 2) return true;
          const idx = plan.harnesses.indexOf(plan.harness);
          plan.harness = plan.harnesses[(idx + 1) % plan.harnesses.length];
          if (!cfg.launchCommand) plan.launchCommand = plan.harness + ' "/concertino-deliver {{TICKET}}"';
          return true;
        }

        // Builds the queue and hands off to it — see queue.js and the
        // `queueState` comment above for why the queue itself is not
        // durable. The first tick (which actually launches up to
        // `concurrency` tickets through submitTicket) happens in draw(),
        // called right after this returns true — not here — so there is
        // exactly one place in the whole file that calls queue.tick().
        case 'confirm-launch': {
          const plan = launchPlan;
          if (!plan || !plan.tickets.length) return true;
          queueState = queue.createQueue(
            plan.tickets.map((t) => t.identifier),
            plan.concurrency,
            plan.launchCommand,
          );
          queueNotice = null;
          launchPlan = null;
          if (launchPad) launchPad.selected = new Set();
          mode = 'fleet';
          return true;
        }

        default:
          return false;
      }
    }

    function onKey(key) {
      const action = router.handleKey(key, currentState());
      if (action && action.type === 'quit') { quit(); return; }
      if (applyAction(action)) runs = draw();
    }

    stdin.on('data', (raw) => {
      // One chunk is not one key. In raw mode it usually is, but a paste — and
      // any piped stdin, where a whole script arrives in a single read —
      // delivers several at once, and an exact compare against the chunk then
      // matches nothing. Piped stdin also appends a trailing newline (`echo q`
      // sends "q\n"), which used to leave the loop polling forever; strip it
      // when we are not a TTY, then dispatch key by key.
      const chunk = stdin.isTTY ? raw : raw.replace(/[\r\n]+$/, '');
      for (const key of splitKeys(chunk)) {
        // quit() has torn the screen down, but the rest of this chunk is
        // already in hand. Delivering it would type into a dead dashboard.
        if (quitting) return;
        onKey(key);
      }
    });
  });
}

module.exports = { watch };
