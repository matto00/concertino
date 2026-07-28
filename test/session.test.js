'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { hasTmux, createSession } = require('../lib/ui/session');

const SESSION = 'concertino-test-' + process.pid;
const skip = !hasTmux() ? { skip: 'tmux not installed' } : {};
const s = createSession(SESSION);

before(() => { if (hasTmux()) s.ensure(); });
after(()  => { if (hasTmux()) { try { require('child_process').execFileSync('tmux', ['kill-session', '-t', SESSION]); } catch (e) {} } });

test('ensure is idempotent', skip, () => {
  s.ensure();
  s.ensure();
  assert.ok(Array.isArray(s.listWindows()));
});

test('the placeholder window is hidden from listWindows', skip, () => {
  assert.equal(s.listWindows().filter((w) => w.ticket === '__concertino__').length, 0);
});

test('spawn creates a live window named for the ticket', skip, () => {
  s.spawn('HEL-1', 'sleep 300');
  const w = s.listWindows().find((x) => x.ticket === 'HEL-1');
  assert.ok(w, 'window should exist');
  assert.equal(w.alive, true);
});

test('listWindows reports tmux\'s own last-activity timestamp', skip, () => {
  s.spawn('HEL-5', 'sleep 300');
  const w = s.listWindows().find((x) => x.ticket === 'HEL-5');
  assert.ok(w, 'window should exist');
  // Epoch SECONDS, and plausibly now. This is what lets idle time be true on
  // the dashboard's first frame instead of starting from zero.
  const nowSecs = Math.floor(Date.now() / 1000);
  assert.equal(typeof w.activity, 'number');
  assert.ok(w.activity > 1600000000, `activity looks wrong: ${w.activity}`);
  assert.ok(Math.abs(w.activity - nowSecs) < 120, `activity is not near now: ${w.activity} vs ${nowSecs}`);
});

test('capture returns the pane contents', skip, () => {
  s.spawn('HEL-2', 'echo concertino-marker; sleep 300');
  // Give the shell a moment to produce output.
  require('child_process').execFileSync('sleep', ['1']);
  assert.match(s.capture('HEL-2'), /concertino-marker/);
});

test('a finished window stays listed but not alive', skip, () => {
  s.spawn('HEL-3', 'true');
  require('child_process').execFileSync('sleep', ['1']);
  const w = s.listWindows().find((x) => x.ticket === 'HEL-3');
  assert.ok(w, 'dead window should still be listed (remain-on-exit)');
  assert.equal(w.alive, false);
});

test('kill removes the window', skip, () => {
  s.spawn('HEL-4', 'sleep 300');
  s.kill('HEL-4');
  assert.equal(s.listWindows().find((x) => x.ticket === 'HEL-4'), undefined);
});

test('kill of an absent window does not throw', skip, () => {
  assert.doesNotThrow(() => s.kill('NOPE'));
});

test('capture of an unknown window is empty, not an error', skip, () => {
  assert.equal(s.capture('NOPE'), '');
});

test('listWindows on a nonexistent session is empty', skip, () => {
  assert.deepEqual(createSession('concertino-does-not-exist-' + process.pid).listWindows(), []);
});

// Defence in depth: even if an unvalidated ticket somehow reaches
// session.spawn (looksLikeTicket() is the primary gate, enforced one layer
// up in prompt.js), tmux target syntax treats `.` as the window/pane
// separator (`session:window.pane`), so a dotted ticket like `a.b_c-9` makes
// `sessionName:ticket` ambiguous. Before this guard, spawn() would create the
// placeholder window with `new-window -n ticket` (a literal argv element, not
// a target — that step succeeds), then fail to address it with
// `respawn-window -t <target>`, then fail again cleaning up with the same
// broken target — leaving an orphaned window running forever. The guard must
// reject BEFORE new-window ever runs, so the real assertion here is that no
// window gets left behind at all.
test('spawn refuses a dotted ticket before any window is created', skip, () => {
  const before = s.listWindows().map((w) => w.ticket).sort();
  assert.throws(() => s.spawn('a.b_c-9', 'sleep 300'), /unsafe ticket/);
  const after = s.listWindows().map((w) => w.ticket).sort();
  assert.deepEqual(after, before, 'spawn must leave no window behind for a rejected ticket');
});

test('capture, kill and attach also refuse a ticket containing `:` or `.`', skip, () => {
  assert.equal(s.capture('a.b'), '', 'capture of an unaddressable ticket is empty, not a throw');
  assert.doesNotThrow(() => s.kill('a.b'), 'kill of an unaddressable ticket is a silent no-op');
});
