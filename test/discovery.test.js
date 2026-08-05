'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const discovery = require('../lib/ui/discovery');

// Every scenario here injects fakes for fs/execFileSync/tmux (design.md's
// own "inject fakes ... rather than depending on the real /proc or a real
// tmux server" — task 1.7) rather than touching a real /proc or a real tmux
// server, so these tests run identically on any machine/CI.

// procs: { [pid]: { comm, cwd, cmdline: [tokens], exe, mtime, ppid } }.
// Any field left `undefined` simulates that per-pid read being unreadable
// (EACCES/ENOENT) — discovery.js must degrade that ONE field, not drop the
// whole session (design.md Decision 3).
function makeFakeFs(procs) {
  return {
    readdirSync(p) {
      if (p !== '/proc') throw new Error('unexpected readdirSync ' + p);
      return Object.keys(procs);
    },
    readFileSync(p) {
      const m = /^\/proc\/(\d+)\/(comm|cmdline|stat)$/.exec(p);
      if (!m) throw new Error('unexpected readFileSync ' + p);
      const [, pid, kind] = m;
      const proc = procs[pid];
      if (!proc) throw new Error('ENOENT: ' + p);
      if (kind === 'comm') {
        if (proc.comm === undefined) throw new Error('EACCES: ' + p);
        return proc.comm + '\n';
      }
      if (kind === 'cmdline') {
        if (proc.cmdline === undefined) throw new Error('EACCES: ' + p);
        return proc.cmdline.length ? proc.cmdline.join('\u0000') + '\u0000' : '';
      }
      // 'stat': pid (comm) state ppid ...zeros — only the ppid field
      // (index 1 after the closing paren) is ever read.
      if (proc.ppid === undefined) throw new Error('EACCES: ' + p);
      return pid + ' (' + (proc.comm || 'x') + ') S ' + proc.ppid + ' ' + '0 '.repeat(40).trim();
    },
    readlinkSync(p) {
      const m = /^\/proc\/(\d+)\/(cwd|exe)$/.exec(p);
      if (!m) throw new Error('unexpected readlinkSync ' + p);
      const [, pid, kind] = m;
      const proc = procs[pid];
      if (!proc) throw new Error('ENOENT: ' + p);
      const val = kind === 'cwd' ? proc.cwd : proc.exe;
      if (val === undefined) throw new Error('EACCES: ' + p);
      return val;
    },
    statSync(p) {
      const m = /^\/proc\/(\d+)$/.exec(p);
      if (!m) throw new Error('unexpected statSync ' + p);
      const proc = procs[m[1]];
      if (!proc || proc.mtime === undefined) throw new Error('ENOENT: ' + p);
      return { mtime: proc.mtime };
    },
  };
}

// tmuxRows: array of "session\twindow\twindowId\tpanePid\tdead" lines (or
// null to simulate "no tmux on PATH" / no server running).
// versions: { [binaryPath]: string | Error } — string resolves the probe;
// an Error instance makes execFileSync throw (a failed/timed-out probe).
function makeFakeExec(tmuxRows, versions, calls) {
  return (file, args) => {
    if (file === 'tmux') {
      if (tmuxRows == null) throw new Error('tmux: command not found');
      return tmuxRows.join('\n') + (tmuxRows.length ? '\n' : '');
    }
    calls.push(file);
    const v = versions && versions[file];
    if (v instanceof Error) throw v;
    if (typeof v === 'string') return v;
    throw new Error('unexpected version probe for ' + file);
  };
}

test('RECOGNISED_EXTRA_BINARIES matches the ticket\'s own examples', () => {
  assert.deepEqual(discovery.RECOGNISED_EXTRA_BINARIES, ['hermes', 'copilot', 'qwen']);
});

test('a freelance claude session is discovered with its pid and cwd', () => {
  const fs = makeFakeFs({
    501: { comm: 'claude', cwd: '/home/dev/some-project', cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 1 },
  });
  const exec = makeFakeExec([], { '/usr/bin/claude': '1.2.3' }, []);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out.length, 1);
  assert.equal(out[0].pid, 501);
  assert.equal(out[0].cwd, '/home/dev/some-project');
  assert.equal(out[0].managed, false);
  assert.equal(out[0].ticket, null);
});

test('an unreadable cwd never drops the session — it appears with cwd: null', () => {
  const fs = makeFakeFs({
    502: { comm: 'codex', cwd: undefined, cmdline: ['codex'], exe: '/usr/bin/codex', mtime: new Date(1000), ppid: 1 },
  });
  const exec = makeFakeExec([], { '/usr/bin/codex': '0.9.0' }, []);
  const out = discovery.discover({ config: { harnesses: ['codex'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out.length, 1);
  assert.equal(out[0].cwd, null);
});

test('a process not matching any configured harness or recognised extra is not discovered', () => {
  const fs = makeFakeFs({
    503: { comm: 'bash', cwd: '/home/dev', cmdline: ['bash'], exe: '/usr/bin/bash', mtime: new Date(1000), ppid: 1 },
  });
  const exec = makeFakeExec([], {}, []);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out.length, 0);
});

test('a recognised extra binary (hermes) is discovered even with no configured harnesses matching it', () => {
  const fs = makeFakeFs({
    504: { comm: 'hermes', cwd: '/home/dev', cmdline: ['hermes'], exe: '/usr/bin/hermes', mtime: new Date(1000), ppid: 1 },
  });
  const exec = makeFakeExec([], { '/usr/bin/hermes': '2.0.0' }, []);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out.length, 1);
  assert.equal(out[0].harness, 'hermes');
});

// --- tmux cross-reference ---------------------------------------------------

test('a session inside an unrelated tmux window is labelled with the real session/window', () => {
  const fs = makeFakeFs({
    600: { comm: 'claude', cwd: '/home/dev/x', cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 1 },
  });
  const tmuxRows = ['someone-else\tscratch\t@3\t600\t0'];
  const exec = makeFakeExec(tmuxRows, { '/usr/bin/claude': '1.0.0' }, []);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].tmux, { session: 'someone-else', window: 'scratch', windowId: '@3' });
  assert.equal(out[0].managed, false, 'a non-Concertino tmux session is still freelance');
});

test('a session started outside tmux entirely has no tmux location', () => {
  const fs = makeFakeFs({
    601: { comm: 'codex', cwd: '/home/dev/x', cmdline: ['codex'], exe: '/usr/bin/codex', mtime: new Date(1000), ppid: 1 },
  });
  const exec = makeFakeExec([], { '/usr/bin/codex': '0.1.0' }, []);
  const out = discovery.discover({ config: { harnesses: ['codex'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out[0].tmux, null);
});

test('tmux ancestry is walked through an intermediate shell (2 hops)', () => {
  // 700 (the harness) -> parent 650 (a wrapper shell, IS the pane's own pid)
  const fs = makeFakeFs({
    700: { comm: 'claude', cwd: '/home/dev/x', cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 650 },
    650: { comm: 'sh', ppid: 1 },
  });
  const tmuxRows = ['concertino\tCON-90\t@7\t650\t0'];
  const exec = makeFakeExec(tmuxRows, { '/usr/bin/claude': '1.0.0' }, []);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.deepEqual(out[0].tmux, { session: 'concertino', window: 'CON-90', windowId: '@7' });
});

// --- classification (design.md Decision 6, revised) -------------------------

test('a Concertino-launched window with no telemetry is still classified as managed', () => {
  const fs = makeFakeFs({
    800: { comm: 'claude', cwd: '/some/worktree', cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 1 },
  });
  const tmuxRows = ['concertino\tCON-90\t@1\t800\t0'];
  const exec = makeFakeExec(tmuxRows, { '/usr/bin/claude': '1.0.0' }, []);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out[0].managed, true);
  assert.equal(out[0].ticket, 'CON-90');
});

test('a freelance session is never mistaken for a managed one regardless of its cwd', () => {
  const fs = makeFakeFs({
    801: {
      comm: 'claude', cwd: '/home/dev/.concertino/worktrees/feature/harness-sessions-view/CON-90',
      cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 1,
    },
  });
  const exec = makeFakeExec([], { '/usr/bin/claude': '1.0.0' }, []);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out[0].managed, false);
  assert.equal(out[0].ticket, null);
  assert.equal(out[0].nearTicket, 'CON-90', 'cwd is still surfaced as a display-only hint');
});

test('a window name that does not look like a ticket is not managed even inside Concertino\'s own session', () => {
  const fs = makeFakeFs({
    802: { comm: 'claude', cwd: '/x', cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 1 },
  });
  const tmuxRows = ['concertino\t__concertino__\t@0\t802\t0'];
  const exec = makeFakeExec(tmuxRows, { '/usr/bin/claude': '1.0.0' }, []);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out[0].managed, false);
});

// --- version probing (design.md Decision 5) ---------------------------------

test('version is shown for a successfully probed binary, and a second session on the same path reuses it', () => {
  discovery.__resetVersionCacheForTests();
  const fs = makeFakeFs({
    900: { comm: 'claude', cwd: '/a', cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 1 },
    901: { comm: 'claude', cwd: '/b', cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 1 },
  });
  const calls = [];
  const exec = makeFakeExec([], { '/usr/bin/claude': '1.2.3' }, calls);
  const out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out[0].version, '1.2.3');
  assert.equal(out[1].version, '1.2.3');
  assert.deepEqual(calls, ['/usr/bin/claude'], 'the binary must be probed exactly once for two sessions on the same path');
});

test('a failed probe is cached as unknown, and never retried for the same binary path', () => {
  discovery.__resetVersionCacheForTests();
  const fs = makeFakeFs({
    902: { comm: 'codex', cwd: '/a', cmdline: ['codex'], exe: '/usr/bin/codex', mtime: new Date(1000), ppid: 1 },
  });
  const calls = [];
  const exec = makeFakeExec([], { '/usr/bin/codex': new Error('ETIMEDOUT') }, calls);
  const out1 = discovery.discover({ config: { harnesses: ['codex'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec });
  assert.equal(out1[0].version, null);
  assert.equal(calls.length, 1);

  // A second discover() pass with another session on the same path.
  const fs2 = makeFakeFs({
    903: { comm: 'codex', cwd: '/b', cmdline: ['codex'], exe: '/usr/bin/codex', mtime: new Date(1000), ppid: 1 },
  });
  const out2 = discovery.discover({ config: { harnesses: ['codex'] }, sessionName: 'concertino', now: 5000, fs: fs2, execFileSync: exec });
  assert.equal(out2[0].version, null);
  assert.equal(calls.length, 1, 'the failed probe must not be retried on a later poll');
});

// --- never throws (design.md's own acceptance criterion) --------------------

test('discover() never throws when /proc is unavailable', () => {
  const fs = {
    readdirSync() { throw new Error('ENOENT: /proc'); },
    readFileSync() { throw new Error('should not be called'); },
    readlinkSync() { throw new Error('should not be called'); },
    statSync() { throw new Error('should not be called'); },
  };
  const exec = makeFakeExec([], {}, []);
  assert.doesNotThrow(() => discovery.discover({ config: {}, sessionName: 'concertino', fs, execFileSync: exec }));
  assert.deepEqual(discovery.discover({ config: {}, sessionName: 'concertino', fs, execFileSync: exec }), []);
});

test('discover() never throws when tmux is not installed, and still returns the sessions it could find', () => {
  const fs = makeFakeFs({
    904: { comm: 'claude', cwd: '/a', cmdline: ['claude'], exe: '/usr/bin/claude', mtime: new Date(1000), ppid: 1 },
  });
  const exec = makeFakeExec(null, { '/usr/bin/claude': '1.0.0' }, []);
  let out;
  assert.doesNotThrow(() => { out = discovery.discover({ config: { harnesses: ['claude-code'] }, sessionName: 'concertino', now: 5000, fs, execFileSync: exec }); });
  assert.equal(out.length, 1);
  assert.equal(out[0].tmux, null);
});

test('configuredBinaries maps a configured harness through cliLabel and always includes the extras', () => {
  const bins = discovery.configuredBinaries({ harnesses: ['claude-code', 'codex'] });
  assert.ok(bins.has('claude'), 'claude-code maps to the CLI binary label "claude"');
  assert.ok(bins.has('codex'));
  assert.ok(bins.has('hermes'));
  assert.ok(bins.has('copilot'));
  assert.ok(bins.has('qwen'));
});

test('nearTicketHint reads the trailing worktree path segment as the ticket id', () => {
  assert.equal(discovery.nearTicketHint('/home/dev/repo/.concertino/worktrees/feature/x/CON-78'), 'CON-78');
  assert.equal(discovery.nearTicketHint('/home/dev/repo/.concertino/worktrees/bug/y/HEL-5'), 'HEL-5');
  assert.equal(discovery.nearTicketHint('/home/dev/some-other-project'), null);
  assert.equal(discovery.nearTicketHint(null), null);
});
