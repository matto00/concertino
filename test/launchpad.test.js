'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderLaunchPad, handleKey, render, inlineStatus, ticketsForEpic, windowStart,
  isSelectable, selectableIdentifiers,
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

test('a checked ticket renders [x], an unchecked one [ ]', () => {
  const selected = new Set(['CON-1']);
  const out = plain(renderLaunchPad(lp({ selected }), [], OPTS));
  assert.match(out, /\[x\] CON-1/);
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

// --- selected row recedes (dims) in the unfocused pane, never disappears ---

// bold/dim are no-ops under `!isTTY` (see format.js's `wrap`), so these three
// force isTTY the same way format-colour.test.js/drilldown.test.js's "role
// gutter" test do: set it true, clear the require cache, require fresh,
// reset it afterwards so nothing else in this file is affected.

function withColour(fn) {
  process.stdout.isTTY = true;
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

test('the focused pane\'s own selection is bold, not dim', () => {
  withColour(({ renderLaunchPad: renderColoured }) => {
    const state = lp({ pane: 'tickets', ticketIndex: 0 });
    const out = renderColoured(state, [], OPTS);
    const markerLine = out.split('\n').find((l) => plain(l).includes('CON-1'));
    assert.match(markerLine, /\x1b\[1m/, 'the focused pane\'s selection should be bold');
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
