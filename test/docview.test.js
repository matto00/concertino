'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  bodyBox, renderDocView, clampScroll, scrollDelta, handleKey, computeViewportRows,
  render, routeHandleKey, windowBody,
} = require('../lib/ui/screens/docview');
const { visibleLength } = require('../lib/ui/format');

// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function lines(n, prefix) {
  return Array.from({ length: n }, (_, i) => (prefix || 'line ') + i);
}

// --- clampScroll -------------------------------------------------------

test('clampScroll bounds to [0, bodyLineCount - viewportRows]', () => {
  assert.equal(clampScroll(50, 10, 20), 20);
  assert.equal(clampScroll(50, 10, 1000), 40);
  assert.equal(clampScroll(50, 10, -5), 0);
});

test('scrolling down is clamped at the end of the document', () => {
  assert.equal(clampScroll(20, 10, 10), 10); // already at max
});

test('scrolling up is clamped at the start of the document', () => {
  assert.equal(clampScroll(20, 10, 0), 0);
});

test('clampScroll never goes negative even when the document fits entirely', () => {
  assert.equal(clampScroll(5, 10, 3), 0);
});

// --- scrollDelta ---------------------------------------------------------

test('scrollDelta recognises up/down arrows and j/k as single-line moves', () => {
  assert.deepEqual(scrollDelta('\x1b[A', 10), { lines: -1 });
  assert.deepEqual(scrollDelta('k', 10), { lines: -1 });
  assert.deepEqual(scrollDelta('\x1b[B', 10), { lines: 1 });
  assert.deepEqual(scrollDelta('j', 10), { lines: 1 });
});

test('scrollDelta recognises page up/down as one viewport of lines', () => {
  assert.deepEqual(scrollDelta('\x1b[5~', 12), { lines: -12 });
  assert.deepEqual(scrollDelta('\x1b[6~', 12), { lines: 12 });
});

test('scrollDelta returns null for any other key', () => {
  assert.equal(scrollDelta('q', 10), null);
  assert.equal(scrollDelta('\x1b', 10), null);
});

// --- windowBody: exported for callers that need windowing without bodyBox's
// own box chrome (drilldown.js's TICKET/TIMELINE/GATES panels, which need a
// TITLED box via their own pane() helper, not bodyBox's title-less one) ----

test('windowBody is exported and windows content to viewportRows, reserving one row for the position indicator', () => {
  const out = windowBody(lines(20), 5, 0);
  assert.equal(out.length, 5);
  assert.match(plain(out[out.length - 1]), /showing 1-4 of 20/);
});

// --- bodyBox: short content, no windowing -------------------------------

test('content that fits the viewport renders in full, unscrolled', () => {
  const out = bodyBox(lines(3), { width: 20, viewportRows: 10, scrollOffset: 0 });
  const text = plain(out.join('\n'));
  assert.match(text, /line 0/);
  assert.match(text, /line 1/);
  assert.match(text, /line 2/);
  assert.doesNotMatch(text, /more/);
});

test('a short body sizes the box to its own content, not the full viewport budget', () => {
  const out = bodyBox(lines(3), { width: 20, viewportRows: 10, scrollOffset: 0 });
  // top border + 3 content rows + bottom border, never padded out to
  // viewportRows + 2 — the same "byte-identical to the unbounded case"
  // property ticketview.js's own pre-change output relied on.
  assert.equal(out.length, 5);
});

// --- bodyBox: overflow, windowed -----------------------------------------

test('content taller than the viewport is windowed, not truncated silently', () => {
  const out = bodyBox(lines(50), { width: 30, viewportRows: 10, scrollOffset: 0 });
  assert.equal(out.length, 12); // top border + 10 content rows + bottom border
  const text = plain(out.join('\n'));
  assert.match(text, /showing 1-9 of 50/);
});

test('scrolling into the middle of a long document shows the current position, not silently dropped content', () => {
  const out = bodyBox(lines(50), { width: 30, viewportRows: 10, scrollOffset: 20 });
  const text = plain(out.join('\n'));
  assert.match(text, /showing 21-29 of 50/);
});

test('scrolled past the end clamps to the document\'s true last line, not one short of it', () => {
  const out = bodyBox(lines(50), { width: 30, viewportRows: 10, scrollOffset: 1000 });
  const text = plain(out.join('\n'));
  assert.match(text, /line 49/);
  assert.match(text, /showing 42-50 of 50/);
});

test('a windowed bodyBox never exceeds its own viewport row budget', () => {
  for (const scrollOffset of [0, 5, 20, 39, 1000]) {
    const out = bodyBox(lines(50), { width: 20, viewportRows: 10, scrollOffset });
    assert.equal(out.length, 12);
  }
});

// --- renderDocView: full-screen composition -------------------------------

test('renderDocView shows the title, an esc back footer, and the body', () => {
  const out = plain(renderDocView({ title: 'skeptic-2.md', body: lines(3) }, { cols: 40, rows: 20 }));
  assert.match(out, /skeptic-2\.md/);
  assert.match(out, /esc back/);
  assert.match(out, /line 0/);
});

test('the full-screen composition is windowed exactly like the shared core', () => {
  const body = lines(50);
  const rows = 20;
  const viewportRows = computeViewportRows(rows);
  const bare = bodyBox(body, { width: 40, viewportRows, scrollOffset: 5 });
  const composedLines = renderDocView({ title: 't', body }, { cols: 40, rows, scrollOffset: 5 }).split('\n');
  // Composition order: [title, '', ...bare box lines..., '', footer] — the
  // box's own lines must appear byte-for-byte identical, in the same slot.
  const boxSlice = composedLines.slice(2, 2 + bare.length);
  assert.deepEqual(boxSlice, bare);
});

test('renderDocView with no rows given renders the whole document unbounded (test/omitted-dimension convention)', () => {
  const out = plain(renderDocView({ title: 't', body: lines(5) }, { cols: 40 }));
  assert.match(out, /line 0/);
  assert.match(out, /line 4/);
  assert.doesNotMatch(out, /more/);
});

test('the footer shows a position indicator only once the document is windowed', () => {
  const short = plain(renderDocView({ title: 't', body: lines(3) }, { cols: 40, rows: 20 }));
  assert.doesNotMatch(short, / of \d+/);
  const long = plain(renderDocView({ title: 't', body: lines(50) }, { cols: 40, rows: 16 }));
  assert.match(long, / of 50/);
});

test('no rendered line exceeds opts.cols', () => {
  for (const cols of [40, 60, 90]) {
    const out = renderDocView({ title: 'a'.repeat(200), body: lines(30, 'a very long line of prose that keeps going ') }, { cols, rows: 20 });
    for (const line of out.split('\n')) {
      assert.ok(visibleLength(line) <= cols, `cols:${cols} line is ${visibleLength(line)} wide`);
    }
  }
});

// --- computeViewportRows --------------------------------------------------

test('computeViewportRows is unbounded when rows is absent/0', () => {
  assert.equal(computeViewportRows(0), Infinity);
  assert.equal(computeViewportRows(undefined), Infinity);
});

test('computeViewportRows reserves the doc reader\'s own chrome from the terminal row count', () => {
  const rows = 24;
  const viewportRows = computeViewportRows(rows);
  assert.ok(viewportRows > 0 && viewportRows < rows);
});

// --- lazygit-layout pass: the top bar's own reserved row flows through ----
// watch.js's computeScreenRows() now subtracts one extra row for the
// persistent top bar before it ever reaches this screen's `rows` — since
// computeViewportRows is already a pure, monotonic function of `rows`, that
// one-row reduction just flows through automatically (docview.js needed no
// changes for this task).
test('the top bar\'s reserved row shrinks the evidence-reader viewport by exactly one row', () => {
  const withoutTopBarRow = computeViewportRows(30);
  const withTopBarRow = computeViewportRows(29);
  assert.equal(withoutTopBarRow - withTopBarRow, 1);
});

// --- handleKey (core, opaque back action) ---------------------------------

test('esc returns the generic back action, opaque to this module', () => {
  assert.deepEqual(handleKey('\x1b', {}), { type: 'back' });
});

test('a scroll key returns a clamped scroll action', () => {
  const action = handleKey('j', { bodyLineCount: 50, viewportRows: 10, scrollOffset: 5 });
  assert.deepEqual(action, { type: 'scroll', offset: 6 });
});

test('a scroll key already at the max clamps rather than exceeding it', () => {
  const action = handleKey('j', { bodyLineCount: 20, viewportRows: 10, scrollOffset: 10 });
  assert.deepEqual(action, { type: 'scroll', offset: 10 });
});

test('an unbound key is a no-op', () => {
  assert.equal(handleKey('z', {}), null);
});

// --- router seam -----------------------------------------------------------

test('render(state, opts) reads docTitle/docBody/docScroll from app state', () => {
  const state = { docTitle: 'eval-report.md', docBody: lines(3), docScroll: 0 };
  const out = plain(render(state, { cols: 40, rows: 20 }));
  assert.match(out, /eval-report\.md/);
  assert.match(out, /line 0/);
});

test('routeHandleKey translates the generic back action into back-to-drilldown-from-doc', () => {
  const state = { docBody: [], docViewportRows: 10, docScroll: 0 };
  assert.deepEqual(routeHandleKey('\x1b', state), { type: 'back-to-drilldown-from-doc' });
});

test('routeHandleKey returns a doc-scroll action with the clamped offset', () => {
  const state = { docBody: lines(50), docViewportRows: 10, docScroll: 5 };
  assert.deepEqual(routeHandleKey('j', state), { type: 'doc-scroll', offset: 6 });
});

test('routeHandleKey is a no-op for an unbound key', () => {
  const state = { docBody: lines(50), docViewportRows: 10, docScroll: 5 };
  assert.equal(routeHandleKey('q', state), null);
});

// --- generic/reusable: no ticket/evidence-specific concepts ----------------

test('bodyBox and renderDocView never mention ticket/evidence concepts in their own source', () => {
  const src = require('fs').readFileSync(require.resolve('../lib/ui/screens/docview'), 'utf8');
  // Scoped to the two pure exports' own bodies rather than the whole file
  // (the router-seam functions below them legitimately read app-state field
  // names like `docTitle`, which is fine — spec.md's requirement is about
  // bodyBox/renderDocView specifically).
  const bodyBoxSrc = src.slice(src.indexOf('function bodyBox'), src.indexOf('function computeViewportRows'));
  const renderDocViewSrc = src.slice(src.indexOf('function renderDocView'), src.indexOf('// renderDocView\'s own handleKey'));
  for (const chunk of [bodyBoxSrc, renderDocViewSrc]) {
    assert.doesNotMatch(chunk, /ticket/i);
    assert.doesNotMatch(chunk, /evidence/i);
  }
});
