'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  matchesQuery, rowMatches, searchTargets, firstMatch,
} = require('../lib/ui/screens/fleet/search');

// --- matchesQuery ------------------------------------------------------

test('matchesQuery: empty query never matches anything', () => {
  assert.equal(matchesQuery('CON-42', ''), false);
  assert.equal(matchesQuery('CON-42', '   '), false);
  assert.equal(matchesQuery('CON-42', null), false);
  assert.equal(matchesQuery('CON-42', undefined), false);
});

test('matchesQuery: null/undefined text never matches', () => {
  assert.equal(matchesQuery(null, 'foo'), false);
  assert.equal(matchesQuery(undefined, 'foo'), false);
});

test('matchesQuery: case-insensitive substring match', () => {
  assert.equal(matchesQuery('CON-42', 'con-42'), true);
  assert.equal(matchesQuery('CON-42', 'CON-42'), true);
  assert.equal(matchesQuery('add a share button', 'SHARE'), true);
});

test('matchesQuery: no match', () => {
  assert.equal(matchesQuery('CON-42', 'CON-99'), false);
});

// --- rowMatches ----------------------------------------------------------

test('rowMatches: matches on ticket id alone', () => {
  assert.equal(rowMatches('CON-42', 'unrelated title', '42'), true);
});

test('rowMatches: matches on title alone, not just id', () => {
  assert.equal(rowMatches('CON-42', 'share button', 'share'), true);
});

test('rowMatches: neither id nor title matches', () => {
  assert.equal(rowMatches('CON-42', 'share button', 'zzz'), false);
});

test('rowMatches: null title never breaks the id-only match', () => {
  assert.equal(rowMatches('CON-42', null, '42'), true);
});

// --- searchTargets / firstMatch ------------------------------------------

function run(over) {
  return Object.assign({
    ticket: 'HEL-1', changeName: 'a-change', status: 'running',
  }, over);
}

test('searchTargets: render order across NEEDS YOU, FAILED, RUNNING, QUICK START, QUEUED, DONE', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you', changeName: 'needs-you-change' }),
    run({ ticket: 'HEL-2', status: 'failed', changeName: 'failed-change' }),
    run({ ticket: 'HEL-3', status: 'running', changeName: 'running-change' }),
    run({ ticket: 'HEL-4', status: 'done', changeName: 'done-change' }),
  ];
  const queueState = { pending: ['HEL-5'], maxConcurrent: 1 };
  const quickStartTickets = [{ identifier: 'HEL-6', title: 'quick start ticket' }];
  const queuedTitles = new Map([['HEL-5', 'queued ticket title']]);

  const targets = searchTargets(runs, queueState, quickStartTickets, queuedTitles);
  assert.deepEqual(targets.map((t) => t.ticket), [
    'HEL-1', 'HEL-2', 'HEL-3', 'HEL-6', 'HEL-5', 'HEL-4',
  ]);
});

test('searchTargets: jump shape per section kind', () => {
  const runs = [
    run({ ticket: 'HEL-1', status: 'needs-you' }),
    run({ ticket: 'HEL-2', status: 'failed' }),
    run({ ticket: 'HEL-3', status: 'running' }),
    run({ ticket: 'HEL-4', status: 'done' }),
  ];
  const queueState = { pending: ['HEL-5'], maxConcurrent: 1 };
  const quickStartTickets = [{ identifier: 'HEL-6', title: 'quick start ticket' }];
  const queuedTitles = new Map([['HEL-5', 'queued ticket title']]);

  const targets = searchTargets(runs, queueState, quickStartTickets, queuedTitles);
  const byTicket = Object.fromEntries(targets.map((t) => [t.ticket, t]));

  // Runs-backed rows carry the flat `selected`-index-space 'jump' action,
  // walking the same NEEDS YOU -> FAILED -> RUNNING -> DONE order the
  // buildSections()-derived flat index space itself does.
  assert.deepEqual(byTicket['HEL-1'].jump, { type: 'jump', index: 0 });
  assert.deepEqual(byTicket['HEL-2'].jump, { type: 'jump', index: 1 });
  assert.deepEqual(byTicket['HEL-3'].jump, { type: 'jump', index: 2 });
  assert.deepEqual(byTicket['HEL-4'].jump, { type: 'jump', index: 3 });
  // QUICK START/QUEUED carry their own local-cursor jump shapes instead.
  assert.deepEqual(byTicket['HEL-6'].jump, { type: 'focus-quickstart', index: 0 });
  assert.deepEqual(byTicket['HEL-5'].jump, { type: 'focus-queue', index: 0 });
  assert.equal(byTicket['HEL-5'].title, 'queued ticket title');
  assert.equal(byTicket['HEL-6'].title, 'quick start ticket');
});

test('searchTargets: includes every row in a bucket, even beyond MAX_FINISHED/current scroll', () => {
  const runs = [];
  for (let i = 0; i < 8; i++) runs.push(run({ ticket: 'HEL-' + (100 + i), status: 'failed' }));
  const targets = searchTargets(runs, null, [], null);
  // MAX_FINISHED (sections.js) is 5 — buildSections() itself never caps the
  // group array, only window.js's later windowing does, so all 8 FAILED
  // rows must still be walkable here regardless of scroll position.
  const failedTickets = targets.filter((t) => t.ticket.startsWith('HEL-1')).map((t) => t.ticket);
  assert.equal(failedTickets.length, 8);
});

test('searchTargets: an empty queue/no quick-start-eligible tickets produce no QUEUED/QUICK START targets beyond an empty/omitted list', () => {
  const runs = [run({ ticket: 'HEL-1', status: 'running' })];
  const targets = searchTargets(runs, null, [], null);
  assert.deepEqual(targets.map((t) => t.ticket), ['HEL-1']);
});

test('firstMatch: returns the first render-order match', () => {
  const runs = [
    run({ ticket: 'HEL-2', status: 'failed', changeName: 'x' }),
    run({ ticket: 'HEL-9', status: 'done', changeName: 'x' }),
  ];
  const targets = searchTargets(runs, null, [], null);
  const match = firstMatch(targets, 'x');
  assert.equal(match.ticket, 'HEL-2');
});

test('firstMatch: returns undefined when nothing matches', () => {
  const runs = [run({ ticket: 'HEL-2', status: 'failed', changeName: 'x' })];
  const targets = searchTargets(runs, null, [], null);
  assert.equal(firstMatch(targets, 'zzz'), undefined);
});

test('firstMatch: an empty query matches nothing, even with targets present', () => {
  const runs = [run({ ticket: 'HEL-2', status: 'failed', changeName: 'x' })];
  const targets = searchTargets(runs, null, [], null);
  assert.equal(firstMatch(targets, ''), undefined);
});
