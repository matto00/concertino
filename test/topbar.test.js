'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildTopBarLine } = require('../lib/ui/topbar');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function run(over) {
  return Object.assign({ ticket: 'HEL-1', project: 'helio', status: 'running' }, over);
}

test('names the project and screen', () => {
  const out = plain(buildTopBarLine({ runs: [run({})], queueState: null }, 'FLEET', { cols: 80 }));
  assert.match(out, /helio/);
  assert.match(out, /FLEET/);
});

test('counts runs and needs-you separately', () => {
  const out = plain(buildTopBarLine({
    runs: [run({ status: 'needs-you' }), run({ ticket: 'HEL-2', status: 'running' })],
    queueState: null,
  }, 'FLEET', { cols: 80 }));
  assert.match(out, /2 runs/);
  assert.match(out, /1 needs you/);
});

test('omits the needs-you clause entirely when nothing needs attention', () => {
  const out = plain(buildTopBarLine({ runs: [run({})], queueState: null }, 'FLEET', { cols: 80 }));
  assert.doesNotMatch(out, /needs you/);
});

test('names an active queue, omits the clause when there is none', () => {
  const withQueue = plain(buildTopBarLine({
    runs: [], queueState: { pending: ['HEL-9'], inFlight: new Set(), maxConcurrent: 1 },
  }, 'FLEET', { cols: 80 }));
  assert.match(withQueue, /queue: 1 pending/);

  const withoutQueue = plain(buildTopBarLine({ runs: [], queueState: null }, 'FLEET', { cols: 80 }));
  assert.doesNotMatch(withoutQueue, /queue:/);
});

test('an empty fleet still names the project and screen', () => {
  const out = plain(buildTopBarLine({ runs: [], queueState: null }, 'DRILL-DOWN', { cols: 80 }));
  assert.match(out, /DRILL-DOWN/);
});

test('stays within cols at a narrow width', () => {
  const { visibleLength } = require('../lib/ui/format');
  const out = buildTopBarLine({
    runs: [run({ project: 'a-very-long-project-name-indeed' })], queueState: null,
  }, 'LAUNCH PLAN', { cols: 40 });
  assert.ok(visibleLength(out) <= 40);
});
