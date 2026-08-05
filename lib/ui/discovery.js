'use strict';

// CON-78: harness-session discovery — the lower-level lens beside the
// run-centric fleet. Enumerates live harness processes system-wide (not just
// inside Concertino's own tmux session), cross-references them against
// tmux's full window list, probes a best-effort version, and classifies each
// as Concertino-managed or freelance. See design.md's own Decisions 1-6 for
// the reasoning behind every mechanism below; this header only orients.
//
// Every discovery step is independently error-handled (design.md's own
// "never blocks or slows the poll loop" acceptance criterion) — a missing
// `/proc`, a permission-denied per-pid read, or no `tmux` on PATH degrades to
// an empty/partial result, never a throw. `discover(opts)` is the single
// entry point every caller (the sessions controller, and its tests) uses.
//
// AGE is approximated from `/proc/<pid>`'s own mtime (the directory is
// created at fork/exec and never subsequently modified on Linux) — a
// documented approximation, not a claim of exactness (design.md Decision 3).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const harnessCmd = require('./harness');
const { TICKET_RE } = require('./ticket');

// design.md Decision 2: recognised binaries beyond the project's own
// configured `harnesses` — the ticket's own examples. One place to extend
// later, not scattered across this module. Every name here (and every CLI
// binary `harnessCmd.cliLabel()` can produce) must stay within `/proc/<pid>/
// comm`'s 15-byte kernel truncation limit — see design.md Decision 3's own
// caveat.
const RECOGNISED_EXTRA_BINARIES = ['hermes', 'copilot', 'qwen'];

// Bounded pid-ancestry walk (design.md Decision 4) — a cheap guard against a
// pathological process tree. A harness nested deeper than this inside a tmux
// pane shows `tmux: null` rather than walking forever.
const MAX_ANCESTOR_HOPS = 6;

// The version-probe cache — module-level, so it lives for the dashboard
// process's own lifetime (design.md Decision 5), not per-call and not
// per-poll. Keyed by resolved absolute binary path; a `null` value (a failed
// or timed-out probe) is cached exactly like a successful one, so a broken
// binary is only ever probed once per dashboard run.
const versionCache = new Map();

function configuredBinaries(config) {
  const harnesses = (config && Array.isArray(config.harnesses)) ? config.harnesses : [];
  const fromConfig = harnesses.map((h) => harnessCmd.cliLabel(h));
  return new Set(fromConfig.concat(RECOGNISED_EXTRA_BINARIES));
}

// design.md Decision 6 (revised): a freelance session's cwd sitting under a
// live ticket's worktree is display-only context — never sufficient for the
// managed classification. Mirrors the actual on-disk shape
// (`.concertino/worktrees/<type>/<name>/<TICKET>`) — the trailing path
// segment is the ticket id when this is a Concertino worktree cwd at all.
function nearTicketHint(cwd) {
  if (!cwd || cwd.indexOf('.concertino' + path.sep + 'worktrees' + path.sep) === -1) return null;
  const last = path.basename(cwd);
  return TICKET_RE.test(last) ? last : null;
}

// Every per-pid read is independently try/caught (design.md Decision 3) — a
// pid that exits between readdir and readFile, or one this user cannot read,
// is silently skipped, never a crash; an unreadable FIELD (cwd, exe) still
// leaves the session itself in the result, with that field `null`.
function enumerateProcesses(fsImpl, config, now) {
  const binaries = configuredBinaries(config);
  let entries;
  try {
    entries = fsImpl.readdirSync('/proc');
  } catch (e) {
    return [];
  }

  const out = [];
  for (const entry of entries) {
    if (!/^[0-9]+$/.test(entry)) continue;
    const pid = parseInt(entry, 10);

    let comm;
    try {
      comm = fsImpl.readFileSync('/proc/' + pid + '/comm', 'utf8').trim();
    } catch (e) {
      continue; // gone between readdir and readFile, or unreadable — skip
    }
    if (!binaries.has(comm)) continue;

    let cwd = null;
    try { cwd = fsImpl.readlinkSync('/proc/' + pid + '/cwd'); } catch (e) { cwd = null; }

    let ageMs = null;
    try {
      const st = fsImpl.statSync('/proc/' + pid);
      ageMs = Math.max(0, now - st.mtime.getTime());
    } catch (e) { ageMs = null; }

    let cmdlineTokens = [];
    try {
      const raw = fsImpl.readFileSync('/proc/' + pid + '/cmdline', 'utf8');
      cmdlineTokens = raw.split('\u0000').filter(Boolean);
    } catch (e) { cmdlineTokens = []; }

    let exePath = null;
    try { exePath = fsImpl.readlinkSync('/proc/' + pid + '/exe'); } catch (e) { exePath = null; }
    // design.md Decision 3: /proc/<pid>/exe is the preferred resolved path;
    // the first cmdline token is the fallback when it isn't readable.
    const binaryPath = exePath || cmdlineTokens[0] || null;

    out.push({ pid, harness: comm, cwd, ageMs, binaryPath });
  }
  return out;
}

// design.md Decision 4: tmux-wide (`-a`), not just Concertino's own session.
function listTmuxPanes(execImpl) {
  let out;
  try {
    out = execImpl('tmux', ['list-panes', '-a', '-F',
      '#{session_name}\t#{window_name}\t#{window_id}\t#{pane_pid}\t#{pane_dead}'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return []; // tmux not installed, or no server running — an empty result, never a throw
  }
  return String(out).split('\n').filter(Boolean).map((line) => {
    const [session, windowName, windowId, panePidStr, dead] = line.split('\t');
    const panePid = parseInt(panePidStr, 10);
    return {
      session, window: windowName, windowId,
      panePid: Number.isFinite(panePid) ? panePid : null,
      dead: dead === '1',
    };
  });
}

function buildPaneIndex(panes) {
  const map = new Map();
  for (const p of panes) {
    if (p.panePid != null) map.set(p.panePid, p);
  }
  return map;
}

// /proc/<pid>/stat's 4th field is ppid — but the 2nd field (comm, in
// parens) can itself contain spaces or parens, so this has to split from the
// LAST ')' rather than by naive whitespace splitting (the standard technique
// for parsing this file safely).
function readPpid(fsImpl, pid) {
  const raw = fsImpl.readFileSync('/proc/' + pid + '/stat', 'utf8');
  const closeParen = raw.lastIndexOf(')');
  if (closeParen === -1) return null;
  const rest = raw.slice(closeParen + 1).trim().split(/\s+/);
  const ppid = parseInt(rest[1], 10); // rest[0] = state, rest[1] = ppid
  return Number.isFinite(ppid) ? ppid : null;
}

// design.md Decision 4: walks up to MAX_ANCESTOR_HOPS ancestors (including
// the pid itself, at hop 0) looking for a match against the pane-pid set. No
// match within the bound reports `tmux: null` — a documented bound, not a
// guarantee (design.md's own "Risks" note).
function findTmuxAncestor(pid, paneIndex, fsImpl) {
  let current = pid;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    const pane = paneIndex.get(current);
    if (pane) return pane;
    let ppid;
    try {
      ppid = readPpid(fsImpl, current);
    } catch (e) {
      return null;
    }
    if (ppid == null || ppid <= 1) return null;
    current = ppid;
  }
  return null;
}

// design.md Decision 6 (revised): managed means ONLY "tmux-ancestry-confirmed
// as Concertino's own session, with a ticket-shaped window name" — never
// merely "looks related to a ticket" (e.g. cwd). This is the ONLY
// classification path.
function classify(tmuxMatch, sessionName) {
  if (tmuxMatch && tmuxMatch.session === sessionName && TICKET_RE.test(tmuxMatch.window)) {
    return { managed: true, ticket: tmuxMatch.window };
  }
  return { managed: false, ticket: null };
}

// design.md Decision 5: probed once per resolved binary path, cached
// (including failure) for the dashboard process's lifetime.
function resolveVersion(binaryPath, execImpl) {
  if (!binaryPath) return null;
  if (versionCache.has(binaryPath)) return versionCache.get(binaryPath);
  let version = null;
  try {
    const out = execImpl(binaryPath, ['--version'], { timeout: 300, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    version = String(out).trim() || null;
  } catch (e) {
    version = null; // missing binary, non-zero exit, or a 300ms timeout — all cache as "unknown"
  }
  versionCache.set(binaryPath, version);
  return version;
}

// The single entry point (task 1.6). `opts.fs`/`opts.execFileSync` are the
// injectable seams test/discovery.test.js uses to fake `/proc`/tmux/version
// probes without depending on a real Linux `/proc` or a real tmux server.
function discover(opts) {
  const o = opts || {};
  const fsImpl = o.fs || fs;
  const execImpl = o.execFileSync || execFileSync;
  const config = o.config || {};
  const sessionName = o.sessionName || 'concertino';
  const now = o.now || Date.now();

  let processes;
  try {
    processes = enumerateProcesses(fsImpl, config, now);
  } catch (e) {
    processes = [];
  }

  let panes;
  try {
    panes = listTmuxPanes(execImpl);
  } catch (e) {
    panes = [];
  }
  const paneIndex = buildPaneIndex(panes);

  return processes.map((proc) => {
    let tmuxMatch = null;
    try {
      tmuxMatch = findTmuxAncestor(proc.pid, paneIndex, fsImpl);
    } catch (e) {
      tmuxMatch = null;
    }

    const { managed, ticket } = classify(tmuxMatch, sessionName);
    // Display-only (design.md Decision 6, revised) — never computed for a
    // managed row, never fed back into classification or action routing.
    const nearTicket = managed ? null : nearTicketHint(proc.cwd);

    let version = null;
    try {
      version = resolveVersion(proc.binaryPath, execImpl);
    } catch (e) {
      version = null;
    }

    return {
      pid: proc.pid,
      harness: proc.harness,
      binaryPath: proc.binaryPath,
      cwd: proc.cwd,
      ageMs: proc.ageMs,
      version,
      tmux: tmuxMatch ? { session: tmuxMatch.session, window: tmuxMatch.window, windowId: tmuxMatch.windowId } : null,
      managed,
      ticket,
      nearTicket,
    };
  });
}

module.exports = {
  discover,
  RECOGNISED_EXTRA_BINARIES,
  configuredBinaries,
  nearTicketHint,
  enumerateProcesses,
  listTmuxPanes,
  findTmuxAncestor,
  classify,
  resolveVersion,
  // Test-only: the version cache is deliberately process-lifetime (design.md
  // Decision 5), which would otherwise leak across tests in the same file
  // (node:test isolates modules per FILE, not per test) — exported so
  // test/discovery.test.js can reset it between cases that need to observe a
  // fresh probe.
  __resetVersionCacheForTests: () => versionCache.clear(),
};
