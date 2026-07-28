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
