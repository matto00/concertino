'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const provider = require('../lib/ui/ticket-provider');
const linear = require('../lib/ui/linear');
const local = require('../lib/ui/tickets/local');

const LINEAR_CFG = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'linear', teamKey: 'CON' } };
const LOCAL_CFG = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'local', teamKey: 'CON' } };

test('launchPadStatus dispatches to linear', () => {
  assert.deepEqual(
    provider.launchPadStatus(LINEAR_CFG, { LINEAR_API_KEY: 'k' }),
    linear.launchPadStatus(LINEAR_CFG, { LINEAR_API_KEY: 'k' })
  );
});

test('launchPadStatus dispatches to local, which needs no api key', () => {
  assert.equal(provider.launchPadStatus(LOCAL_CFG, {}).enabled, true);
});

test('teamKeyFromConfig honours LINEAR_TEAM_KEY under linear but not under local', () => {
  assert.equal(provider.teamKeyFromConfig(LINEAR_CFG, { LINEAR_TEAM_KEY: 'zzz' }).key, 'ZZZ');
  assert.equal(provider.teamKeyFromConfig(LOCAL_CFG, { LINEAR_TEAM_KEY: 'zzz' }).key, 'CON');
});

test('teamNotFoundMessage dispatches on kind', () => {
  assert.match(provider.teamNotFoundMessage(LINEAR_CFG, 'CON'), /teamKey/);
  assert.match(provider.teamNotFoundMessage(LOCAL_CFG, 'CON'), /tickets\//);
});

test('stateTypesFromConfig is shared — the backlog dial means the same thing', () => {
  const off = { ticketProvider: { kind: 'local' }, dashboard: { launchPad: { enabled: true, backlog: false } } };
  assert.deepEqual(provider.stateTypesFromConfig(off), ['unstarted', 'started']);
});

test('resolveTeam takes an object arg and reaches local', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-tp-'));
  assert.deepEqual(provider.resolveTeam(LOCAL_CFG, { root }), { found: false });
  fs.mkdirSync(path.join(root, 'tickets'));
  assert.deepEqual(provider.resolveTeam(LOCAL_CFG, { root }), { found: true });
});

test('createTicket under local rejects rather than throwing a TypeError', async () => {
  await assert.rejects(() => provider.createTicket(LOCAL_CFG, { title: 'x' }), /not supported/);
});

test('an unknown kind fails loudly rather than silently behaving like linear', () => {
  assert.throws(
    () => provider.launchPadStatus({ ticketProvider: { kind: 'jira' } }, {}),
    /unknown ticketProvider\.kind/
  );
});

test('local.fetchTickets is what the resolver reaches for under local', () => {
  assert.equal(provider.moduleFor({ ticketProvider: { kind: 'local' } }), local);
  assert.equal(provider.moduleFor({ ticketProvider: { kind: 'linear' } }), linear);
});
