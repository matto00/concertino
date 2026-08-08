'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const local = require('../lib/ui/tickets/local');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-local-'));
}

function seed(root, files) {
  const dir = path.join(root, 'tickets');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return root;
}

const GOOD = `---
id: CON-12
title: Launch pad refuses non-linear providers
state: unstarted
priority: 2
epic: local-tickets
labels: [harness:codex, ui]
---

## Description

The gate is hard-wired.
`;

// --- parsing ---------------------------------------------------------------

test('a well-formed ticket normalises to linear.js\'s ticket shape', () => {
  const t = local.parseTicket('CON-12', GOOD, 1700000000000);
  assert.equal(t.identifier, 'CON-12');
  assert.equal(t.id, 'CON-12');
  assert.equal(t.number, 12);
  assert.equal(t.title, 'Launch pad refuses non-linear providers');
  assert.equal(t.state.type, 'unstarted');
  assert.equal(t.state.name, 'unstarted');
  assert.equal(t.priority, 2);
  assert.equal(t.epicId, 'local-tickets');
  assert.equal(t.epicName, 'local-tickets');
  assert.deepEqual(t.labels, ['harness:codex', 'ui']);
  assert.equal(t.updatedAt, 1700000000000);
  assert.match(t.description, /The gate is hard-wired\./);
  assert.doesNotMatch(t.description, /^---/);
});

test('local tickets carry no url, comments, estimate or assignee', () => {
  const t = local.parseTicket('CON-12', GOOD, null);
  assert.equal(t.url, null);
  assert.equal(t.estimate, null);
  assert.equal(t.assignee, null);
  assert.deepEqual(t.comments, []);
  assert.equal(t.commentCount, 0);
  assert.equal(t.commentsTruncated, false);
});

test('priority 0 survives as 0, not null — 0 is a real "None"', () => {
  const t = local.parseTicket('CON-1', '---\ntitle: T\nstate: backlog\npriority: 0\n---\n\nbody\n', null);
  assert.equal(t.priority, 0);
});

test('an absent priority is null, not 0', () => {
  const t = local.parseTicket('CON-1', '---\ntitle: T\nstate: backlog\n---\n\nbody\n', null);
  assert.equal(t.priority, null);
});

test('an absent epic leaves epicId null so deriveEpics buckets it as unassigned', () => {
  const t = local.parseTicket('CON-1', '---\ntitle: T\nstate: backlog\n---\n\nbody\n', null);
  assert.equal(t.epicId, null);
  assert.equal(t.epicName, null);
});

test('all five states parse', () => {
  for (const s of ['backlog', 'unstarted', 'started', 'completed', 'canceled']) {
    const t = local.parseTicket('CON-1', `---\ntitle: T\nstate: ${s}\n---\n\nb\n`, null);
    assert.equal(t.state.type, s, s);
  }
});

// --- malformed files -------------------------------------------------------

test('no frontmatter is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '# just a heading\n', null), null);
});

test('a missing title is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '---\nstate: backlog\n---\n\nb\n', null), null);
});

test('an unknown state is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '---\ntitle: T\nstate: in-review\n---\n\nb\n', null), null);
});

test('an id that disagrees with the filename is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '---\nid: CON-99\ntitle: T\nstate: backlog\n---\n\nb\n', null), null);
});

test('an out-of-range priority is malformed', () => {
  assert.equal(local.parseTicket('CON-1', '---\ntitle: T\nstate: backlog\npriority: 9\n---\n\nb\n', null), null);
});

test('an omitted id is fine — the filename is authoritative', () => {
  const t = local.parseTicket('CON-7', '---\ntitle: T\nstate: backlog\n---\n\nb\n', null);
  assert.equal(t.identifier, 'CON-7');
});

// --- the canonical ticket-id shape (CON-44) --------------------------------
// Under `linear` the id shape was structurally guaranteed — the provider
// issued it. Here the id is a filename anyone can type, so ticket.js's
// TICKET_RE is enforced at this seam. Without it, tickets/fix-login.md — which
// matches the docs' own `tickets/<ID>.md` phrasing — lists on the launch pad,
// is selectable and queueable, then dies at prompt.js's spawn with a bare "not
// a ticket id" that names no file.
const GOOD_BODY = '---\ntitle: T\nstate: backlog\n---\n\nb\n';

test('a filename stem that is not a canonical ticket id is rejected, not listed', () => {
  for (const stem of ['fix-login', 'notes', 'CON-1.2', 'a.b_c-9', '-CON-1', '1CON-1']) {
    assert.equal(local.parseTicket(stem, GOOD_BODY, null), null, stem + ' must not parse as a ticket');
  }
});

test('every shape ticket.js\'s TICKET_RE admits still parses', () => {
  for (const stem of ['CON-12', 'HEL-334', '#123', 'TICKET-1', 'a_b_c-9']) {
    const t = local.parseTicket(stem, GOOD_BODY, null);
    assert.ok(t, stem + ' must parse as a ticket');
    assert.equal(t.identifier, stem);
  }
});

test('a non-conforming stem counts as unreadable, so the launch pad reports it', () => {
  const root = seed(tmpRoot(), {
    'CON-1.md': GOOD_BODY,
    // Perfectly well-formed frontmatter — only the filename disqualifies it.
    'fix-login.md': GOOD_BODY,
  });
  const r = local.readTickets(root);
  assert.deepEqual(r.tickets.map((t) => t.identifier), ['CON-1']);
  assert.equal(r.unreadable, 1, 'an unlaunchable row must surface in the unreadable count, not vanish silently');
});

test('a non-conforming stem never reaches fetchTickets\' results', () => {
  const root = seed(tmpRoot(), { 'fix-login.md': GOOD_BODY });
  const r = local.fetchTickets({ root, stateTypes: ['backlog', 'unstarted', 'started'] });
  assert.deepEqual(r.tickets, []);
  assert.equal(r.unreadable, 1);
});

// --- directory reads -------------------------------------------------------

test('a missing tickets/ directory is not an error', () => {
  const r = local.readTickets(tmpRoot());
  assert.deepEqual(r, { tickets: [], unreadable: 0, dirExists: false });
});

test('an empty tickets/ directory is distinguishable from a missing one', () => {
  const root = seed(tmpRoot(), {});
  const r = local.readTickets(root);
  assert.equal(r.dirExists, true);
  assert.equal(r.tickets.length, 0);
});

test('one malformed file is skipped and counted; the rest still load', () => {
  const root = seed(tmpRoot(), {
    'CON-1.md': '---\ntitle: One\nstate: backlog\n---\n\nb\n',
    'CON-2.md': 'no frontmatter here\n',
    'CON-3.md': '---\ntitle: Three\nstate: started\n---\n\nb\n',
  });
  const r = local.readTickets(root);
  assert.equal(r.unreadable, 1);
  assert.deepEqual(r.tickets.map((t) => t.identifier), ['CON-1', 'CON-3']);
});

test('non-markdown files are ignored entirely, not counted as unreadable', () => {
  const root = seed(tmpRoot(), { 'CON-1.md': '---\ntitle: One\nstate: backlog\n---\n\nb\n', 'README.txt': 'hi' });
  assert.equal(local.readTickets(root).unreadable, 0);
});

// --- fetch -----------------------------------------------------------------

test('fetchTickets filters to the open states and sorts numerically', () => {
  const root = seed(tmpRoot(), {
    'CON-10.md': '---\ntitle: Ten\nstate: started\n---\n\nb\n',
    'CON-2.md': '---\ntitle: Two\nstate: backlog\n---\n\nb\n',
    'CON-3.md': '---\ntitle: Three\nstate: completed\n---\n\nb\n',
  });
  const r = local.fetchTickets({ root, teamKey: 'CON', stateTypes: ['backlog', 'unstarted', 'started'] });
  assert.deepEqual(r.tickets.map((t) => t.identifier), ['CON-2', 'CON-10']);
  assert.equal(r.teamKey, 'CON');
  assert.equal(r.truncated, false);
  assert.equal(r.pages, 1);
});

test('fetchTickets derives epics, unassigned last', () => {
  const root = seed(tmpRoot(), {
    'CON-1.md': '---\ntitle: One\nstate: backlog\nepic: zeta\n---\n\nb\n',
    'CON-2.md': '---\ntitle: Two\nstate: backlog\n---\n\nb\n',
    'CON-3.md': '---\ntitle: Three\nstate: backlog\nepic: alpha\n---\n\nb\n',
  });
  const r = local.fetchTickets({ root, teamKey: 'CON', stateTypes: ['backlog', 'unstarted', 'started'] });
  assert.deepEqual(r.epics.map((e) => e.name), ['alpha', 'zeta', null]);
});

// --- gate and messages -----------------------------------------------------

test('the launch pad needs only launchPad.enabled and kind local — no api key', () => {
  const cfg = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'local' } };
  assert.equal(local.launchPadStatus(cfg, {}).enabled, true);
});

test('the launch pad is off when launchPad.enabled is not true', () => {
  const cfg = { dashboard: { launchPad: {} }, ticketProvider: { kind: 'local' } };
  const s = local.launchPadStatus(cfg, {});
  assert.equal(s.enabled, false);
  assert.equal(s.reason, 'disabled');
});

test('teamKeyFromConfig ignores LINEAR_TEAM_KEY, which is meaningless here', () => {
  const cfg = { ticketProvider: { kind: 'local', teamKey: 'con' } };
  assert.deepEqual(local.teamKeyFromConfig(cfg, { LINEAR_TEAM_KEY: 'NOPE' }), { key: 'CON', source: 'config' });
});

test('teamKeyFromConfig falls back to the idExample prefix', () => {
  const cfg = { ticketProvider: { kind: 'local', idExample: 'abc-123' } };
  assert.deepEqual(local.teamKeyFromConfig(cfg, {}), { key: 'ABC', source: 'idExample' });
});

test('resolveTeam reports whether tickets/ exists', () => {
  assert.deepEqual(local.resolveTeam({ root: tmpRoot() }), { found: false });
  assert.deepEqual(local.resolveTeam({ root: seed(tmpRoot(), {}) }), { found: true });
});

test('the not-found message tells you to create a ticket, not to check a team key', () => {
  const m = local.teamNotFoundMessage('CON');
  assert.match(m, /tickets\//);
  assert.doesNotMatch(m, /teamKey/);
});

test('createTicket rejects — TUI authoring is a later ticket', async () => {
  await assert.rejects(() => local.createTicket({ title: 'x' }), /not supported/);
});
