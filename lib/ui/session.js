'use strict';

// tmux is the session backend. Two properties earn the dependency:
//   1. runs survive the TUI crashing, the ssh session dropping, and the lid
//      closing — which is the whole point of an unattended overnight fleet;
//   2. `attach` is free and perfect, so we never re-render a harness's own UI.

const { execFileSync, spawnSync } = require('child_process');

const PLACEHOLDER = '__concertino__';

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
  const target = (ticket) => name + ':' + ticket;

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

    listWindows() {
      let out;
      try {
        out = tmux(['list-windows', '-t', name, '-F', '#{window_name}\t#{pane_dead}']);
      } catch (e) {
        return [];
      }
      return out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [ticket, dead] = line.split('\t');
          return { ticket, alive: dead !== '1' };
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

    spawn(ticket, cmd) {
      this.ensure();
      tmux(['new-window', '-d', '-t', name, '-n', ticket, cmd]);
      // remain-on-exit is a window option: setting it at the session level
      // (via set-option -t <session>) only affects the window that happened
      // to be active at the time, not windows created afterward. It must be
      // set on each window individually so a finished run's window stays
      // listed as a dead pane instead of vanishing — that is what lets the
      // reducer distinguish "exited without run.end" from "never existed".
      try { tmux(['set-window-option', '-t', target(ticket), 'remain-on-exit', 'on']); } catch (e) {}
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
