'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderLaunchPad, handleKey, render, inlineStatus, ticketsForEpic, windowStart,
  isSelectable, selectableIdentifiers, currentTicket, priorityLabel, priorityRank, sortByPriority,
  CLEAR_QUEUE_KEY,
} = require('../lib/ui/screens/launchpad');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function ticket(over) {
  return Object.assign({
    identifier: 'CON-1', title: 'spec-delta-validation', epicId: 'p1', epicName: 'Pipeline v2',
    state: { name: 'Todo', type: 'unstarted' },
  }, over);
}

const NOW = Date.now();

function cacheWith(tickets, epics) {
  return { fetchedAt: NOW - 12 * 60000, tickets, epics };
}

function lp(over) {
  return Object.assign({
    status: { enabled: true, reason: null, message: null },
    cache: cacheWith(
      [ticket({})],
      [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }],
    ),
    pane: 'tickets',
    epicIndex: 0,
    ticketIndex: 0,
    selected: new Set(),
    mode: 'parallel',
    refreshing: false,
    error: null,
    project: 'concertino',
    defaultConcurrency: 2,
  }, over);
}

const OPTS = { cols: 78, now: NOW };

// --- gate failure: visible-but-explaining, per screen -----------------------

test('a disabled gate shows the reason, not an empty screen', () => {
  const out = plain(renderLaunchPad(lp({ status: { enabled: false, reason: 'no-key', message: 'launch pad needs LINEAR_API_KEY in the environment' } }), [], OPTS));
  assert.match(out, /LINEAR_API_KEY/);
  assert.match(out, /esc back/);
});

test('each gate-failure reason renders its own distinct message', () => {
  const disabled = plain(renderLaunchPad(lp({ status: { enabled: false, reason: 'disabled', message: 'launch pad is off — set dashboard.launchPad.enabled to true in concertino.config.json' } }), [], OPTS));
  assert.match(disabled, /dashboard\.launchPad\.enabled/);

  const provider = plain(renderLaunchPad(lp({ status: { enabled: false, reason: 'provider', message: 'launch pad needs ticketProvider.kind "linear" — this project uses "github"' } }), [], OPTS));
  assert.match(provider, /ticketProvider\.kind "linear"/);

  const noKey = plain(renderLaunchPad(lp({ status: { enabled: false, reason: 'no-key', message: 'launch pad needs LINEAR_API_KEY in the environment' } }), [], OPTS));
  assert.match(noKey, /LINEAR_API_KEY in the environment/);
});

test('no key bound while the gate is off, other than esc', () => {
  const state = { lp: lp({ status: { enabled: false, reason: 'no-key', message: 'x' } }), runs: [] };
  assert.equal(handleKey('r', state), null);
  assert.equal(handleKey('N', state), null);
  assert.deepEqual(handleKey('\x1b', state), { type: 'back' });
});

// --- refreshing (CON-93 item 1) ---------------------------------------------
// The refreshing-in-progress line must be provider-neutral: renderLaunchPad
// has no ticketProvider.kind in scope (design.md Decision 1), so this must
// hold for every provider, not just local/manual.

test('the refreshing line never names Linear, regardless of provider', () => {
  const out = plain(renderLaunchPad(lp({ refreshing: true }), [], OPTS));
  assert.doesNotMatch(out, /Linear/);
  assert.match(out, /fetching tickets…/);
});

// --- cold cache --------------------------------------------------------------

test('a cold cache renders "press r to fetch" rather than an empty list', () => {
  const out = plain(renderLaunchPad(lp({ cache: { fetchedAt: null, tickets: [], epics: [] } }), [], OPTS));
  assert.match(out, /press r to fetch/);
});

test('r is the only bound key against a cold cache', () => {
  const state = { lp: lp({ cache: { fetchedAt: null, tickets: [], epics: [] } }), runs: [] };
  assert.deepEqual(handleKey('r', state), { type: 'refresh-launchpad' });
  assert.equal(handleKey('space', state), null);
  assert.equal(handleKey('L', state), null);
});

// --- CON-20: a zero-ticket fetch with an error must not be swallowed by the
// cold-cache hint. `cache.isCold` treats "zero tickets" and "never fetched"
// identically (cache.js's own comment) — exactly right for a genuinely
// empty team, but a team-not-found refresh ALSO leaves the cache at zero
// tickets, and unlike the never-fetched case it has an lp.error that must
// reach the screen.

test('a zero-ticket cache WITH an error shows the error, not "press r to fetch"', () => {
  const out = plain(renderLaunchPad(lp({
    cache: { fetchedAt: NOW, tickets: [], epics: [], teamKey: 'ABC' },
    error: 'no team with key "ABC" — check ticketProvider.teamKey',
  }), [], OPTS));
  assert.match(out, /no team with key "ABC"/);
  assert.doesNotMatch(out, /press r to fetch/);
});

test('keys are not locked to r-only when a zero-ticket cache carries an error', () => {
  const state = {
    lp: lp({
      cache: { fetchedAt: NOW, tickets: [], epics: [], teamKey: 'ABC' },
      error: 'no team with key "ABC" — check ticketProvider.teamKey',
    }),
    runs: [],
  };
  assert.deepEqual(handleKey('\x1b', state), { type: 'back' });
  assert.deepEqual(handleKey('r', state), { type: 'refresh-launchpad' });
});

test('a genuinely cold cache (no error) is unaffected by the error gate', () => {
  // Same assertion as the sibling test above, just re-confirming the
  // pre-CON-20 case (no lp.error at all) still takes the cold-cache branch.
  const out = plain(renderLaunchPad(lp({ cache: { fetchedAt: null, tickets: [], epics: [] }, error: null }), [], OPTS));
  assert.match(out, /press r to fetch/);
});

// --- inline status column: all three states ---------------------------------

test('a ticket unstarted in Linear with no live run reads its Linear state name', () => {
  const t = ticket({ state: { name: 'Todo', type: 'unstarted' } });
  assert.equal(inlineStatus(t, []), 'Todo');
});

test('a ticket already started in Linear reads "In Progress"', () => {
  const t = ticket({ state: { name: 'In Progress', type: 'started' } });
  assert.equal(inlineStatus(t, []), 'In Progress');
});

test('a ticket backed by a live run reads "▲ running", overriding Linear\'s own state', () => {
  const t = ticket({ identifier: 'CON-9', state: { name: 'Todo', type: 'unstarted' } });
  const runs = [{ ticket: 'CON-9', status: 'running' }];
  assert.equal(inlineStatus(t, runs), '▲ running');
});

test('a finished run (done/failed) does not shadow the ticket\'s Linear state', () => {
  const t = ticket({ identifier: 'CON-9', state: { name: 'Todo', type: 'unstarted' } });
  assert.equal(inlineStatus(t, [{ ticket: 'CON-9', status: 'done' }]), 'Todo');
  assert.equal(inlineStatus(t, [{ ticket: 'CON-9', status: 'failed' }]), 'Todo');
});

test('all three states render inline in the tickets pane', () => {
  const tickets = [
    ticket({ identifier: 'CON-1', title: 'todo-ticket', state: { name: 'Todo', type: 'unstarted' } }),
    ticket({ identifier: 'CON-2', title: 'in-progress-ticket', state: { name: 'In Progress', type: 'started' } }),
    ticket({ identifier: 'CON-3', title: 'running-ticket', state: { name: 'Todo', type: 'unstarted' } }),
  ];
  const state = lp({
    cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 3 }]),
  });
  const runs = [{ ticket: 'CON-3', status: 'running' }];
  const out = plain(renderLaunchPad(state, runs, OPTS));
  assert.match(out, /CON-1.*Todo/);
  assert.match(out, /CON-2.*In Progress/);
  assert.match(out, /CON-3.*▲ running/);
});

// --- a ticket already `▲ running` can never be (re-)selected ---------------
// The reviewer reproduced the consequence by hand: `tmux new-window -n CON-9`
// when a window of that name already exists succeeds and creates a SECOND
// window with the same name, after which `capture-pane`/`kill-window -t
// sess:CON-9` both fail — ambiguous target, total loss of addressability.
// isSelectable/selectableIdentifiers are the launch pad's own refusal, first
// of two independent layers (queue.tick is the second).

test('isSelectable is false for a ticket already showing "▲ running"', () => {
  const t = ticket({ identifier: 'CON-9' });
  assert.equal(isSelectable(t, [{ ticket: 'CON-9', status: 'running' }]), false);
});

test('isSelectable is true for a ticket with no live run, regardless of its Linear state', () => {
  const t = ticket({ identifier: 'CON-9', state: { name: 'In Progress', type: 'started' } });
  assert.equal(isSelectable(t, []), true);
  assert.equal(isSelectable(t, [{ ticket: 'CON-9', status: 'done' }]), true);
  assert.equal(isSelectable(t, [{ ticket: 'CON-9', status: 'failed' }]), true);
});

test('selectableIdentifiers drops only the tickets that are live, keeping the rest', () => {
  const tickets = [
    ticket({ identifier: 'CON-1' }),
    ticket({ identifier: 'CON-9' }),
    ticket({ identifier: 'CON-2' }),
  ];
  const runs = [{ ticket: 'CON-9', status: 'running' }];
  assert.deepEqual(selectableIdentifiers(tickets, runs), ['CON-1', 'CON-2']);
});

test('space does not select a ticket already running — toggle-select is refused at the launch pad, not just the queue', () => {
  // toggle-select itself only describes the keypress (watch.js owns the
  // mutation and consults isSelectable before touching lp.selected) — this
  // pins the contract isSelectable exists to serve: the action fires either
  // way, but watch.js must check isSelectable before acting on it.
  const t = ticket({ identifier: 'CON-9' });
  const runs = [{ ticket: 'CON-9', status: 'running' }];
  assert.deepEqual(handleKey(' ', { lp: lp({ pane: 'tickets' }), runs }), { type: 'toggle-select' });
  assert.equal(isSelectable(t, runs), false, 'watch.js must refuse to add CON-9 to lp.selected');
});

// --- CON-41: inline "⏳ queued" status ---------------------------------------
// inlineStatus(ticket, runs, queueState) now also consults the active queue —
// a ticket present in queueState.pending/inFlight, with no live run yet,
// must render distinctly from both "▲ running" and its plain Linear state.

test('a ticket present in queueState.pending (no live run) reads "⏳ queued"', () => {
  const t = ticket({ identifier: 'CON-9', state: { name: 'Todo', type: 'unstarted' } });
  const queueState = { pending: ['CON-9'], inFlight: new Set() };
  assert.equal(inlineStatus(t, [], queueState), '⏳ queued');
});

test('a ticket present in queueState.inFlight but with no matching entry in runs yet still reads "⏳ queued"', () => {
  const t = ticket({ identifier: 'CON-9', state: { name: 'Todo', type: 'unstarted' } });
  const queueState = { pending: [], inFlight: new Set(['CON-9']) };
  assert.equal(inlineStatus(t, [], queueState), '⏳ queued');
});

test('a ticket with a live run AND present in queueState.inFlight reads "▲ running" — a live run always wins', () => {
  const t = ticket({ identifier: 'CON-9', state: { name: 'Todo', type: 'unstarted' } });
  const runs = [{ ticket: 'CON-9', status: 'running' }];
  const queueState = { pending: [], inFlight: new Set(['CON-9']) };
  assert.equal(inlineStatus(t, runs, queueState), '▲ running');
});

test('a ticket absent from the queue is computed exactly as before — live run, then Linear state', () => {
  const t = ticket({ identifier: 'CON-9', state: { name: 'In Progress', type: 'started' } });
  const queueState = { pending: ['CON-1', 'CON-2'], inFlight: new Set(['CON-3']) };
  assert.equal(inlineStatus(t, [], queueState), 'In Progress');
  assert.equal(inlineStatus(t, [], null), 'In Progress', 'no queue at all behaves identically to the pre-CON-41 two-arg call');
});

test('ticketRow renders "⏳ queued" using STATUS_COLOUR.queued (dim), distinct from "▲ running"\'s cyan', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const tickets = [ticket({ identifier: 'CON-1', state: { name: 'Todo', type: 'unstarted' }, priority: 2 })];
    const state = lp({
      pane: 'tickets',
      ticketIndex: 0,
      cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]),
    });
    const queueState = { pending: ['CON-1'], inFlight: new Set() };
    const out = renderColoured(state, [], Object.assign({}, OPTS, { queueState }));
    const plainOut = plain(out);
    assert.match(plainOut, /⏳ queued/);
    // dim (2), never cyan (36 basic / 38;5;80 256-colour) — "queued" must be
    // visually distinct from "▲ running" (STATUS_COLOUR.running).
    assert.match(out, /\x1b\[2m⏳ queued/, 'queued status should be dim (STATUS_COLOUR.queued)');
    assert.doesNotMatch(out, /\x1b\[(36m|38;5;80m)⏳ queued/, 'queued status should not be cyan (that is running\'s colour)');
  });
});

// --- CON-41: an already-queued ticket cannot be (re-)selected --------------
// Mirrors the pre-existing "▲ running" refusal tests above exactly —
// isSelectable(ticket, runs, queueState) extends the same refusal to a
// ticket already present in queueState.pending/inFlight.

test('isSelectable is false for a ticket already present in queueState.pending', () => {
  const t = ticket({ identifier: 'CON-9' });
  const queueState = { pending: ['CON-9'], inFlight: new Set() };
  assert.equal(isSelectable(t, [], queueState), false);
});

test('isSelectable is false for a ticket already present in queueState.inFlight', () => {
  const t = ticket({ identifier: 'CON-9' });
  const queueState = { pending: [], inFlight: new Set(['CON-9']) };
  assert.equal(isSelectable(t, [], queueState), false);
});

test('isSelectable ignores queueState entirely when the third argument is omitted — every pre-CON-41 two-arg call site is unaffected', () => {
  const t = ticket({ identifier: 'CON-9' });
  assert.equal(isSelectable(t, []), true);
});

test('selectableIdentifiers drops an already-queued ticket, exactly as it already drops an already-running one', () => {
  const tickets = [
    ticket({ identifier: 'CON-1' }),
    ticket({ identifier: 'CON-9' }),  // queued
    ticket({ identifier: 'CON-2' }),
    ticket({ identifier: 'CON-3' }),  // running
  ];
  const runs = [{ ticket: 'CON-3', status: 'running' }];
  const queueState = { pending: ['CON-9'], inFlight: new Set() };
  assert.deepEqual(selectableIdentifiers(tickets, runs, queueState), ['CON-1', 'CON-2']);
});

// --- CON-41: 'q' add-to-queue key ------------------------------------------

test('q on the tickets pane returns the add-to-queue action', () => {
  const state = { lp: lp({ pane: 'tickets' }), runs: [] };
  assert.deepEqual(handleKey('q', state), { type: 'add-to-queue' });
});

test('q is not bound while the epics pane has focus', () => {
  const state = { lp: lp({ pane: 'epics' }), runs: [] };
  assert.equal(handleKey('q', state), null);
});

// --- CON-41: hints line advertises 'q add to queue' only when it would do
// something, matching the existing "only hint a key that currently does
// something" discipline the L/clear-queue hints already follow -------------

test('the hints line shows "q add to queue" when the highlighted ticket is eligible', () => {
  const t = ticket({ identifier: 'CON-1', state: { name: 'Todo', type: 'unstarted' } });
  const state = lp({
    cache: cacheWith([t], [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]),
    pane: 'tickets',
    ticketIndex: 0,
  });
  const out = plain(renderLaunchPad(state, [], OPTS));
  assert.match(out, /q add to queue/);
});

test('the hints line omits "q add to queue" when the highlighted ticket is already "▲ running"', () => {
  const t = ticket({ identifier: 'CON-1', state: { name: 'Todo', type: 'unstarted' } });
  const state = lp({
    cache: cacheWith([t], [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]),
    pane: 'tickets',
    ticketIndex: 0,
  });
  const runs = [{ ticket: 'CON-1', status: 'running' }];
  const out = plain(renderLaunchPad(state, runs, OPTS));
  assert.doesNotMatch(out, /q add to queue/);
});

test('the hints line omits "q add to queue" when the highlighted ticket is already "⏳ queued"', () => {
  const t = ticket({ identifier: 'CON-1', state: { name: 'Todo', type: 'unstarted' } });
  const state = lp({
    cache: cacheWith([t], [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]),
    pane: 'tickets',
    ticketIndex: 0,
  });
  const out = plain(renderLaunchPad(state, [], Object.assign({}, OPTS, { queueState: { pending: ['CON-1'], inFlight: new Set() } })));
  assert.match(out, /⏳ queued/, 'sanity: the row itself must show queued');
  assert.doesNotMatch(out, /q add to queue/);
});

// --- hostile Linear free text: OSC/CSI/control bytes never reach the render -
// launchpad.js renders every visible ticket TITLE straight from Linear —
// editable by anyone with tracker write access. See lib/ui/format.js's
// stripUnsafeControls, the single choke point every screen's render already
// funnels through (ticketRow's line is truncated both directly and again in
// renderLaunchPad's final map).

test('a ticket title carrying an OSC (window-title) sequence is neutralised in the tickets pane', () => {
  const hostile = [ticket({ identifier: 'CON-1', title: 'innocuous' + '\x1b]0;pwned\x07' + '-title' })];
  const state = lp({ cache: cacheWith(hostile, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  // Wider than OPTS.cols: bordering the tickets pane (design.md Decision 1)
  // costs it border+padding columns that did not exist before this change,
  // so the full title needs a little more room to stay untruncated — the
  // assertion itself (the title survives whole) is unchanged.
  const out = renderLaunchPad(state, [], { cols: 90, now: NOW });
  assert.doesNotMatch(out, /\x1b\]/);
  assert.match(plain(out), /innocuous-title/);
});

// --- epics pane, including the unassigned bucket ----------------------------

test('the unassigned epic bucket renders distinctly, not as "null"', () => {
  const state = lp({
    cache: cacheWith(
      [ticket({ epicId: null, epicName: null })],
      [{ id: null, name: null, openCount: 1 }],
    ),
  });
  const out = plain(renderLaunchPad(state, [], OPTS));
  assert.match(out, /─ unassigned ─/);
  assert.doesNotMatch(out, /\bnull\b/);
});

test('ticketsForEpic filters to the epic at epicIndex, including the unassigned bucket', () => {
  const tickets = [
    ticket({ identifier: 'CON-1', epicId: 'p1' }),
    ticket({ identifier: 'CON-2', epicId: null }),
  ];
  const state = lp({
    cache: cacheWith(tickets, [
      { id: 'p1', name: 'Pipeline v2', openCount: 1 },
      { id: null, name: null, openCount: 1 },
    ]),
    epicIndex: 1,
  });
  assert.deepEqual(ticketsForEpic(state).map((t) => t.identifier), ['CON-2']);
});

// --- selection and header ----------------------------------------------------

test('the header shows total open count and cache age', () => {
  const out = plain(renderLaunchPad(lp({}), [], OPTS));
  assert.match(out, /1 open/);
  assert.match(out, /fetched 12m ago/);
});

// --- CON-20: header distinguishes a real-but-empty team from a not-found one

test('a real team with zero open tickets says so by name in the header', () => {
  const out = plain(renderLaunchPad(lp({
    cache: { fetchedAt: NOW, tickets: [], epics: [], teamKey: 'CON' },
    error: null,
  }), [], OPTS));
  assert.match(out, /no open tickets in CON/);
  assert.doesNotMatch(out, /\b0 open\b/);
});

// Evaluator (evaluation-1.md) Change Request 1/2: `cache.isCold` treats
// "fetchedAt set, zero tickets" identically to "never fetched" BY DESIGN
// (cache.js's own comment), so the cold-cache branch used to ALSO fire for
// this exact state — a real fetch that confirmed the team and legitimately
// found nothing — rendering "no tickets cached yet — press r to fetch"
// directly under a header that already said `fetched 0s ago`, a visible
// self-contradiction. Gating on `lp.cache.fetchedAt == null` instead fixes
// it: this state falls through to the normal render, where the header's own
// "no open tickets in CON" (asserted in the sibling test above) is the only
// thing said about it.
test('a real, confirmed-empty team does NOT also show "press r to fetch" under its header', () => {
  const out = plain(renderLaunchPad(lp({
    cache: { fetchedAt: NOW, tickets: [], epics: [], teamKey: 'CON' },
    error: null,
  }), [], OPTS));
  assert.doesNotMatch(out, /press r to fetch/);
  assert.doesNotMatch(out, /no tickets cached yet/);
});

test('keys are not locked to r-only for a real, confirmed-empty team — only a genuinely never-fetched cache locks the keymap', () => {
  const confirmedEmpty = { lp: lp({ cache: { fetchedAt: NOW, tickets: [], epics: [], teamKey: 'CON' }, error: null }), runs: [] };
  assert.deepEqual(handleKey('\t', confirmedEmpty), { type: 'switch-pane', pane: 'epics' },
    'a key other than r/esc must reach the ordinary handlers once a real fetch confirmed the team');
  assert.deepEqual(handleKey('r', confirmedEmpty), { type: 'refresh-launchpad' });

  const neverFetched = { lp: lp({ cache: { fetchedAt: null, tickets: [], epics: [] } }), runs: [] };
  assert.equal(handleKey('\t', neverFetched), null, 'a genuinely cold cache still locks the keymap to r-only');
});

test('a team-not-found error keeps the header\'s default count — the error line explains it', () => {
  const out = plain(renderLaunchPad(lp({
    cache: { fetchedAt: NOW, tickets: [], epics: [], teamKey: 'ABC' },
    error: 'no team with key "ABC" — check ticketProvider.teamKey',
  }), [], OPTS));
  // Never claims a team key that did not resolve is real.
  assert.doesNotMatch(out, /no open tickets in ABC/);
  assert.match(out, /no team with key "ABC" — check ticketProvider\.teamKey/);
});

test('a non-empty fetch always shows the numeric count, never the team message', () => {
  const out = plain(renderLaunchPad(lp({}), [], OPTS));
  assert.doesNotMatch(out, /no open tickets in/);
});

test('a checked ticket renders [x], an unchecked one [ ]', () => {
  // The priority column now sits between the checkbox and the identifier
  // (design.md Decision 3), so "[x]" and "CON-1" are no longer adjacent —
  // this asserts the checkbox itself, ordered ahead of the identifier.
  const selected = new Set(['CON-1']);
  const out = plain(renderLaunchPad(lp({ selected }), [], OPTS));
  assert.match(out, /\[x\][^\n]*CON-1/);
});

test('the footer omits "L launch" until something is selected', () => {
  const none = plain(renderLaunchPad(lp({ selected: new Set() }), [], OPTS));
  assert.doesNotMatch(none, /L launch/);
  const some = plain(renderLaunchPad(lp({ selected: new Set(['CON-1']) }), [], OPTS));
  assert.match(some, /L launch/);
});

test('L does nothing (and is not advertised) with nothing selected', () => {
  const state = { lp: lp({ selected: new Set() }), runs: [] };
  assert.equal(handleKey('L', state), null);
});

test('L opens the launch plan once something is selected', () => {
  const state = { lp: lp({ selected: new Set(['CON-1']) }), runs: [] };
  assert.deepEqual(handleKey('L', state), { type: 'open-launchplan' });
});

// --- Clear Queue: reachable here too, not just from the fleet view ---------

test('C opens the clear-queue confirmation when a queue with pending tickets exists', () => {
  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1 };
  const state = { lp: lp({}), runs: [], queueState };
  assert.deepEqual(handleKey(CLEAR_QUEUE_KEY, state), { type: 'open-clear-queue-confirm' });
});

test('C is a no-op with no queue, or a queue with nothing pending', () => {
  assert.equal(handleKey(CLEAR_QUEUE_KEY, { lp: lp({}), runs: [] }), null);
  const emptyQueue = { pending: [], inFlight: new Set(['CON-1']), maxConcurrent: 1 };
  assert.equal(handleKey(CLEAR_QUEUE_KEY, { lp: lp({}), runs: [], queueState: emptyQueue }), null);
});

test('y confirms clear-queue, even with lp absent', () => {
  assert.deepEqual(handleKey('y', { lp: null, runs: [], clearQueueConfirm: true }), { type: 'confirm-clear-queue' });
});

test('any other key cancels clear-queue without navigating back', () => {
  const state = { lp: lp({}), runs: [], clearQueueConfirm: true };
  assert.deepEqual(handleKey('\x1b', state), { type: 'cancel-clear-queue' });
  assert.deepEqual(handleKey('a', state), { type: 'cancel-clear-queue' });
});

test('the clear-queue confirmation names the exact pending count', () => {
  const queueState = { pending: ['CON-2', 'CON-3'], inFlight: new Set(), maxConcurrent: 1 };
  const out = plain(renderLaunchPad(lp({}), [], { ...OPTS, queueState, clearQueueConfirm: true }));
  assert.match(out, /this will drop 2 queued tickets — they will never start\. proceed\?/);
  assert.match(out, /y confirm clear/);
});

test('the footer advertises C clear queue only when a queue with pending tickets exists', () => {
  const withoutQueue = plain(renderLaunchPad(lp({}), [], OPTS));
  assert.doesNotMatch(withoutQueue, /C clear queue/);

  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1 };
  const withQueue = plain(renderLaunchPad(lp({}), [], { ...OPTS, queueState }));
  assert.match(withQueue, /C clear queue/);

  const emptyQueue = { pending: [], inFlight: new Set(['CON-1']), maxConcurrent: 1 };
  const withEmptyQueue = plain(renderLaunchPad(lp({}), [], { ...OPTS, queueState: emptyQueue }));
  assert.doesNotMatch(withEmptyQueue, /C clear queue/);
});

test('render(state, opts) forwards queueState/clearQueueConfirm off the full state object', () => {
  const queueState = { pending: ['CON-2'], inFlight: new Set(), maxConcurrent: 1 };
  const out = plain(render({ launchPad: lp({}), runs: [], queueState, clearQueueConfirm: true }, OPTS));
  assert.match(out, /this will drop 1 queued ticket — /);
});

// --- key handling -------------------------------------------------------------

test('space toggles selection only in the tickets pane', () => {
  assert.deepEqual(handleKey(' ', { lp: lp({ pane: 'tickets' }), runs: [] }), { type: 'toggle-select' });
  assert.equal(handleKey(' ', { lp: lp({ pane: 'epics' }), runs: [] }), null);
});

test('enter opens the ticket viewer only in the tickets pane', () => {
  assert.deepEqual(handleKey('\r', { lp: lp({ pane: 'tickets' }), runs: [] }), { type: 'open-ticketview' });
  assert.equal(handleKey('\r', { lp: lp({ pane: 'epics' }), runs: [] }), null);
});

test('s and p set the mode', () => {
  assert.deepEqual(handleKey('s', { lp: lp({}), runs: [] }), { type: 'set-mode', mode: 'sequential' });
  assert.deepEqual(handleKey('p', { lp: lp({}), runs: [] }), { type: 'set-mode', mode: 'parallel' });
});

test('j/k move within the focused pane', () => {
  assert.deepEqual(handleKey('j', { lp: lp({}), runs: [] }), { type: 'move-launchpad', delta: 1 });
  assert.deepEqual(handleKey('k', { lp: lp({}), runs: [] }), { type: 'move-launchpad', delta: -1 });
});

test('left/right arrows switch panes', () => {
  assert.deepEqual(handleKey('\x1b[D', { lp: lp({}), runs: [] }), { type: 'switch-pane', pane: 'epics' });
  assert.deepEqual(handleKey('\x1b[C', { lp: lp({}), runs: [] }), { type: 'switch-pane', pane: 'tickets' });
});

test('esc backs out to the fleet', () => {
  assert.deepEqual(handleKey('\x1b', { lp: lp({}), runs: [] }), { type: 'back' });
});

test('an unbound key is a no-op', () => {
  assert.equal(handleKey('z', { lp: lp({}), runs: [] }), null);
});

test('refreshing ignores further keys except the escape hatch', () => {
  const state = { lp: lp({ refreshing: true }), runs: [] };
  assert.equal(handleKey('r', state), null);
  assert.equal(handleKey('j', state), null);
  assert.deepEqual(handleKey('\x1b', state), { type: 'back' });
});

// --- windowStart: scroll centring, clamped at the ends ----------------------

test('windowStart does not scroll when everything already fits', () => {
  assert.equal(windowStart(0, 5, 10), 0);
});

test('windowStart clamps at the top', () => {
  assert.equal(windowStart(0, 20, 5), 0);
});

test('windowStart clamps at the bottom', () => {
  assert.equal(windowStart(19, 20, 5), 15);
});

// --- focus vs. selection: the only screen with a real pane-switch key ------
// design.md Decision 2 / spec.md's "Focus is visually unambiguous on multi-
// pane screens": the launch pad is the ONLY screen where a keypress (Tab,
// left/right arrow) routes to one of two panes, so it is the only screen
// where the heavier/focused border set is ever drawn at all.

test('the tickets pane is drawn with the heavier border set when it has focus', () => {
  const out = renderLaunchPad(lp({ pane: 'tickets' }), [], OPTS);
  assert.match(out, /┏/);
  assert.match(out, /┓/);
  assert.match(out, /┃/);
});

test('the epics pane is drawn with the heavier border set when it has focus, tickets plain', () => {
  const out = renderLaunchPad(lp({ pane: 'epics' }), [], OPTS);
  const lines = out.split('\n');
  const topBorderRow = lines.find((l) => l.includes('EPICS'));
  assert.match(topBorderRow, /^┏/, 'epics (focused) should use the heavy border');
  assert.match(topBorderRow, /┌/, 'tickets (unfocused) should still use the plain border');
});

test('focus distinction survives a colourless terminal — different characters, not just colour', () => {
  assert.ok(!process.stdout.isTTY, 'this test relies on running under node --test, where isTTY is false');
  const ticketsFocused = renderLaunchPad(lp({ pane: 'tickets' }), [], OPTS);
  const epicsFocused = renderLaunchPad(lp({ pane: 'epics' }), [], OPTS);
  assert.notEqual(ticketsFocused, epicsFocused);
  assert.match(ticketsFocused, /┃/);
  assert.match(epicsFocused, /┏/);
});

// --- CON-42: icon vocabulary ------------------------------------------------

test('the EPICS pane title is prefixed with the epics icon', () => {
  const icons = require('../lib/ui/icons');
  const out = plain(renderLaunchPad(lp({ pane: 'tickets' }), [], OPTS));
  assert.match(out, new RegExp(icons.epics + ' EPICS'));
});

test('the right (tickets) pane title carries no new icon — it renders the current epic\'s name, not a static "tickets" label', () => {
  const icons = require('../lib/ui/icons');
  const out = plain(renderLaunchPad(lp({ pane: 'tickets' }), [], OPTS));
  assert.match(out, /Pipeline v2/);
  // None of this change's icons should prefix the epic-name title.
  for (const glyph of Object.values(icons)) {
    assert.doesNotMatch(out, new RegExp(glyph + ' Pipeline v2'));
  }
});

// --- selected row recedes (dims) in the unfocused pane, never disappears ---

// bold/dim are no-ops under `!isTTY` (see format.js's `wrap`), so these three
// force isTTY the same way format-colour.test.js/drilldown.test.js's "role
// gutter" test do: set it true, clear the require cache, require fresh,
// reset it afterwards so nothing else in this file is affected.

function withColour(fn) {
  process.stdout.isTTY = true;
  delete process.env.TERM;
  delete process.env.COLORTERM;
  for (const m of ['../lib/ui/format', '../lib/ui/layout', '../lib/ui/screens/launchpad']) {
    delete require.cache[require.resolve(m)];
  }
  const launchpad = require('../lib/ui/screens/launchpad');
  try {
    fn(launchpad);
  } finally {
    process.stdout.isTTY = false;
    for (const m of ['../lib/ui/format', '../lib/ui/layout', '../lib/ui/screens/launchpad']) {
      delete require.cache[require.resolve(m)];
    }
  }
}

test('the epic selection marker survives when focus moves to tickets, but recedes (dim, not bold)', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const tickets = [ticket({ identifier: 'CON-1' }), ticket({ identifier: 'CON-2' })];
    const state = lp({
      pane: 'tickets',
      cache: cacheWith(tickets, [
        { id: 'p1', name: 'Pipeline v2', openCount: 2 },
        { id: 'p2', name: 'Second epic', openCount: 0 },
      ]),
      epicIndex: 0,
    });
    const out = renderColoured(state, [], OPTS);
    const plainOut = plain(out);
    // The marker for the current epic (index 0) is still present...
    assert.match(plainOut, /▸ Pipeline v2/);
    // ...but dimmed (2), never bold (1), since the epics pane does not have
    // keyboard focus right now.
    // The line also carries the focused (tickets) box's own bold+cyan
    // BORDER colour, so the assertion below is scoped to the epic row's own
    // wrapping, not "no bold escape anywhere on this joined hsplit() line".
    const markerLine = out.split('\n').find((l) => plain(l).includes('▸ Pipeline v2'));
    assert.match(markerLine, /\x1b\[2m ▸ Pipeline v2/, 'unfocused selection should be dim');
    assert.doesNotMatch(markerLine, /\x1b\[1m ▸ Pipeline v2/, 'unfocused selection should not be bold');
  });
});

test('the ticket selection marker survives when focus moves to epics, rather than disappearing outright', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const tickets = [ticket({ identifier: 'CON-1' }), ticket({ identifier: 'CON-2' })];
    const state = lp({
      pane: 'epics',
      cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 2 }]),
      ticketIndex: 1,
    });
    const out = renderColoured(state, [], OPTS);
    // Before this change, the ticket row's marker itself was gated on
    // `lp.pane === 'tickets'` — moving focus to epics made the current
    // ticket selection vanish outright rather than recede (dim). It must
    // still show.
    const markerLine = out.split('\n').find((l) => plain(l).includes('CON-2'));
    assert.match(plain(markerLine), /▸/, 'the ticket marker must survive, not disappear, when tickets loses focus');
    assert.match(markerLine, /\x1b\[2m/, 'unfocused ticket selection should be dim');
  });
});

test('the focused pane\'s own selection gets fill (background highlight), not dim', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const state = lp({ pane: 'tickets', ticketIndex: 0 });
    const out = renderColoured(state, [], OPTS);
    const markerLine = out.split('\n').find((l) => plain(l).includes('CON-1'));
    assert.match(markerLine, /\x1b\[7m/, 'CR4: the focused pane\'s selection should have fill (SGR 7), not bold (SGR 1)');
  });
});

// --- snapshot widths, wide characters, borders + colour together (task 6.2) -
// Same treatment as fleet.test.js's identical test: isTTY forced so both
// panes' border colouring (the focused pane's bold+cyan) and the coloured
// "▲ running" status are actually exercised, across several widths, with a
// wide (CJK) epic/ticket title.

test('at 60/80/100/120 cols, a bordered, coloured, wide-character (CJK) launch-pad render stays in budget', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const f = require('../lib/ui/format');
    const tickets = [
      ticket({
        identifier: 'CON-1', title: '日本語のとても長いチケットタイトルのテストです',
        epicId: 'p1', epicName: '日本語のエピック名',
        state: { name: 'Todo', type: 'unstarted' },
      }),
      ticket({ identifier: 'CON-2', title: 'second-ticket', epicId: 'p1' }),
    ];
    const state = lp({
      pane: 'tickets',
      cache: cacheWith(tickets, [{ id: 'p1', name: '日本語のエピック名のテスト', openCount: 2 }]),
    });
    for (const cols of [60, 80, 100, 120]) {
      const out = renderColoured(state, [{ ticket: 'CON-2', status: 'running' }], { cols, now: NOW });
      assert.match(out, /\x1b\[/, `cols:${cols} should still be emitting colour under isTTY`);
      for (const line of out.split('\n')) {
        assert.ok(f.visibleLength(line) <= cols,
          `cols:${cols} line is ${f.visibleLength(line)} wide: ${JSON.stringify(line)}`);
      }
    }
  });
});

// --- router seam --------------------------------------------------------------

test('render(state, opts) reads launchPad off the full state object', () => {
  const state = { launchPad: lp({}), runs: [] };
  const out = plain(render(state, OPTS));
  assert.match(out, /NEW RUN/);
});

// --- width discipline ----------------------------------------------------------

test('no rendered line exceeds opts.cols', () => {
  const tickets = [
    ticket({ identifier: 'CON-1', title: 'an-extremely-long-ticket-title-that-will-not-fit-anywhere-at-all-in-a-narrow-terminal' }),
  ];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'a-very-long-epic-name-indeed-that-keeps-going', openCount: 1 }]) });
  for (const cols of [50, 60, 78, 100, 120]) {
    const out = renderLaunchPad(state, [], { cols, now: Date.now() });
    for (const line of out.split('\n')) {
      const { visibleLength } = require('../lib/ui/format');
      assert.ok(visibleLength(line) <= cols, `cols:${cols} line is ${visibleLength(line)} wide: ${JSON.stringify(line)}`);
    }
  }
});

// --- priority column (CON-35) -------------------------------------------------

test('each priority value renders a distinct label, and unknown is distinct from None', () => {
  assert.equal(priorityLabel(0), 'None');
  assert.equal(priorityLabel(1), 'Urg');
  assert.equal(priorityLabel(2), 'High');
  assert.equal(priorityLabel(3), 'Med');
  assert.equal(priorityLabel(4), 'Low');
  assert.equal(priorityLabel(null), null);
  assert.equal(priorityLabel(undefined), null);
  // No two distinct priority values collide on the same label.
  const labels = [0, 1, 2, 3, 4].map(priorityLabel);
  assert.equal(new Set(labels).size, labels.length);
});

test('priority renders in the tickets pane, and unknown is visibly distinct from None', () => {
  const tickets = [
    ticket({ identifier: 'CON-1', title: 'urgent-ticket', priority: 1 }),
    ticket({ identifier: 'CON-2', title: 'none-ticket', priority: 0 }),
    ticket({ identifier: 'CON-3', title: 'unknown-ticket', priority: null }),
  ];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 3 }]) });
  const out = plain(renderLaunchPad(state, [], { cols: 100, now: NOW }));
  assert.match(out, /Urg[^\n]*CON-1/);
  assert.match(out, /None[^\n]*CON-2/);
  assert.match(out, /\?[^\n]*CON-3/);
});

test('the status column is not truncated by the new fixed-width priority budget', () => {
  const tickets = [
    ticket({ identifier: 'CON-1', title: 'in-progress-ticket', priority: 2, state: { name: 'In Progress', type: 'started' } }),
  ];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  const out = plain(renderLaunchPad(state, [], { cols: 90, now: NOW }));
  // The full status string must survive whole, not clipped to "In Progres…"
  // — the exact defect ticketRow's own header comment calls out.
  assert.match(out, /In Progress/);
  assert.doesNotMatch(out, /In Progres…/);
});

test('priorityRank ranks Urgent < High < Medium < Low < None < unknown', () => {
  assert.ok(priorityRank(1) < priorityRank(2));
  assert.ok(priorityRank(2) < priorityRank(3));
  assert.ok(priorityRank(3) < priorityRank(4));
  assert.ok(priorityRank(4) < priorityRank(0));
  assert.ok(priorityRank(0) < priorityRank(null));
  assert.ok(priorityRank(0) < priorityRank(undefined));
});

test('sortByPriority ranks priority 1 (Urgent) ahead of priority 0 (None), not by raw integer', () => {
  const tickets = [ticket({ identifier: 'CON-1', priority: 0 }), ticket({ identifier: 'CON-2', priority: 1 })];
  assert.deepEqual(sortByPriority(tickets).map((t) => t.identifier), ['CON-2', 'CON-1']);
});

test('P returns a toggle-ticket-sort action', () => {
  assert.deepEqual(handleKey('P', { lp: lp({}), runs: [] }), { type: 'toggle-ticket-sort' });
});

test('renderLaunchPad sorts priority-1 ahead of priority-0 when lp.ticketSort is "priority"', () => {
  const tickets = [
    ticket({ identifier: 'CON-1', title: 'none-ticket', priority: 0 }),
    ticket({ identifier: 'CON-2', title: 'urgent-ticket', priority: 1 }),
  ];
  const state = lp({
    cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 2 }]),
    ticketSort: 'priority',
  });
  const out = plain(renderLaunchPad(state, [], { cols: 100, now: NOW }));
  const idxUrgent = out.indexOf('CON-2');
  const idxNone = out.indexOf('CON-1');
  assert.ok(idxUrgent >= 0 && idxNone >= 0 && idxUrgent < idxNone, 'CON-2 (Urgent) must render ahead of CON-1 (None)');
});

test('ticketsForEpic defaults to identifier order when lp.ticketSort is unset', () => {
  const tickets = [ticket({ identifier: 'CON-2', priority: 1 }), ticket({ identifier: 'CON-1', priority: 0 })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 2 }]) });
  assert.deepEqual(ticketsForEpic(state).map((t) => t.identifier), ['CON-2', 'CON-1']);
});

// --- inline detail pane (CON-35) ----------------------------------------------

test('the detail pane shows the selected ticket\'s title and description', () => {
  const tickets = [ticket({ identifier: 'CON-1', title: 'first-ticket', description: 'first ticket body' })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  const out = plain(renderLaunchPad(state, [], OPTS));
  assert.match(out, /DESCRIPTION/);
  assert.match(out, /first ticket body/);
});

test('the detail pane content changes when lp.ticketIndex moves', () => {
  const tickets = [
    ticket({ identifier: 'CON-1', title: 'first-ticket', description: 'first ticket body' }),
    ticket({ identifier: 'CON-2', title: 'second-ticket', description: 'second ticket body' }),
  ];
  const epics = [{ id: 'p1', name: 'Pipeline v2', openCount: 2 }];
  const first = plain(renderLaunchPad(lp({ cache: cacheWith(tickets, epics), ticketIndex: 0 }), [], OPTS));
  const second = plain(renderLaunchPad(lp({ cache: cacheWith(tickets, epics), ticketIndex: 1 }), [], OPTS));
  assert.match(first, /first ticket body/);
  assert.doesNotMatch(first, /second ticket body/);
  assert.match(second, /second ticket body/);
  assert.doesNotMatch(second, /first ticket body/);
});

test('an empty description in the detail pane says so explicitly, not blank', () => {
  const tickets = [ticket({ identifier: 'CON-1', description: '' })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  const out = plain(renderLaunchPad(state, [], OPTS));
  assert.match(out, /\(no description\)/);
});

test('a truncated comment thread stays visible in the inline detail pane', () => {
  const tickets = [ticket({
    identifier: 'CON-1',
    comments: [{ author: 'matt', body: 'first of many', createdAt: 1000 }],
    commentCount: 214,
    commentsTruncated: true,
  })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  const out = plain(renderLaunchPad(state, [], OPTS));
  assert.match(out, /showing 1 of 214/);
});

test('an empty ticket list renders "no ticket selected", not a blank or stale pane', () => {
  // The cache is not cold overall (it has a ticket, under a DIFFERENT epic) —
  // this exercises "the CURRENT epic has no open tickets", not "no tickets
  // cached yet", which is a distinct, earlier-returning code path.
  const tickets = [ticket({ identifier: 'CON-1', epicId: 'p1' })];
  const epics = [
    { id: 'p1', name: 'Pipeline v2', openCount: 1 },
    { id: 'p2', name: 'Empty epic', openCount: 0 },
  ];
  const state = lp({ cache: cacheWith(tickets, epics), epicIndex: 1 });
  const out = plain(renderLaunchPad(state, [], OPTS));
  assert.match(out, /no ticket selected/);
});

test('currentTicket resolves the tickets pane\'s current selection, null when the epic has no tickets', () => {
  const tickets = [ticket({ identifier: 'CON-1' })];
  const withTicket = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  assert.equal(currentTicket(withTicket).identifier, 'CON-1');

  const empty = lp({ cache: cacheWith([], [{ id: 'p1', name: 'Pipeline v2', openCount: 0 }]) });
  assert.equal(currentTicket(empty), null);
});

test('the detail pane renders at full content height when opts.rows is unbounded (0 or absent)', () => {
  const tickets = [ticket({ identifier: 'CON-1', description: 'the-unbounded-description-marker' })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  const absent = plain(renderLaunchPad(state, [], { cols: 78, now: NOW }));
  const zero = plain(renderLaunchPad(state, [], { cols: 78, now: NOW, rows: 0 }));
  assert.match(absent, /the-unbounded-description-marker/);
  assert.match(zero, /the-unbounded-description-marker/);
});

test('the detail pane is omitted on a short opts.rows, and the epics/tickets pane still renders at its normal budget', () => {
  const tickets = [ticket({ identifier: 'CON-1', description: 'the-should-be-omitted-marker' })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  const out = plain(renderLaunchPad(state, [], { cols: 78, now: NOW, rows: 10 }));
  assert.doesNotMatch(out, /the-should-be-omitted-marker/);
  // The tickets pane itself must still show — it is the detail pane that
  // yields, never the list (design.md Decision 4).
  assert.match(out, /CON-1/);
});

test('the detail pane renders at full height when the terminal is generously sized', () => {
  const tickets = [ticket({ identifier: 'CON-1', description: 'the-should-render-marker' })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  const out = plain(renderLaunchPad(state, [], { cols: 78, now: NOW, rows: 60 }));
  assert.match(out, /the-should-render-marker/);
});

// --- lazygit-layout pass: detail pane grows to fill available height ------

test('with vertical space to spare, the detail pane grows to push the footer to the last row', () => {
  const tickets = [ticket({ identifier: 'CON-1', description: 'short' })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  // cols widened from the file's usual 78 to 100 (CON-41): this test's own
  // concern is purely VERTICAL (the footer's row position), and the tickets
  // pane's own eligible ticket now legitimately adds a 'q add to queue' hint
  // to that footer's single line — 78 cols was already tight enough that a
  // fully-eligible, unqueued, unselected ticket's hints line would truncate
  // 'esc back' off the end regardless of this test's own intent.
  const out = plain(renderLaunchPad(state, [], { cols: 100, now: NOW, rows: 40 }));
  const lines = out.split('\n');
  assert.match(lines[lines.length - 1], /esc back/);
  assert.ok(lines.length <= 40, `expected at most 40 lines, got ${lines.length}`);
  assert.ok(lines.length >= 30, `expected the frame to grow toward the 40-row budget, got only ${lines.length} lines`);
});

test('with no rows budget given, the detail pane stays tight to content exactly as before this change', () => {
  const tickets = [ticket({ identifier: 'CON-1', description: 'short' })];
  const state = lp({ cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]) });
  const out = plain(renderLaunchPad(state, [], { cols: 78, now: NOW }));
  const lines = out.split('\n');
  assert.ok(lines.length < 25, 'unbounded render must stay tight to content, not pad out to some default height');
});

// --- CR2: epicRow/ticketRow direct tests for outer-bold removal ---

test('epicRow selected+focused row is NOT wrapped in outer bold (Decision 4)', () => {
  withColour(() => {
    const { epicRow } = require('../lib/ui/screens/launchpad');
    const epic = { id: 'p1', name: 'Pipeline v2', openCount: 2 };
    // Call epicRow directly to get its return value
    const row = epicRow(epic, true, true); // selected, paneFocused
    // CR2: The row should NOT start with an outer bold escape
    assert.doesNotMatch(row, /^\x1b\[1m/, 'epicRow selected+focused should not have outer bold');
    // It should start with plain content (the marker)
    assert.match(row, /^ ▸/, 'epicRow should start with marker');
  });
});

test('ticketRow selected+focused row is NOT wrapped in outer bold (Decision 4)', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const f = require('../lib/ui/format');
    const { ticketRow } = require('../lib/ui/screens/launchpad');
    const ticketObj = { identifier: 'CON-1', title: 'test', priority: 2, state: { name: 'Todo', type: 'unstarted' } };
    // Call ticketRow directly
    const row = ticketRow(ticketObj, false, true, true, [], null, 50); // checked, selected, paneFocused, runs, queueState, width
    // CR2: The row should NOT have outer bold (fill is applied by box(), not here)
    assert.doesNotMatch(row, /^\x1b\[1m/, 'ticketRow selected+focused should not have outer bold');
  });
});

// --- background fill and inner colour (Tasks 7.8 and 7.9) ---

test('the focused pane\'s selected row has background fill spanning all inner columns, even past inner resets (▲ running case)', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const f = require('../lib/ui/format');
    const tickets = [
      ticket({ identifier: 'CON-1', state: { name: 'Todo', type: 'unstarted' }, priority: 2 }),
    ];
    const runs = [{ ticket: 'CON-1', status: 'running' }];
    const state = lp({
      pane: 'tickets',
      ticketIndex: 0,
      cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]),
    });
    const out = renderColoured(state, runs, OPTS);
    const plainOut = plain(out);
    assert.match(plainOut, /CON-1/);
    assert.match(plainOut, /running/);
    // The key assertion: the fill extends past the embedded running status's reset
    // This is verified by seeing the fill escape (7m for basic tier), then the status colour, then a reset, then the fill re-opens
    assert.match(out, /\x1b\[7m/, 'row should have background fill');
    assert.match(out, /running\x1b\[0m\x1b\[7m/, 'fill must re-open after embedded running status reset');
  });
});

test('the focused pane\'s selected row has background fill spanning all inner columns (unknown priority case)', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const f = require('../lib/ui/format');
    const tickets = [
      ticket({ identifier: 'CON-2', state: { name: 'Todo', type: 'unstarted' }, priority: null }),
    ];
    const state = lp({
      pane: 'tickets',
      ticketIndex: 0,
      cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]),
    });
    const out = renderColoured(state, [], OPTS);
    const plainOut = plain(out);
    assert.match(plainOut, /CON-2/);
    // The unknown priority column carries dim (\x1b[2m) which should also be re-opened after
    assert.match(out, /\x1b\[7m.*\x1b\[2m\?.*\x1b\[0m\x1b\[7m/, 'fill must re-open after unknown priority dim reset');
  });
});

test('the unfocused pane\'s selected row uses dim, not bold+fill (contrasts with focused pane)', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const tickets = [
      ticket({ identifier: 'CON-1', epicId: 'p1', priority: 2 }),
      ticket({ identifier: 'CON-2', epicId: 'p1', priority: 1 }),
    ];
    const state = lp({
      pane: 'epics', // epics focused, so tickets pane is unfocused
      cache: cacheWith(tickets, [
        { id: 'p1', name: 'Pipeline v2', openCount: 2 },
        { id: 'p2', name: 'Second epic', openCount: 0 },
      ]),
      epicIndex: 0,
      ticketIndex: 0, // selected ticket in unfocused pane
    });
    const out = renderColoured(state, [], OPTS);
    const plainOut = plain(out);
    // Both panes should appear
    assert.match(plainOut, /Pipeline v2/);
    assert.match(plainOut, /CON-1/);

    // Extract the line containing the unfocused pane's selected ticket row (CON-1)
    const lines = out.split('\n');
    const combined = lines.find((l) => plain(l).includes('CON-1') && plain(l).includes('[ ]'));
    assert.ok(combined, 'combined hsplit line should render with CON-1');

    // CR1: Verify the ticket row (right pane, unfocused) is dim-only, no fill
    // The right pane starts after the first pane separator border(s)
    // Find where the ticket row starts: search for dim marker + box pattern
    const ticketMatch = combined.match(/\x1b\[2m ▸ \[ \] [^ ]+ CON-1[^\x1b]*?(?:\x1b\[0m)?/);
    assert.ok(ticketMatch, 'ticket row with CON-1 should be found');
    // The ticket row itself should NOT have fill (\x1b[7m) anywhere in it
    assert.doesNotMatch(ticketMatch[0], /\x1b\[7m/, 'unfocused ticket row should NOT have reverse-video fill');
  });
});

test('ticketRow\'s "▲ running" status uses STATUS_COLOUR.running (not hardcoded yellow)', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const f = require('../lib/ui/format');
    const tickets = [
      ticket({
        identifier: 'CON-1',
        state: { name: 'Todo', type: 'unstarted' },
        priority: 2,
      }),
    ];
    const runs = [{ ticket: 'CON-1', status: 'running' }];
    const state = lp({
      pane: 'tickets',
      ticketIndex: 0,
      cache: cacheWith(tickets, [{ id: 'p1', name: 'Pipeline v2', openCount: 1 }]),
    });
    const out = renderColoured(state, runs, OPTS);
    const plainOut = plain(out);
    // The status should be "▲ running"
    assert.match(plainOut, /▲ running/);
    // In the coloured output, it should NOT use the hardcoded yellow (33)
    assert.doesNotMatch(out, /\x1b\[33m▲ running/, 'running status should not be yellow');
    // Running should be cyan (36 in basic tier, 38;5;80 in 256-colour tier)
    // We just check that it's a cyan escape, not yellow
    assert.match(out, /\x1b\[(36m|38;5;80m)▲ running/, 'running status should be cyan (STATUS_COLOUR.running)');
  });
});
