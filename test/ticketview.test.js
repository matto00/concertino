'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderTicketView, handleKey, render, findTicket, wrap } = require('../lib/ui/screens/ticketview');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function ticket(over) {
  return Object.assign({
    identifier: 'CON-9', title: 'The cache never trims descriptions',
    url: 'https://linear.app/concertino/issue/CON-9',
    description: 'Descriptions are 79% of the cache; comments are 0.6%. Trim the wrong axis and you save nothing.',
    state: { name: 'Todo', type: 'unstarted' },
    assignee: 'matt', estimate: 3, epicName: 'Pipeline v2', labels: ['launch-pad'],
    comments: [], commentCount: 0, commentsTruncated: false,
  }, over);
}

const OPTS = { cols: 78 };

// --- header / meta -----------------------------------------------------------

test('renders identifier, title and meta line', () => {
  const out = plain(renderTicketView(ticket({}), OPTS));
  assert.match(out, /CON-9/);
  assert.match(out, /The cache never trims descriptions/);
  assert.match(out, /Todo/);
  assert.match(out, /matt/);
  assert.match(out, /3 pts/);
  assert.match(out, /Pipeline v2/);
  assert.match(out, /launch-pad/);
});

test('renders the ticket url', () => {
  const out = plain(renderTicketView(ticket({}), OPTS));
  assert.match(out, /linear\.app\/concertino\/issue\/CON-9/);
});

// --- description --------------------------------------------------------------

test('renders the full description, wrapped', () => {
  const out = plain(renderTicketView(ticket({}), OPTS));
  assert.match(out, /Descriptions are 79% of the cache/);
});

test('an empty description says so rather than an empty section', () => {
  const out = plain(renderTicketView(ticket({ description: '' }), OPTS));
  assert.match(out, /\(no description\)/);
});

// --- ticket viewer with and without comments ----------------------------------

test('a ticket with no comments shows "(no comments)"', () => {
  const out = plain(renderTicketView(ticket({ comments: [], commentCount: 0 }), OPTS));
  assert.match(out, /COMMENTS/);
  assert.match(out, /\(no comments\)/);
});

test('a ticket with comments renders each author and body', () => {
  const out = plain(renderTicketView(ticket({
    comments: [
      { author: 'matt', body: 'PR opened: https://github.com/matto00/concertino/pull/1', createdAt: Date.parse('2026-07-26T20:56:59Z') },
      { author: 'skeptic-bot', body: 'confirmed against real data', createdAt: Date.parse('2026-07-27T09:00:00Z') },
    ],
    commentCount: 2,
  }), OPTS));
  assert.match(out, /COMMENTS\s+\(2\)/);
  assert.match(out, /matt/);
  assert.match(out, /PR opened/);
  assert.match(out, /skeptic-bot/);
  assert.match(out, /confirmed against real data/);
});

test('a truncated comment thread says how many are shown out of how many', () => {
  const comments = [{ author: 'matt', body: 'first of many', createdAt: 1000 }];
  const out = plain(renderTicketView(ticket({ comments, commentCount: 214, commentsTruncated: true }), OPTS));
  assert.match(out, /showing 1 of 214/);
});

test('an untruncated thread shows no "showing N of M" hint', () => {
  const out = plain(renderTicketView(ticket({
    comments: [{ author: 'matt', body: 'only one', createdAt: 1000 }], commentCount: 1, commentsTruncated: false,
  }), OPTS));
  assert.doesNotMatch(out, /showing/);
});

// --- hostile Linear free text: OSC/CSI/control bytes never reach the render -
// The description and every comment are authored in Linear by anyone with
// tracker write access, not just the orchestrator writing escalation
// questions — a title or comment carrying an OSC sequence could otherwise
// set the window title, clear the screen, or move the cursor in this
// full-screen TUI. See lib/ui/format.js's stripUnsafeControls, the single
// choke point this relies on (both title and description/comments pass
// through f.truncate at some point in renderTicketView).

test('a ticket title carrying an OSC (window-title) sequence is neutralised, not passed through', () => {
  const hostile = ticket({ title: 'innocuous' + '\x1b]0;pwned\x07' + '-title' });
  const out = renderTicketView(hostile, OPTS);
  assert.doesNotMatch(out, /\x1b\]/);
  assert.match(out, /innocuous-title/);
});

test('a ticket description carrying a cursor-movement CSI is neutralised', () => {
  const hostile = ticket({ description: 'before' + '\x1b[2J\x1b[H' + 'after' });
  const out = renderTicketView(hostile, OPTS);
  assert.doesNotMatch(out, /\x1b\[2J/);
  assert.match(out, /beforeafter|before after/);
});

test('a comment body carrying a hostile escape is neutralised', () => {
  const hostile = ticket({
    comments: [{ author: 'attacker', body: 'hi' + '\x1b]0;pwned\x07' + 'there', createdAt: 1000 }],
    commentCount: 1,
  });
  const out = renderTicketView(hostile, OPTS);
  assert.doesNotMatch(out, /\x1b\]/);
  assert.match(out, /hithere|hi there/);
});

// --- missing ticket ------------------------------------------------------------

test('a missing ticket renders safely rather than throwing', () => {
  assert.doesNotThrow(() => renderTicketView(null, OPTS));
  assert.match(plain(renderTicketView(null, OPTS)), /no longer in the cache/);
});

// --- key handling ---------------------------------------------------------------

test('esc backs out to the launch pad', () => {
  assert.deepEqual(handleKey('\x1b', {}), { type: 'back-to-launchpad' });
});

test('an unbound key is a no-op', () => {
  assert.equal(handleKey('z', {}), null);
});

// --- wrap ------------------------------------------------------------------------

test('wrap keeps lines within budget', () => {
  const lines = wrap('one two three four five six seven eight nine ten', 20);
  for (const l of lines) assert.ok(l.length <= 20);
});

test('wrap preserves blank lines between paragraphs', () => {
  const lines = wrap('first paragraph\n\nsecond paragraph', 40);
  assert.ok(lines.includes(''));
});

// --- router seam / findTicket -----------------------------------------------------

test('render(state, opts) looks the ticket up by identifier in the cache', () => {
  const state = {
    launchPad: {
      cache: { tickets: [ticket({ identifier: 'CON-1' }), ticket({ identifier: 'CON-2' })] },
      viewingTicket: 'CON-2',
    },
  };
  const out = plain(render(state, OPTS));
  assert.match(out, /CON-2/);
});

test('findTicket returns null for an identifier not in the cache', () => {
  assert.equal(findTicket({ cache: { tickets: [] } }, 'CON-9'), null);
});

// --- width discipline --------------------------------------------------------------

test('no rendered line exceeds opts.cols even with a long description and comments', () => {
  const { visibleLength } = require('../lib/ui/format');
  const wide = ticket({
    title: 'an extremely long ticket title that keeps going and going and does not stop',
    description: 'a '.repeat(200) + 'end',
    comments: [{ author: 'matt', body: 'b '.repeat(200), createdAt: 1000 }],
  });
  for (const cols of [50, 60, 78, 120]) {
    const out = renderTicketView(wide, { cols });
    for (const line of out.split('\n')) {
      assert.ok(visibleLength(line) <= cols, `cols:${cols} line is ${visibleLength(line)} wide: ${JSON.stringify(line)}`);
    }
  }
});
