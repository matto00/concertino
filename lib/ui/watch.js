'use strict';

// The poll loop. Everything stateful lives here so the reducer and the screens
// stay pure: keyboard handling needs raw mode, and which screen is on top is
// itself state — the router only dispatches on it, never remembers it. Idle
// tracking (see idleMsFromActivity below) needs no memory across polls at
// all — it is a pure function of tmux's own per-window activity timestamp,
// recomputed fresh every poll (CON-5).

const { execFileSync } = require('child_process');
const store = require('./store');
const { reduce } = require('./reducer');
const { createSession, hasTmux } = require('./session');
const router = require('./router');
const { submitTicket } = require('./prompt');
const control = require('./control');
const linear = require('./linear');
const cache = require('./cache');
const retention = require('./retention');
const queue = require('./queue');
const format = require('./format');
const launchpadScreen = require('./screens/launchpad');
const launchplanScreen = require('./screens/launchplan');
const bannerScreen = require('./banner');

const POLL_MS = 1000;

// Idle time as a pure, stateless function of tmux's own per-window
// `#{window_activity}` timestamp (epoch seconds, as returned by
// session.listWindows()) and the current poll's `now` (epoch ms). No
// per-ticket memory is needed: `window_activity` is tracked by the tmux
// server itself from pty writes, so it advances on every poll where the
// window's process has written anything — including a redraw that happens
// to reproduce byte-identical pane content (verified directly against a
// real detached tmux session; see design.md) — which is exactly the case
// the previous pane-content-hash approach misreported as idle. Falls back
// to `0` (matching the old seed path's behavior) when tmux has no activity
// timestamp yet for this window.
//
// Exported purely for tests (mirrors the buildFrame/attachAndRestore
// precedent below) — sampleWindows() itself stays a private closure.
function idleMsFromActivity(activity, now) {
  return activity != null ? Math.max(0, now - activity * 1000) : 0;
}

// Terminal-control byte sequences this module writes. Named and centralised
// here (rather than inlined at each call site) so the "textually paired"
// guarantee CON-17's design doc relies on — exactly one \x1b[?1049h at
// startup, one \x1b[?1049l in quit(), and one suspend/restore pair around
// attach — is something a test can grep for by name, and so `\x1b[2J` (the
// old full-screen clear this whole change removes) never reappears anywhere
// in this file under a different spelling.
const CURSOR_HOME = '\x1b[H';
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';

// Cursor-home + pad-to-width overwrite — never a full-screen clear
// (design.md Decision 1). The previous frame is covered character-by-
// character in the same write as the new one, so there is no window where
// the terminal shows neither frame. `text` is exactly what draw() is about
// to write, INCLUDING its own trailing '\n' — so the line count this
// function pads from and the line count it returns can never disagree about
// whether that trailing newline contributes an extra line (design.md
// Decision 2). Padding reuses format.js's own visible-column-width `padTo`,
// not a raw `.length` scheme — outer-frame lines carry ANSI SGR colour
// escapes (f.bold/f.dim/f.yellow/...) that `.length` would wrongly count as
// columns they do not occupy.
//
// Pure: no process.stdout access, which is what makes it unit-testable
// (test/watch.test.js) without a real TTY.
function buildFrame(text, cols, prevLineCount) {
  const lines = text.split('\n').map((line) => format.padTo(line, cols));
  let bytes = CURSOR_HOME + lines.join('\n');
  // A frame shorter than its predecessor leaves the rows below its own last
  // line untouched by the write above — blank them explicitly here, each
  // preceded by its own cursor position rather than relying on line-feed
  // sequencing. `\x1b[J` (erase-to-end-of-screen) was considered and
  // rejected for this (design.md Decision 2): it is exactly the same class
  // of "erase, don't overwrite" operation as `\x1b[2J`, just scoped to the
  // tail, and reopens the blank-frame window this whole change exists to
  // close for precisely the rows it touches.
  if (prevLineCount > lines.length) {
    const blank = ' '.repeat(Math.max(0, cols));
    for (let row = lines.length + 1; row <= prevLineCount; row++) {
      bytes += '\x1b[' + row + ';1H' + blank;
    }
  }
  return { bytes, lineCount: lines.length };
}

// The set of escalations the cross-screen banner (CON-25 / lib/ui/banner.js)
// can actually do something about, sorted oldest-`raisedAt`-first — deliberately
// NOT the same filter fleet.js's `needsYou` uses (`status === 'needs-you'`
// also matches a BLOCKER-verdict run with no live `run.escalation` at all,
// i.e. nothing `answer.json` could resolve). Pure and exported so it is
// testable without a real poll loop (see test/watch.test.js).
function computeLiveEscalations(runs) {
  return (runs || [])
    .filter((r) => r.escalation && !r.escalationStale)
    .slice()
    .sort((a, b) => a.escalation.raisedAt - b.escalation.raisedAt);
}

// Runs `fn`, then unconditionally runs `restore` — even if `fn` throws,
// which is then rethrown after `restore` completes. This is the exact
// try/finally shape `doAttach()` needs around handing the terminal to tmux
// (design.md Decision 4: "if attach throws we must still hand the terminal
// back"), factored out so that guarantee is unit-testable against a fake,
// throwing `fn` without a real tmux session or stdin.
function attachAndRestore(fn, restore) {
  try {
    return fn();
  } finally {
    restore();
  }
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

  // Best-effort, once, before the poll loop ever starts — a pruning failure
  // (permissions, races) must never block the dashboard from coming up.
  // Pruning never runs again on the per-second poll path (design.md
  // Decision 4); `concertino prune` is the explicit, repeatable entry point.
  try {
    retention.prune(root, opts.config || {});
  } catch (e) { /* hygiene, not a dashboard dependency */ }

  const launchCommand = cfg.launchCommand || defaultLaunchCommand(opts.config || {});

  // One cache instance for the process lifetime, passed into every poll's
  // store.readAll() call — this is what makes the per-second poll cost
  // O(bytes appended since the last poll) instead of O(total log size)
  // (design.md Decision 3).
  const eventsCache = store.createEventsCache();

  let runs = [];
  let selected = 0;
  let running = true;
  // The previous frame's line count, in the same units buildFrame() both
  // pads from and returns — see its own header comment for why this must be
  // one count, not two that could disagree (design.md Decision 2).
  let lastFrameLines = 0;

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

  // The cross-screen escalation banner's own reply sub-state (CON-25) —
  // mirrors escalationTicket/escalationReply's SHAPE but is a fully
  // independent pair, never aliased to it: the banner can be open for a
  // DIFFERENT run than whatever the dedicated escalation screen (if any) is
  // currently showing. Recomputed each poll from `runs`; see
  // computeLiveEscalations() and draw()'s own comment on why the oldest live
  // one is always what this targets.
  let globalEscalationTicket = null;
  let globalEscalationReply = null; // null, or { value, error } while typing 'g'
  // The whole set the banner could name — recomputed on every draw(); read
  // by onKey() to decide whether 'g' should do anything at all.
  let liveEscalations = [];

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
  // Set by the fleet screen's own 'request-quit' action (see fleet.js's
  // handleKey) the first time `q`/Ctrl-C is pressed while queueState still
  // has anything pending or in flight — the un-started tail of a batch would
  // otherwise be discarded by a deliberate quit exactly as silently as by a
  // crash. A second 'q' (handled while this is true) actually quits; any
  // other key clears it via 'cancel-quit' without quitting.
  let quitConfirm = false;

  function currentState() {
    return {
      mode, runs, selected, prompt, escalationTicket, escalationReply, escalationNotice,
      drillTicket, drillConfirm, drillNotice, launchPad, launchPlan, queueNotice,
      queueState, quitConfirm, globalEscalationTicket, globalEscalationReply, liveEscalations,
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

  // Gate status is computed once, the first time `launchPad` is created
  // (inside the `if (!launchPad)` below) — NOT re-derived on every later
  // re-open, since `launchPad` deliberately survives a trip back to the
  // fleet (see its own declaration above). That is safe only because
  // config/env do not change mid-session; openLaunchPad() is still the one
  // place that decides "enabled or not", it just decides it once per
  // session rather than once per keypress.
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

    // Stateless: idleMs is recomputed from tmux's own window_activity on
    // every poll, not seeded once and then refined by a pane-content hash.
    // This also survives a dashboard restart for free — window_activity is
    // tmux's state, not the dashboard's, so a fresh process reads the same
    // value a prior process would have (see idleMsFromActivity's own header
    // comment and design.md).
    return windows.map((w) => {
      if (!w.alive) return { ticket: w.ticket, alive: false, idleMs: null };
      return { ticket: w.ticket, alive: true, idleMs: idleMsFromActivity(w.activity, now) };
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
      // A pending ticket queue.tick refused to admit (it is already live —
      // see queue.js's own "dropped, not held" decision) is otherwise
      // invisible: it never reaches submitTicket, so nothing else on this
      // poll would explain why the fleet never grew by one. Set first so a
      // same-tick spawn failure (more immediately actionable) can still
      // override it below.
      if (result.dropped.length) {
        queueNotice = 'already running, skipped from queue: ' + result.dropped.join(', ');
      }
      for (const ticket of result.toLaunch) {
        const launched = submitTicket(ticket, result.queue.launchCommand || launchCommand, session);
        if (!launched.spawned) queueNotice = launched.error;
      }
      queueState = queue.isIdle(result.queue) ? null : result.queue;
    }

    runs = reduce(store.readAll(root, eventsCache), sampleWindows(now), now);
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

    // The cross-screen escalation banner (CON-25): recomputed every poll,
    // same as the fleet's own NEEDS YOU section. If the reply box is open for
    // a ticket that has dropped out of this set — answered, timed out, or the
    // run itself gone — there is no longer a live escalation to write an
    // answer against, so close it exactly as draw() already walks the
    // dedicated escalation screen back to the fleet above.
    liveEscalations = computeLiveEscalations(runs);
    if (globalEscalationReply && !liveEscalations.some((r) => r.ticket === globalEscalationTicket)) {
      globalEscalationReply = null;
      globalEscalationTicket = null;
    }

    // `rows` matters as much as `cols`: the screen is rewritten every second,
    // so output taller than the terminal scrolls the header and NEEDS YOU
    // off the TOP — the one thing that must always be visible.
    const cols = process.stdout.columns || 80;
    // Suppressed only when the screen already on top IS that exact
    // escalation — showing it there would literally duplicate what the
    // dedicated escalation screen (lib/ui/screens/escalation.js) already
    // renders (design.md Decision 6 / spec.md's "suppressed on its own
    // escalation's screen" scenario).
    const bannerText = bannerScreen.suppressedOnOwnScreen(mode, escalationTicket, liveEscalations)
      ? null
      : bannerScreen.renderBanner(liveEscalations, { cols, now, reply: globalEscalationReply });
    const bannerLines = bannerText ? bannerText.split('\n').length : 0;
    const totalRows = process.stdout.rows || 0;
    const screenRows = totalRows > 0 ? Math.max(0, totalRows - bannerLines) : 0;

    const screenText = router.render(currentState(), {
      cols,
      rows: screenRows,
      now,
    });
    const rendered = (bannerText ? bannerText + '\n' : '') + screenText + '\n';

    // Cursor-home + pad-to-width overwrite, never a full-screen clear (see
    // buildFrame's own header comment and design.md Decision 1) — and blank
    // any trailing rows left stale by a frame that shrank since the last one
    // (design.md Decision 2).
    const frame = buildFrame(rendered, cols, lastFrameLines);
    process.stdout.write(frame.bytes);
    lastFrameLines = frame.lineCount;
    return runs;
  }

  // Enter the alternate screen buffer once, before the first frame is ever
  // drawn (design.md Decision 3) — this is also what stops the dashboard
  // from trampling the user's scrollback, not just the flicker fix.
  process.stdout.write(ALT_SCREEN_ENTER);
  runs = draw();
  const timer = setInterval(() => { if (running) runs = draw(); }, POLL_MS);
  // A SIGWINCH (Node re-emits it as 'resize') triggers an immediate redraw
  // against the new dimensions rather than waiting up to POLL_MS for the
  // next scheduled tick (design.md Decision 5). draw() already reads
  // process.stdout.columns/.rows fresh on every call, so no separate
  // dimension tracking is needed beyond this listener. Gated on `running`
  // for the same reason the poll timer already is — a resize mid-attach
  // must not draw into the terminal tmux currently owns.
  process.stdout.on('resize', () => { if (running) runs = draw(); });

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  await new Promise((resolve) => {
    // One way out, whether it was asked for or forced on us.
    let quitting = false;
    const quit = () => {
      // Piped stdin fires BOTH 'end' and 'close' (confirmed against a real
      // pipe — see the probe in files-modified.md), and both are wired to
      // this same function below. Without this guard a piped quit would run
      // this body twice, double-writing \x1b[?1049l — the alternate-buffer
      // exit is specified to happen exactly once per session (design.md
      // Decision 3).
      if (quitting) return;
      quitting = true;
      clearInterval(timer);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      // Exiting the alternate buffer already restores whatever the primary
      // buffer held before the dashboard started — that IS "restore the
      // terminal as it was" (the ticket's own phrasing). The old
      // \x1b[2J\x1b[H full clear that used to sit here must NOT coexist with
      // this: issuing it after would erase the user's just-restored
      // primary-buffer content immediately after restoring it (design.md
      // Decision 3).
      process.stdout.write(ALT_SCREEN_EXIT);
      // An interactive `q` already went through fleet.js's request-quit/
      // quitConfirm warning before reaching here (see applyAction), so a
      // human choosing to quit anyway has already been told. Piped EOF
      // reaches this same function directly, with no chance to ask first —
      // that path must not silently discard the tail either, so it gets a
      // notice on stderr instead of no notice at all. One function, one
      // place this is decided, for both quit paths.
      if (queueState) {
        const remaining = queueState.pending.length + queueState.inFlight.size;
        if (remaining > 0) {
          console.error('concertino: quitting with ' + remaining +
            ' queued ticket(s) not yet started — they will not resume automatically.');
        }
      }
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
      // tmux manages the primary/alternate screen itself for the pane it
      // takes over — it does not expect to inherit an already-alternate-
      // buffer terminal from its parent, so this must exit BEFORE
      // session.attach() hands the terminal off (design.md Decision 4).
      process.stdout.write(ALT_SCREEN_EXIT);
      running = false;
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      // If attach throws we must still hand the terminal back. Without this
      // the terminal is left in raw mode and `running` stays false, so the
      // dashboard is wedged and only a kill recovers it. Re-entering the
      // alternate buffer happens in the same restore pass as the raw-mode
      // restore, for exactly the same reason (design.md Decision 4) — on
      // both the normal return path and the exception path. The try/finally
      // shape itself is factored into attachAndRestore() (below) so it is
      // unit-testable against a fake, throwing attach without a real
      // session/stdin — see test/watch.test.js.
      attachAndRestore(() => session.attach(ticket), () => {
        process.stdout.write(ALT_SCREEN_ENTER);
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        running = true;
      });
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

    // The banner's own write path (CON-25) — reuses store.writeAnswer, the
    // exact function answerEscalation() above calls, so the write side is
    // genuinely unchanged. Deliberately does NOT call backToFleet() on
    // success: the whole point of the banner is that answering it must leave
    // whatever screen you were on exactly as it was (design.md Decision 6).
    // An "already answered" race (someone else answered first, e.g. from the
    // dedicated escalation screen) is treated the same as success here — the
    // decision is moot either way, so there is nothing left for this reply
    // box to hold onto.
    function answerBannerEscalation(ticket, value) {
      const result = store.writeAnswer(root, ticket, value);
      if (result.ok || result.reason === 'answered') {
        globalEscalationReply = null;
        globalEscalationTicket = null;
      } else if (globalEscalationReply) {
        globalEscalationReply.error = result.error;
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

        // See fleet.js's handleKey — issued instead of an immediate 'quit'
        // when the queue still has something pending/in flight. Puts the
        // warning on screen; the actual quit only happens on a repeated
        // q/Ctrl-C (which fleet.js turns into a real 'quit' action).
        case 'request-quit':
          quitConfirm = true;
          return true;

        case 'cancel-quit':
          quitConfirm = false;
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

        // --- cross-screen escalation banner (CON-25) ----------------------
        // Its own action namespace — see banner.js's own header comment for
        // why these must never collide with escalation.js's bare
        // reply-type/submit-reply/... verbs above.

        case 'banner-open-reply':
          globalEscalationTicket = action.ticket;
          globalEscalationReply = { value: '', error: null };
          return true;

        case 'banner-reply-backspace':
          globalEscalationReply.value = globalEscalationReply.value.slice(0, -1);
          return true;

        case 'banner-reply-type':
          globalEscalationReply.value += action.char;
          globalEscalationReply.error = null;
          return true;

        // No backToFleet() here, unlike 'cancel-reply' — cancelling the
        // banner's reply box must leave `mode` and every other screen's
        // state exactly as it was (design.md Decision 6).
        case 'banner-cancel-reply':
          globalEscalationReply = null;
          globalEscalationTicket = null;
          return true;

        case 'banner-submit-reply':
          answerBannerEscalation(action.ticket, action.value);
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

        // A ticket the launch pad is already showing as `▲ running` may be
        // DEselected (clearing a stale selection someone made before it went
        // live is harmless) but never selected in the first place — see
        // launchpad.js's isSelectable for the tmux-addressing failure this
        // prevents. This is layer one of two (queue.tick is layer two).
        case 'toggle-select': {
          const lp = launchPad;
          if (!lp) return true;
          const t = launchpadScreen.ticketsForEpic(lp)[lp.ticketIndex];
          if (t) {
            if (lp.selected.has(t.identifier)) lp.selected.delete(t.identifier);
            else if (launchpadScreen.isSelectable(t, runs)) lp.selected.add(t.identifier);
          }
          return true;
        }

        case 'select-all': {
          const lp = launchPad;
          if (!lp) return true;
          for (const id of launchpadScreen.selectableIdentifiers(launchpadScreen.ticketsForEpic(lp), runs)) {
            lp.selected.add(id);
          }
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
          // Second refusal, not just the first: `toggle-select`/`select-all`
          // already keep an already-running ticket OUT of lp.selected, but a
          // ticket selected earlier can have started running by hand (or via
          // another queue) in the time since — re-check against the latest
          // `runs` snapshot right here, at the confirm gate's own entry point,
          // rather than trust a selection made possibly many polls ago.
          const tickets = Array.from(lp.selected)
            .map((id) => byId.get(id))
            .filter(Boolean)
            .filter((t) => launchpadScreen.isSelectable(t, runs));
          if (!tickets.length) return true;

          const configuredHarnesses = (Array.isArray(opts.config && opts.config.harnesses) && opts.config.harnesses.length)
            ? opts.config.harnesses.map((h) => (h === 'claude-code' ? 'claude' : h))
            : ['claude'];
          // A launchCommand override has no per-harness variants to cycle
          // through — the actual command is pinned regardless of which
          // harness label is showing (see cycle-harness below, which only
          // ever touches plan.launchCommand when there is NO override).
          // Pinning `harnesses` itself down to the one actually in effect,
          // right here, is what makes 'h' correctly refuse itself in BOTH
          // places that need to agree — cycle-harness's own `length < 2`
          // guard and launchplan.js's footer hint (`harnesses.length > 1`)
          // — from a single source of truth, rather than adding a second,
          // easy-to-forget override check inside cycle-harness alone.
          const harnesses = cfg.launchCommand ? [configuredHarnesses[0]] : configuredHarnesses;
          const seqMode = lp.mode === 'sequential';
          const concurrency = seqMode ? 1 : Math.max(1, cfg.maxConcurrent || 2);

          // Seeded from the config default, mirroring how `harness` seeds
          // from `config.harnesses` just above — resolved once, here, then
          // editable via 'm' exactly like harness is via 'h'. Disabled
          // (agentMergeEditable = false) under the identical condition that
          // disables harness-cycling: a custom launchCommand override has no
          // flag slot to safely rewrite (see launchplan.js's own comment).
          const agentMerge = !!(opts.config && opts.config.agentMerge && opts.config.agentMerge.enabled);
          const agentMergeEditable = !cfg.launchCommand;

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
            agentMerge,
            agentMergeEditable,
            // A custom launchCommand override has no per-harness variants to
            // cycle through — 'h' is simply not offered in that case (see
            // launchplan.js's handleKey, gated on harnesses.length > 1) — and
            // likewise no agent-merge flag slot to bake in or rewrite ('m' is
            // gated on agentMergeEditable the same way).
            launchCommand: cfg.launchCommand || launchplanScreen.withAgentMergeFlag(
              harnesses[0] + ' "/concertino-deliver {{TICKET}}"', agentMerge),
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
          // Re-applies (rather than drops) any agent-merge flag already
          // toggled onto this plan — cycling harness must not silently
          // revert an 'm' toggle made earlier in the same session.
          if (!cfg.launchCommand) {
            plan.launchCommand = launchplanScreen.withAgentMergeFlag(
              plan.harness + ' "/concertino-deliver {{TICKET}}"', plan.agentMerge);
          }
          return true;
        }

        case 'cycle-agent-merge': {
          const plan = launchPlan;
          if (!plan || !plan.agentMergeEditable) return true;
          plan.agentMerge = !plan.agentMerge;
          plan.launchCommand = launchplanScreen.withAgentMergeFlag(plan.launchCommand, plan.agentMerge);
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
          // Third and final refusal before anything reaches queue.tick:
          // the launch plan can sit on screen across many poll cycles while
          // a human reads it (same reasoning as drilldown.js's own re-check
          // on 'y') — a ticket selected and planned minutes ago can be live
          // by the time Enter is actually pressed. queue.tick (queue.js)
          // would drop it anyway on its very first tick, but filtering here
          // means it is never even reported as "dropped" — the confirm
          // screen itself is the more honest place to have refused it.
          const startable = plan.tickets.filter((t) => launchpadScreen.isSelectable(t, runs));
          const skipped = plan.tickets.filter((t) => !launchpadScreen.isSelectable(t, runs));
          if (startable.length) {
            queueState = queue.createQueue(
              startable.map((t) => t.identifier),
              plan.concurrency,
              plan.launchCommand,
            );
          }
          queueNotice = skipped.length
            ? 'already running, skipped: ' + skipped.map((t) => t.identifier).join(', ')
            : null;
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
      // The banner's reply box (CON-25), when open, owns every keystroke —
      // the same "reply box owns every keystroke while open" precedence
      // escalation.js already gives its own reply box locally, just applied
      // one level higher, BEFORE router.handleKey is ever called at all
      // (design.md Decision 6 / tasks.md task 6.5).
      if (globalEscalationReply) {
        const action = bannerScreen.handleKey(key, {
          reply: globalEscalationReply, ticket: globalEscalationTicket,
        });
        if (applyAction(action)) runs = draw();
        return;
      }
      // The reserved key opens the banner's reply box for the oldest live
      // escalation — but only when no screen-local reply/prompt already owns
      // the keyboard, so 'g' typed into the `n` prompt, a reply already open
      // on the dedicated escalation screen, or a drilldown kill/restart
      // confirmation still does what it always did.
      if (key === bannerScreen.RESERVED_KEY && liveEscalations.length &&
          !prompt && !escalationReply && !drillConfirm) {
        if (applyAction({ type: 'banner-open-reply', ticket: liveEscalations[0].ticket })) runs = draw();
        return;
      }

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

// buildFrame, attachAndRestore, computeLiveEscalations, and idleMsFromActivity
// are exported alongside watch() purely for test/watch.test.js (CON-17,
// CON-25, CON-5) — watch() itself runs an interval loop against real
// stdin/stdout, so the pure logic is what gets unit tests; watch()'s own
// runtime behavior is unchanged and still covered end to end by
// test/scripts/watch-smoke.test.sh.
module.exports = {
  watch, buildFrame, attachAndRestore, computeLiveEscalations, idleMsFromActivity,
  CURSOR_HOME, ALT_SCREEN_ENTER, ALT_SCREEN_EXIT,
};
