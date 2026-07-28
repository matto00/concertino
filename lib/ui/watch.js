'use strict';

// The poll loop. Everything stateful lives here so the reducer and the screens
// stay pure: idle tracking needs memory across polls, and keyboard handling
// needs raw mode.

const store = require('./store');
const { reduce } = require('./reducer');
const { createSession, hasTmux } = require('./session');
const { renderFleet } = require('./screens/fleet');

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

  // ticket -> { hash, since }
  const idle = new Map();
  let selected = 0;
  let lastSample = 0;
  let running = true;

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
    const runs = reduce(store.readAll(root), sampleWindows(now), now);
    if (selected >= runs.length) selected = Math.max(0, runs.length - 1);
    clear();
    // `rows` matters as much as `cols`: the screen is cleared and rewritten
    // every second, so output taller than the terminal scrolls the header and
    // NEEDS YOU off the TOP — the one thing that must always be visible.
    process.stdout.write(renderFleet(runs, {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 0,
      selected,
    }) + '\n');
    return runs;
  }

  let runs = draw();
  const timer = setInterval(() => { if (running) runs = draw(); }, POLL_MS);

  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  await new Promise((resolve) => {
    // One way out, whether it was asked for or forced on us.
    const quit = () => {
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

    stdin.on('data', (raw) => {
      // In raw mode each keypress arrives as its own chunk, so an exact compare
      // is right. Piped stdin is different -- `echo q` delivers "q\n" -- and an
      // unmatched chunk would leave the process polling forever. Strip the
      // trailing newline when we are not a TTY so the non-interactive smoke
      // test cannot hang.
      const key = stdin.isTTY ? raw : raw.replace(/[\r\n]+$/, '');

      if (key === 'q' || key === '\u0003') {          // q / Ctrl-C
        quit();
        return;
      }
      // Arrow keys arrive as a three-byte escape sequence in raw mode.
      if (key === 'j' || key === '\x1b[B') { selected = Math.min(selected + 1, runs.length - 1); runs = draw(); }
      if (key === 'k' || key === '\x1b[A') { selected = Math.max(selected - 1, 0); runs = draw(); }
      if (key === '\r' && runs[selected]) {
        // Hand the terminal to tmux, then take it back on detach.
        running = false;
        if (stdin.isTTY) stdin.setRawMode(false);
        stdin.pause();
        try {
          session.attach(runs[selected].ticket);
        } finally {
          // If attach throws we must still hand the terminal back. Without this
          // the terminal is left in raw mode and `running` stays false, so the
          // dashboard is wedged and only a kill recovers it.
          if (stdin.isTTY) stdin.setRawMode(true);
          stdin.resume();
          running = true;
        }
        runs = draw();
      }
    });
  });
}

module.exports = { watch };
