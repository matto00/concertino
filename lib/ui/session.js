'use strict';

// tmux is the session backend. Two properties earn the dependency:
//   1. runs survive the TUI crashing, the ssh session dropping, and the lid
//      closing — which is the whole point of an unattended overnight fleet;
//   2. `attach` is free and perfect, so we never re-render a harness's own UI.

const { execFileSync, spawnSync } = require('child_process');

const PLACEHOLDER = '__concertino__';

// Defence in depth, independent of ticket.js's TICKET_RE. Every target this
// module builds is `sessionName + ':' + ticket`, and tmux gives `:` and `.`
// special meaning inside a target (session:window.pane) — either one turns
// `ticket` into part of the address instead of a literal window name. A
// dotted ticket (e.g. `a.b_c-9`, which TICKET_RE used to accept) breaks
// addressing exactly this way and orphans a window. Validation otherwise
// lives one layer up, in prompt.js — but a future caller (slice 3's queue
// runner) could call session.spawn directly with an unvalidated string, so
// this module must not trust its inputs either.
function assertAddressable(ticket) {
  if (typeof ticket !== 'string' || ticket === '' || /[:.]/.test(ticket)) {
    throw new Error('refusing to address tmux target for unsafe ticket: ' + JSON.stringify(ticket));
  }
}

function tmux(args) {
  return execFileSync('tmux', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function hasTmux() {
  try {
    tmux(['-V']);
    return true;
  } catch (e) {
    return false;
  }
}

function createSession(name) {
  const target = (ticket) => {
    assertAddressable(ticket);
    return name + ':' + ticket;
  };

  return {
    name,

    ensure() {
      try {
        tmux(['has-session', '-t', name]);
      } catch (e) {
        // The placeholder keeps the session alive when no runs are active,
        // so window ids stay stable across an empty fleet.
        tmux(['new-session', '-d', '-s', name, '-n', PLACEHOLDER,
          'sh', '-c', 'while true; do sleep 3600; done']);
      }
    },

    // `activity` is tmux's own last-activity timestamp for the window, in epoch
    // SECONDS (null if tmux did not report one). It is what makes idle time
    // true from the dashboard's first frame and across a dashboard restart —
    // tmux has been tracking it since the window was created, whereas anything
    // the dashboard samples itself necessarily starts at zero.
    listWindows() {
      let out;
      try {
        out = tmux(['list-windows', '-t', name, '-F',
          '#{window_name}\t#{pane_dead}\t#{window_activity}']);
      } catch (e) {
        return [];
      }
      return out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [ticket, dead, activity] = line.split('\t');
          const secs = Number(activity);
          return {
            ticket,
            alive: dead !== '1',
            activity: Number.isFinite(secs) && secs > 0 ? secs : null,
          };
        })
        .filter((w) => w.ticket !== PLACEHOLDER);
    },

    capture(ticket) {
      try {
        return tmux(['capture-pane', '-p', '-t', target(ticket)]);
      } catch (e) {
        return '';
      }
    },

    // Full scrollback (`-S -`: from the start of history), unlike capture()'s
    // current-visible-pane-only snapshot. Used by reap.js to preserve a
    // window's full output before killing it — see lib/ui/reap.js and
    // design.md Decision 4 for why this is a second method rather than a
    // flag on capture(). Same error-swallowing shape: an unaddressable or
    // unknown ticket returns '', never throws.
    captureFull(ticket) {
      try {
        return tmux(['capture-pane', '-p', '-S', '-', '-t', target(ticket)]);
      } catch (e) {
        return '';
      }
    },

    spawn(ticket, cmd) {
      // Checked here, before new-window, not just inside target(): new-window
      // takes `ticket` as a literal `-n` argument, not a target, so it would
      // otherwise succeed and create the placeholder window before the
      // ambiguity was ever noticed — which is exactly how the orphan happens
      // (see the reproduction referenced above target()'s definition).
      assertAddressable(ticket);
      this.ensure();
      // A prior spawn() for this ticket can die between new-window and
      // respawn-window without ever reaching the try/catch below — the
      // dashboard process killed, the terminal closed. That leaves a holder
      // window orphaned under this ticket's name, and because tmux allows
      // duplicate window names, target(ticket) becomes ambiguous for every
      // future capture/attach/kill. Clear it by window_id (unique regardless
      // of name) before creating anything, so spawn() is idempotent no
      // matter why the previous attempt was left behind.
      let existing;
      try {
        existing = tmux(['list-windows', '-t', name, '-F', '#{window_id}\t#{window_name}']);
      } catch (e) {
        existing = '';
      }
      existing.split('\n').filter(Boolean).forEach((line) => {
        const [id, winName] = line.split('\t');
        if (winName === ticket) {
          try { tmux(['kill-window', '-t', id]); } catch (e) {}
        }
      });
      // remain-on-exit is a WINDOW option, not a session one, so it has to be
      // set per window. It also has to be set BEFORE the real command can exit:
      // creating the window with `cmd` directly and setting the option after
      // races, and a command that exits immediately — a harness that crashes on
      // startup, a missing binary, an auth failure — loses the race and the
      // window vanishes instead of staying listed as dead. That is precisely the
      // case the dead-pane behaviour exists to catch.
      //
      // So: open the window on a command that cannot exit, set the option, then
      // respawn with the real one. Measured 0 losses in 200 trials, against ~1-13%
      // for the racy ordering.
      tmux(['new-window', '-d', '-t', name, '-n', ticket, 'while :; do sleep 3600; done']);
      try {
        tmux(['set-window-option', '-t', target(ticket), 'remain-on-exit', 'on']);
        tmux(['respawn-window', '-k', '-t', target(ticket), cmd]);
      } catch (e) {
        // Never leave the holder running under this ticket's name. It would
        // outlive the dashboard, and because tmux allows duplicate window names
        // a retried spawn() would make target(ticket) ambiguous — capture, kill
        // and attach could all land on the stale holder instead of the real run.
        try { tmux(['kill-window', '-t', target(ticket)]); } catch (e2) {}
        throw e;
      }
    },

    kill(ticket) {
      try { tmux(['kill-window', '-t', target(ticket)]); } catch (e) {}
    },

    // Blocks until the user detaches. The caller must leave raw mode first.
    attach(ticket) {
      return spawnSync('tmux', ['attach', '-t', target(ticket)], { stdio: 'inherit' });
    },
  };
}

module.exports = { hasTmux, createSession, PLACEHOLDER };
