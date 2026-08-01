'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const draft = require('../lib/ui/draft');

// A fake execFile with the same (command, args, options, callback) shape
// child_process.execFile has — draft.js's own injectable seam (mirrors
// linear.js's `transport` parameter), so none of this ever spawns a real
// `claude` process.
function fakeExecFile({ err, stdout } = {}) {
  const calls = [];
  let kill = null;
  const fn = (command, args, options, callback) => {
    calls.push({ command, args, options });
    const child = {
      kill() { kill = true; },
    };
    // Deferred, like a real child process, so cancel() has a chance to run
    // before the callback fires.
    process.nextTick(() => callback(err || null, stdout || ''));
    return child;
  };
  fn.calls = calls;
  fn.killed = () => kill;
  return fn;
}

test('draftPrompt embeds the free-text seed and asks for the three-field JSON shape', () => {
  const p = draft.draftPrompt('add a share button to dashboards');
  assert.match(p, /add a share button to dashboards/);
  assert.match(p, /"title"/);
  assert.match(p, /"description"/);
  assert.match(p, /"acceptanceCriteria"/);
});

test('parseDraftOutput parses a --output-format json envelope whose result is a JSON string', () => {
  const stdout = JSON.stringify({
    result: JSON.stringify({ title: 'Add a share button', description: 'desc', acceptanceCriteria: '- works' }),
  });
  const out = draft.parseDraftOutput(stdout);
  assert.deepEqual(out, { title: 'Add a share button', description: 'desc', acceptanceCriteria: '- works' });
});

test('parseDraftOutput also accepts the draft shape unwrapped (no result envelope)', () => {
  const stdout = JSON.stringify({ title: 'T', description: 'D', acceptanceCriteria: 'A' });
  assert.deepEqual(draft.parseDraftOutput(stdout), { title: 'T', description: 'D', acceptanceCriteria: 'A' });
});

test('parseDraftOutput rejects non-JSON stdout', () => {
  assert.throws(() => draft.parseDraftOutput('not json at all'), /drafting failed: response was not JSON/);
});

test('parseDraftOutput rejects a JSON body missing a required field', () => {
  const stdout = JSON.stringify({ title: 'T', description: 'D' });
  assert.throws(() => draft.parseDraftOutput(stdout), /missing "acceptanceCriteria"/);
});

test('parseDraftOutput rejects a result string that is itself not JSON', () => {
  const stdout = JSON.stringify({ result: 'not json' });
  assert.throws(() => draft.parseDraftOutput(stdout), /missing "title"/);
});

test('draftTicket resolves with the parsed draft on success', async () => {
  const stdout = JSON.stringify({ title: 'T', description: 'D', acceptanceCriteria: 'A' });
  const execFile = fakeExecFile({ stdout });
  const { promise } = draft.draftTicket('an intention', { execFile });
  const out = await promise;
  assert.deepEqual(out, { title: 'T', description: 'D', acceptanceCriteria: 'A' });
  assert.equal(execFile.calls.length, 1);
  assert.equal(execFile.calls[0].command, 'claude');
  assert.deepEqual(execFile.calls[0].args.slice(0, 1), ['-p']);
  assert.ok(execFile.calls[0].args.includes('--output-format'));
  assert.ok(execFile.calls[0].args.includes('json'));
  assert.match(execFile.calls[0].args[1], /an intention/);
});

test('draftTicket rejects on a non-zero exit — the harness process error', async () => {
  const execFile = fakeExecFile({ err: new Error('claude exited 1') });
  const { promise } = draft.draftTicket('x', { execFile });
  await assert.rejects(promise, /drafting failed: claude exited 1/);
});

test('draftTicket rejects on malformed JSON output', async () => {
  const execFile = fakeExecFile({ stdout: '<not json>' });
  const { promise } = draft.draftTicket('x', { execFile });
  await assert.rejects(promise, /drafting failed: response was not JSON/);
});

test('draftTicket rejects when a required field is missing', async () => {
  const execFile = fakeExecFile({ stdout: JSON.stringify({ title: 'T', description: 'D' }) });
  const { promise } = draft.draftTicket('x', { execFile });
  await assert.rejects(promise, /missing "acceptanceCriteria"/);
});

test('draftTicket cancellation kills the in-flight child process and the promise rejects rather than hangs', async () => {
  const execFile = fakeExecFile({ stdout: JSON.stringify({ title: 'T', description: 'D', acceptanceCriteria: 'A' }) });
  const { promise, cancel } = draft.draftTicket('x', { execFile });
  cancel();
  assert.equal(execFile.killed(), true, 'the child process must have been killed');
  await assert.rejects(promise, /cancelled/);
});

test('calling cancel after the draft already settled is a harmless no-op', async () => {
  const execFile = fakeExecFile({ stdout: JSON.stringify({ title: 'T', description: 'D', acceptanceCriteria: 'A' }) });
  const { promise, cancel } = draft.draftTicket('x', { execFile });
  await promise;
  assert.doesNotThrow(() => cancel());
});
