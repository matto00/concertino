'use strict';

// The poll loop. Everything stateful lives here so the reducer and the screens
// stay pure: idle tracking needs memory across polls, and keyboard handling
// needs raw mode.

const store = require('./store');
const { reduce } = require('./reducer');
const { createSession, hasTmux } = require('./session');
const { renderFleet } = require('./screens/fleet');
const { submitTicket } = require('./prompt');

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
  let selected = 0;
  let lastSample = 0;
  let running = true;
  // null when not prompting; { value, error } while the `n` prompt is open.
  let prompt = null;

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
      prompt,
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

    // Typing into the `n` prompt. Returns true when the screen needs a redraw.
    function promptKey(key) {
      // Arrow keys and friends are multi-byte escape sequences: ignore them
      // outright. Only a BARE escape cancels, or every ↑ would close the prompt
      // and leave `[A` behind.
      if (key.length > 1) return false;
      if (key === '\x1b') { prompt = null; return true; }
      if (key === '\x7f' || key === '\b') { prompt.value = prompt.value.slice(0, -1); return true; }
      if (key === '\r' || key === '\n') {
        const ticket = prompt.value.trim();
        if (!ticket) { prompt = null; return true; }        // empty submit = cancel
        // submitTicket validates the ticket shape before it ever reaches
        // session.spawn — see lib/ui/ticket.js for why that matters — then
        // attempts the spawn. Either way, a failure is reported on the
        // prompt and left open rather than taking the dashboard down.
        const result = submitTicket(ticket, launchCommand, session);
        if (result.spawned) {
          prompt = null;
        } else {
          prompt.error = result.error;
        }
        return true;
      }
      if (key >= ' ') { prompt.value += key; return true; }  // printable
      return false;
    }

    function onKey(key) {
      if (prompt) {
        if (promptKey(key)) runs = draw();
        return;
      }
      if (key === 'n') { prompt = { value: '', error: null }; runs = draw(); return; }

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
