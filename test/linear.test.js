'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

const linear = require('../lib/ui/linear');

// Wire-format fixtures. Shapes are copied from real Concertino/Helio issues so
// the normaliser is exercised against what Linear actually returns, not against
// a convenient invention. No test in this file touches the network.

function issueNode(over) {
  return Object.assign(
    {
      id: 'uuid-con-1',
      identifier: 'CON-1',
      number: 1,
      title: 'Gate events carry no duration or error detail',
      description: 'The reducer reads `duration_ms` off `gate.result` events.',
      url: 'https://linear.app/helioapp/issue/CON-1/gate-events',
      estimate: 3,
      updatedAt: '2026-07-28T04:46:28.689Z',
      state: { name: 'In Progress', type: 'started' },
      assignee: { name: 'Matthew Orr', displayName: 'matt' },
      labels: { nodes: [{ name: 'Epic' }] },
      project: { id: 'proj-1', name: 'Pipeline v2' },
      comments: {
        pageInfo: { hasNextPage: false },
        nodes: [
          {
            id: 'c1',
            body: 'PR opened: https://github.com/matto00/helio/pull/306',
            createdAt: '2026-07-26T20:56:59.523Z',
            user: { name: 'Matthew Orr', displayName: 'matt' },
          },
        ],
      },
    },
    over,
  );
}

function page(nodes, hasNextPage, endCursor) {
  return {
    status: 200,
    body: JSON.stringify({
      data: { issues: { pageInfo: { hasNextPage: !!hasNextPage, endCursor: endCursor || null }, nodes } },
    }),
  };
}

// A transport that replays canned pages and records what it was asked for.
function fakeTransport(pages) {
  const calls = [];
  let i = 0;
  const t = (req) => {
    calls.push(JSON.parse(req.body));
    const res = pages[Math.min(i, pages.length - 1)];
    i++;
    return Promise.resolve(res);
  };
  t.calls = calls;
  return t;
}

// --- open states -----------------------------------------------------------

test('OPEN_STATE_TYPES is backlog, unstarted and started', () => {
  assert.deepEqual(linear.OPEN_STATE_TYPES, ['backlog', 'unstarted', 'started']);
});

test('open states deliberately include started so the launch pad can warn about it', () => {
  // The inline status column exists to show a ticket already In Progress in
  // Linear. Dropping `started` from the query would make that impossible.
  assert.ok(linear.OPEN_STATE_TYPES.includes('started'));
  assert.ok(!linear.OPEN_STATE_TYPES.includes('completed'));
  assert.ok(!linear.OPEN_STATE_TYPES.includes('canceled'));
});

test('the query filters on state type and team key', () => {
  assert.match(linear.QUERY, /state:\s*{\s*type:\s*{\s*in:\s*\$states\s*}\s*}/);
  assert.match(linear.QUERY, /team:\s*{\s*key:\s*{\s*eq:\s*\$teamKey\s*}\s*}/);
});

test('the query asks for descriptions and comments — the ticket viewer depends on it', () => {
  assert.match(linear.QUERY, /\bdescription\b/);
  assert.match(linear.QUERY, /comments\(first: \$commentLimit\)/);
  assert.match(linear.QUERY, /pageInfo \{ hasNextPage endCursor \}/);
});

test('the query asks for priority — the launch pad cannot render what it never fetched', () => {
  assert.match(linear.QUERY, /\bpriority\b/);
});

// --- normalisation ---------------------------------------------------------

test('normalise flattens the GraphQL shape to the internal model', () => {
  const { tickets } = linear.normalise('CON', [issueNode()]);
  assert.equal(tickets.length, 1);
  const t = tickets[0];

  assert.equal(t.identifier, 'CON-1');
  assert.equal(t.number, 1);
  assert.equal(t.state.name, 'In Progress');
  assert.equal(t.state.type, 'started');
  assert.equal(t.estimate, 3);
  assert.equal(t.assignee, 'matt');
  assert.deepEqual(t.labels, ['Epic']);
  assert.equal(t.epicId, 'proj-1');
  assert.equal(t.epicName, 'Pipeline v2');
  assert.equal(t.commentCount, 1);
  assert.equal(t.commentsTruncated, false);
  assert.equal(t.comments[0].author, 'matt');
});

test('timestamps normalise to epoch millis, matching the event schema', () => {
  const { tickets } = linear.normalise('CON', [issueNode()]);
  assert.equal(tickets[0].updatedAt, Date.parse('2026-07-28T04:46:28.689Z'));
  assert.equal(tickets[0].comments[0].createdAt, Date.parse('2026-07-26T20:56:59.523Z'));
});

test('normalise never leaks Linear wire keys into the model', () => {
  const { tickets } = linear.normalise('CON', [issueNode()]);
  const keys = Object.keys(tickets[0]);
  // `project`, `nodes` and `user` are Linear's names; the model uses epic*/author.
  assert.ok(!keys.includes('project'));
  assert.ok(!keys.includes('nodes'));
  assert.ok(!Object.keys(tickets[0].comments[0]).includes('user'));
});

test('a missing assignee, project, estimate or description is null-safe', () => {
  const { tickets } = linear.normalise('CON', [
    issueNode({
      assignee: null,
      project: null,
      estimate: null,
      description: null,
      labels: { nodes: [] },
      state: null,
      comments: { pageInfo: { hasNextPage: false }, nodes: [] },
    }),
  ]);
  const t = tickets[0];
  assert.equal(t.assignee, null);
  assert.equal(t.epicId, null);
  assert.equal(t.epicName, null);
  assert.equal(t.estimate, null);
  assert.equal(t.description, '');
  assert.deepEqual(t.labels, []);
  assert.deepEqual(t.state, { name: null, type: null });
  assert.equal(t.commentCount, 0);
});

// --- priority ----------------------------------------------------------------
// `0` is Linear's "None" — a real value — so it must round-trip exactly, never
// falling back to null the way an `||` guard would.

test('priority 0 (None) round-trips as 0, not null', () => {
  const { tickets } = linear.normalise('CON', [issueNode({ priority: 0 })]);
  assert.strictEqual(tickets[0].priority, 0);
});

test('a numeric priority round-trips unchanged', () => {
  const { tickets } = linear.normalise('CON', [issueNode({ priority: 1 })]);
  assert.strictEqual(tickets[0].priority, 1);
});

test('a missing priority field normalises to null', () => {
  const node = issueNode({});
  delete node.priority;
  const { tickets } = linear.normalise('CON', [node]);
  assert.strictEqual(tickets[0].priority, null);
});

test('a non-numeric priority normalises to null rather than passing through', () => {
  const { tickets } = linear.normalise('CON', [issueNode({ priority: 'Urgent' })]);
  assert.strictEqual(tickets[0].priority, null);
});

test('a truncated comment thread is flagged, not silently shortened', () => {
  const { tickets } = linear.normalise('CON', [
    issueNode({ comments: { pageInfo: { hasNextPage: true }, nodes: [{ id: 'c1', body: 'x', createdAt: null, user: null }] } }),
  ]);
  assert.equal(tickets[0].commentsTruncated, true);
  assert.equal(tickets[0].commentCount, 1);
});

test('tickets sort numerically by identifier, not lexically', () => {
  const nodes = [10, 2, 1].map((n) => issueNode({ id: 'u' + n, identifier: 'CON-' + n, number: n }));
  const { tickets } = linear.normalise('CON', nodes);
  assert.deepEqual(tickets.map((t) => t.identifier), ['CON-1', 'CON-2', 'CON-10']);
});

// --- epics -----------------------------------------------------------------

test('epics are derived from the fetched tickets with open counts', () => {
  const { epics } = linear.normalise('CON', [
    issueNode({ id: 'a', identifier: 'CON-1', project: { id: 'p1', name: 'Pipeline v2' } }),
    issueNode({ id: 'b', identifier: 'CON-2', project: { id: 'p1', name: 'Pipeline v2' } }),
    issueNode({ id: 'c', identifier: 'CON-3', project: { id: 'p2', name: 'Auth hardening' } }),
  ]);
  assert.deepEqual(epics, [
    { id: 'p2', name: 'Auth hardening', openCount: 1 },
    { id: 'p1', name: 'Pipeline v2', openCount: 2 },
  ]);
});

test('a team with no projects yields a single unassigned bucket', () => {
  // The real Concertino team fetch returns exactly this: no ticket carries a
  // Linear project, so `epics` is one bucket with a null id and null name and
  // the UI renders it as `─ unassigned ─`. A null name is the model's business;
  // naming it here would leak presentation into the data layer.
  const { epics } = linear.normalise('CON', [
    issueNode({ id: 'a', identifier: 'CON-2', project: null }),
    issueNode({ id: 'b', identifier: 'CON-3', project: null }),
  ]);
  assert.deepEqual(epics, [{ id: null, name: null, openCount: 2 }]);
});

test('project-less tickets collect into an unassigned bucket that sorts last', () => {
  const { epics } = linear.normalise('CON', [
    issueNode({ id: 'a', identifier: 'CON-1', project: null }),
    issueNode({ id: 'b', identifier: 'CON-2', project: { id: 'p9', name: 'Zebra' } }),
  ]);
  assert.equal(epics.length, 2);
  assert.equal(epics[0].name, 'Zebra');
  assert.equal(epics[1].id, null);
  assert.equal(epics[1].openCount, 1);
});

// --- fetch + pagination ----------------------------------------------------

test('fetchTickets pages until hasNextPage is false', async () => {
  const transport = fakeTransport([
    page([issueNode({ id: 'a', identifier: 'CON-1' })], true, 'cursor-1'),
    page([issueNode({ id: 'b', identifier: 'CON-2' })], true, 'cursor-2'),
    page([issueNode({ id: 'c', identifier: 'CON-3' })], false, null),
  ]);

  const out = await linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport });

  assert.equal(out.pages, 3);
  assert.deepEqual(out.tickets.map((t) => t.identifier), ['CON-1', 'CON-2', 'CON-3']);
  assert.equal(transport.calls[0].variables.after, null);
  assert.equal(transport.calls[1].variables.after, 'cursor-1');
  assert.equal(transport.calls[2].variables.after, 'cursor-2');
});

test('fetchTickets sends the team key, open states and limits as variables', async () => {
  const transport = fakeTransport([page([], false, null)]);
  await linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport, pageSize: 7, commentLimit: 3 });
  const v = transport.calls[0].variables;
  assert.equal(v.teamKey, 'CON');
  assert.deepEqual(v.states, linear.OPEN_STATE_TYPES);
  assert.equal(v.pageSize, 7);
  assert.equal(v.commentLimit, 3);
});

test('fetchTickets stops when the cursor fails to advance', async () => {
  // Always claims another page with the same cursor. Without the guard this
  // spins forever against a broken or changed API.
  const transport = fakeTransport([page([issueNode()], true, 'stuck')]);
  const out = await linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport });
  assert.equal(out.pages, 2);
});

test('fetchTickets stops at MAX_PAGES', async () => {
  let n = 0;
  const transport = () => {
    n++;
    return Promise.resolve(page([issueNode({ id: 'i' + n, identifier: 'CON-' + n })], true, 'c' + n));
  };
  const out = await linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport });
  assert.equal(out.pages, linear.MAX_PAGES);
});

// --- MAX_TICKETS (the real bound) -------------------------------------------

test('MAX_TICKETS is 500', () => {
  assert.equal(linear.MAX_TICKETS, 500);
});

test('a fetch under the cap returns everything with truncated: false', async () => {
  const transport = fakeTransport([
    page([issueNode({ id: 'a', identifier: 'CON-1' }), issueNode({ id: 'b', identifier: 'CON-2' })], false, null),
  ]);
  const out = await linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport, maxTickets: 5 });
  assert.equal(out.tickets.length, 2);
  assert.equal(out.truncated, false);
});

test('a fetch that would exceed the cap stops at exactly maxTickets and is flagged truncated', async () => {
  // Cap is 3. Page 1 brings the total to 2 (under the cap, keep paging).
  // Page 2 brings it to exactly 3 (the cap) but Linear still reports a
  // further page — that alone is what should flag `truncated`, not overshoot.
  const transport = fakeTransport([
    page([issueNode({ id: 'a', identifier: 'CON-1' }), issueNode({ id: 'b', identifier: 'CON-2' })], true, 'cursor-1'),
    page([issueNode({ id: 'c', identifier: 'CON-3' })], true, 'cursor-2'),
  ]);

  const out = await linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport, maxTickets: 3 });

  assert.equal(out.tickets.length, 3);
  assert.equal(out.truncated, true);
  assert.equal(transport.calls.length, 2); // no third page requested past the cap-crossing one
});

test('a fetch landing exactly on the cap with nothing left is not truncated', async () => {
  const transport = fakeTransport([
    page([issueNode({ id: 'a', identifier: 'CON-1' }), issueNode({ id: 'b', identifier: 'CON-2' })], false, null),
  ]);
  const out = await linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport, maxTickets: 2 });
  assert.equal(out.tickets.length, 2);
  assert.equal(out.truncated, false);
});

test('a cap-crossing page that overshoots is truncated even when Linear reports no further page', async () => {
  // design.md Decision 3's overshoot case: the shipped constants (PAGE_SIZE
  // 50, MAX_TICKETS 500) make this impossible in production — every page
  // boundary lands exactly on a multiple of 50 — so a small maxTickets
  // fixture is needed to exercise a single page overshooting the cap.
  const transport = fakeTransport([
    page(
      [
        issueNode({ id: 'a', identifier: 'CON-1' }),
        issueNode({ id: 'b', identifier: 'CON-2' }),
        issueNode({ id: 'c', identifier: 'CON-3' }),
      ],
      false,
      null,
    ),
  ]);

  const out = await linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport, maxTickets: 2 });

  assert.equal(out.tickets.length, 2);
  assert.equal(out.truncated, true);
  assert.equal(transport.calls.length, 1);
});

// --- stateTypesFromConfig ----------------------------------------------------

test('stateTypesFromConfig includes backlog by default', () => {
  assert.deepEqual(linear.stateTypesFromConfig({}), linear.OPEN_STATE_TYPES);
  assert.deepEqual(linear.stateTypesFromConfig(undefined), linear.OPEN_STATE_TYPES);
});

test('stateTypesFromConfig excludes backlog when set to exactly false', () => {
  const types = linear.stateTypesFromConfig({ dashboard: { launchPad: { backlog: false } } });
  assert.deepEqual(types, ['unstarted', 'started']);
});

test('stateTypesFromConfig preserves the default for any value other than exactly false', () => {
  assert.deepEqual(
    linear.stateTypesFromConfig({ dashboard: { launchPad: { backlog: true } } }),
    linear.OPEN_STATE_TYPES,
  );
  assert.deepEqual(
    linear.stateTypesFromConfig({ dashboard: { launchPad: { backlog: 'false' } } }),
    linear.OPEN_STATE_TYPES,
  );
  assert.deepEqual(linear.stateTypesFromConfig({ dashboard: {} }), linear.OPEN_STATE_TYPES);
});

test('auth uses the raw key with no Bearer prefix', async () => {
  let seen = null;
  const transport = (req) => {
    seen = req;
    return Promise.resolve(page([], false, null));
  };
  await linear.fetchTickets({ teamKey: 'CON', apiKey: 'lin_api_abc', transport });
  assert.equal(seen.headers.Authorization, 'lin_api_abc');
  assert.equal(seen.url, linear.API_URL);
});

test('fetchTickets falls back to LINEAR_API_KEY from the environment', async () => {
  const prev = process.env.LINEAR_API_KEY;
  process.env.LINEAR_API_KEY = 'from-env';
  try {
    let seen = null;
    await linear.fetchTickets({
      teamKey: 'CON',
      transport: (req) => {
        seen = req;
        return Promise.resolve(page([], false, null));
      },
    });
    assert.equal(seen.headers.Authorization, 'from-env');
  } finally {
    if (prev === undefined) delete process.env.LINEAR_API_KEY;
    else process.env.LINEAR_API_KEY = prev;
  }
});

// --- errors ----------------------------------------------------------------

test('a missing api key is an error, not an empty fetch', async () => {
  const prev = process.env.LINEAR_API_KEY;
  delete process.env.LINEAR_API_KEY;
  try {
    await assert.rejects(
      () => linear.fetchTickets({ teamKey: 'CON', transport: fakeTransport([page([], false, null)]) }),
      /LINEAR_API_KEY is not set/,
    );
  } finally {
    if (prev !== undefined) process.env.LINEAR_API_KEY = prev;
  }
});

test('a missing team key is an error', async () => {
  await assert.rejects(() => linear.fetchTickets({ apiKey: 'k' }), /teamKey is required/);
});

test('a 401 names the token rather than the status alone', async () => {
  const transport = () => Promise.resolve({ status: 401, body: '{"errors":[{"message":"Authentication required"}]}' });
  await assert.rejects(() => linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport }), /LINEAR_API_KEY was rejected/);
});

test('a GraphQL errors array surfaces the first message', async () => {
  const transport = () =>
    Promise.resolve({ status: 200, body: JSON.stringify({ errors: [{ message: 'Unknown field state' }] }) });
  await assert.rejects(() => linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport }), /Unknown field state/);
});

test('a non-JSON body is reported as such, truncated', async () => {
  const transport = () => Promise.resolve({ status: 200, body: '<html>' + 'x'.repeat(5000) + '</html>' });
  await assert.rejects(() => linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport }), (e) => {
    assert.match(e.message, /was not JSON/);
    assert.ok(e.message.length < 300, 'error message must not embed the whole body');
    return true;
  });
});

test('a 500 is reported with its status', async () => {
  const transport = () => Promise.resolve({ status: 500, body: 'boom' });
  await assert.rejects(() => linear.fetchTickets({ teamKey: 'CON', apiKey: 'k', transport }), /HTTP 500/);
});

// --- feature gate ----------------------------------------------------------

const ON = { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'linear' } };

test('the launch pad needs all three conditions', () => {
  const s = linear.launchPadStatus(ON, { LINEAR_API_KEY: 'k' });
  assert.equal(s.enabled, true);
  assert.equal(s.reason, null);
});

test('a disabled launch pad says so by name', () => {
  const s = linear.launchPadStatus({ ticketProvider: { kind: 'linear' } }, { LINEAR_API_KEY: 'k' });
  assert.equal(s.enabled, false);
  assert.equal(s.reason, 'disabled');
  assert.match(s.message, /dashboard\.launchPad\.enabled/);
});

test('a non-linear ticket provider says which provider is configured', () => {
  const s = linear.launchPadStatus(
    { dashboard: { launchPad: { enabled: true } }, ticketProvider: { kind: 'github' } },
    { LINEAR_API_KEY: 'k' },
  );
  assert.equal(s.reason, 'provider');
  assert.match(s.message, /github/);
});

test('a missing key is reported rather than silently hiding the feature', () => {
  const s = linear.launchPadStatus(ON, {});
  assert.equal(s.reason, 'no-key');
  assert.match(s.message, /LINEAR_API_KEY/);
});

test('an empty-string key counts as absent', () => {
  assert.equal(linear.launchPadStatus(ON, { LINEAR_API_KEY: '' }).reason, 'no-key');
});

test('enabled must be exactly true, not merely truthy', () => {
  const s = linear.launchPadStatus(
    { dashboard: { launchPad: { enabled: 'yes' } }, ticketProvider: { kind: 'linear' } },
    { LINEAR_API_KEY: 'k' },
  );
  assert.equal(s.reason, 'disabled');
});

test('an absent config does not throw', () => {
  assert.equal(linear.launchPadStatus(undefined, {}).reason, 'disabled');
  assert.equal(linear.launchPadStatus(null, {}).enabled, false);
});

// --- team key --------------------------------------------------------------

test('an explicit ticketProvider.teamKey wins over the id example', () => {
  const r = linear.teamKeyFromConfig({ ticketProvider: { teamKey: 'con', idExample: 'ABC-123' } }, {});
  assert.deepEqual(r, { key: 'CON', source: 'config' });
});

test('LINEAR_TEAM_KEY overrides the config', () => {
  const r = linear.teamKeyFromConfig({ ticketProvider: { teamKey: 'HEL' } }, { LINEAR_TEAM_KEY: 'con' });
  assert.deepEqual(r, { key: 'CON', source: 'env' });
});

test('the id example is a last-resort guess and is labelled as one', () => {
  // Concertino's own config ships idExample "ABC-123" against a real CON team,
  // so a key derived from it must never be presented as authoritative — it
  // would fetch cleanly and return an empty launch pad with nothing to explain
  // it.
  const r = linear.teamKeyFromConfig({ ticketProvider: { idExample: 'ABC-123' } }, {});
  assert.deepEqual(r, { key: 'ABC', source: 'idExample' });
});

test('an unparseable id example yields no key rather than a bad one', () => {
  assert.deepEqual(linear.teamKeyFromConfig({ ticketProvider: { idExample: 'nonsense' } }, {}), {
    key: null,
    source: null,
  });
  assert.deepEqual(linear.teamKeyFromConfig({}, {}), { key: null, source: null });
});

// --- resolveTeam (CON-20) ---------------------------------------------------
// Linear answers a bulk issue fetch against an unknown team key with an empty
// result — the identical shape a real, empty team returns — so the launch
// pad needs a separate, direct way to ask "does this team exist at all".

function teamsPage(nodes) {
  return { status: 200, body: JSON.stringify({ data: { teams: { nodes } } }) };
}

test('resolveTeam reports found: true for a canned response with a matching team node', async () => {
  const transport = fakeTransport([teamsPage([{ id: 'team-1', key: 'CON' }])]);
  const r = await linear.resolveTeam(transport, 'k', 'CON');
  assert.deepEqual(r, { found: true });
  assert.equal(transport.calls[0].variables.teamKey, 'CON');
  assert.match(transport.calls[0].query, /teams\(filter:\s*{\s*key:\s*{\s*eq:\s*\$teamKey\s*}\s*}\)/);
});

test('resolveTeam reports found: false for an empty nodes array', async () => {
  const transport = fakeTransport([teamsPage([])]);
  const r = await linear.resolveTeam(transport, 'k', 'ABC');
  assert.deepEqual(r, { found: false });
});

test('resolveTeam defaults to httpsTransport when none is given', () => {
  // Same contract as fetchTickets — a caller that already has a team key in
  // hand should not have to thread the transport through by hand for the
  // common (real network) case. Asserted by shape only: this test never
  // actually calls the network.
  assert.equal(typeof linear.resolveTeam, 'function');
  assert.equal(linear.resolveTeam.length, 3);
});

test('resolveTeam propagates a rejected key the same way fetchTickets does', async () => {
  const transport = () => Promise.resolve({ status: 401, body: '{"errors":[{"message":"Authentication required"}]}' });
  await assert.rejects(() => linear.resolveTeam(transport, 'k', 'CON'), /LINEAR_API_KEY was rejected/);
});

test('resolveTeam propagates an HTTP error the same way fetchTickets does', async () => {
  const transport = () => Promise.resolve({ status: 500, body: 'boom' });
  await assert.rejects(() => linear.resolveTeam(transport, 'k', 'CON'), /HTTP 500/);
});

test('resolveTeam propagates a GraphQL errors array the same way fetchTickets does', async () => {
  const transport = () =>
    Promise.resolve({ status: 200, body: JSON.stringify({ errors: [{ message: 'Unknown argument key' }] }) });
  await assert.rejects(() => linear.resolveTeam(transport, 'k', 'CON'), /Unknown argument key/);
});

test('resolveTeam propagates a transport error identically to fetchTickets', async () => {
  const transport = () => Promise.reject(new Error('ECONNREFUSED'));
  await assert.rejects(() => linear.resolveTeam(transport, 'k', 'CON'), /ECONNREFUSED/);
});

test('the team query filters on key, independent of the issues query', () => {
  assert.match(linear.TEAM_QUERY, /teams\(filter:\s*{\s*key:\s*{\s*eq:\s*\$teamKey\s*}\s*}\)/);
});

// --- createTicket (CON-21) --------------------------------------------------
// The TUI's first write to Linear — deliberately narrow (issueCreate only,
// never a status-transition mutation). Two round trips: resolve the team key
// to a team UUID, then create — see linear.js's own comment on `createTicket`
// for why a single request cannot do both.

function issueCreatePage(issue) {
  return {
    status: 200,
    body: JSON.stringify({ data: { issueCreate: { success: true, issue } } }),
  };
}

test('createTicket resolves the team key then issues the creation mutation, returning the new issue', async () => {
  const transport = fakeTransport([
    teamsPage([{ id: 'team-uuid-1', key: 'CON' }]),
    issueCreatePage({ id: 'issue-uuid-1', identifier: 'CON-99', url: 'https://linear.app/x/issue/CON-99' }),
  ]);

  const result = await linear.createTicket({
    apiKey: 'k', teamKey: 'CON', title: 'Add a share button', description: 'body text', transport,
  });

  assert.deepEqual(result, { id: 'issue-uuid-1', identifier: 'CON-99', url: 'https://linear.app/x/issue/CON-99' });
  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[0].variables.teamKey, 'CON');
  assert.deepEqual(transport.calls[1].variables, {
    teamId: 'team-uuid-1', title: 'Add a share button', description: 'body text',
  });
  assert.match(transport.calls[1].query, /issueCreate\(input:/);
});

test('createTicket never calls issueCreate when the team key does not resolve', async () => {
  let calls = 0;
  const transport = fakeTransport([teamsPage([])]);
  const wrapped = (req) => { calls++; return transport(req); };
  await assert.rejects(
    () => linear.createTicket({ apiKey: 'k', teamKey: 'GHOST', title: 't', description: 'd', transport: wrapped }),
    /team "GHOST" was not found/,
  );
  assert.equal(calls, 1, 'issueCreate must never be attempted against an unresolved team');
});

test('createTicket propagates a GraphQL error from the issueCreate mutation itself', async () => {
  const transport = fakeTransport([
    teamsPage([{ id: 'team-uuid-1', key: 'CON' }]),
    { status: 200, body: JSON.stringify({ errors: [{ message: 'title cannot be blank' }] }) },
  ]);
  await assert.rejects(
    () => linear.createTicket({ apiKey: 'k', teamKey: 'CON', title: 't', description: 'd', transport }),
    /title cannot be blank/,
  );
});

test('createTicket propagates a network/transport error the same way fetchTickets does', async () => {
  const transport = () => Promise.reject(new Error('ECONNRESET'));
  await assert.rejects(
    () => linear.createTicket({ apiKey: 'k', teamKey: 'CON', title: 't', description: 'd', transport }),
    /ECONNRESET/,
  );
});

test('createTicket treats a non-success issueCreate response as a failure', async () => {
  const transport = fakeTransport([
    teamsPage([{ id: 'team-uuid-1', key: 'CON' }]),
    { status: 200, body: JSON.stringify({ data: { issueCreate: { success: false, issue: null } } }) },
  ]);
  await assert.rejects(
    () => linear.createTicket({ apiKey: 'k', teamKey: 'CON', title: 't', description: 'd', transport }),
    /did not report success/,
  );
});

test('createTicket requires teamKey, apiKey and title before ever calling the transport', async () => {
  await assert.rejects(() => linear.createTicket({ apiKey: 'k', title: 't' }), /teamKey is required/);
  await assert.rejects(() => linear.createTicket({ teamKey: 'CON', title: 't' }), /LINEAR_API_KEY is not set/);
  await assert.rejects(() => linear.createTicket({ apiKey: 'k', teamKey: 'CON' }), /title is required/);
});

test('createTicket defaults description to an empty string rather than sending undefined', async () => {
  const transport = fakeTransport([
    teamsPage([{ id: 'team-uuid-1', key: 'CON' }]),
    issueCreatePage({ id: 'i1', identifier: 'CON-1', url: 'u' }),
  ]);
  await linear.createTicket({ apiKey: 'k', teamKey: 'CON', title: 't', transport });
  assert.equal(transport.calls[1].variables.description, '');
});
