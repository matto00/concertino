'use strict';

// The ONLY test in this repo that sees an escape sequence.
//
// `format.js` decides once, at require time, whether to emit colour — and under
// `node --test` stdout is a pipe, so isTTY is false and every other test asserts
// on plain text. Two bugs lived in that blind spot (a cut landing mid-escape,
// and a cut landing mid-surrogate-pair inside a coloured line). Forcing isTTY
// before the require closes it. `node --test` gives each file its own process,
// so this cannot leak into the other suites.
// Also pin TERM/COLORTERM so SUPPORTS_256 is deterministic (Task 7.2).

process.stdout.isTTY = true;
delete process.env.TERM;
delete process.env.COLORTERM;
for (const m of ['../lib/ui/format', '../lib/ui/screens/fleet']) {
  delete require.cache[require.resolve(m)];
}

const { test } = require('node:test');
const assert = require('node:assert');
const f = require('../lib/ui/format');
const { renderFleet } = require('../lib/ui/screens/fleet');

// A high surrogate not followed by a low one, or a low one not preceded by a
// high one: the signature of a string sliced through an astral character.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function run(over) {
  return Object.assign({
    ticket: 'HEL-1', project: 'helio', changeName: 'a-change', branch: null,
    worktree: null, devPort: null, backendPort: null, harness: null, model: null,
    phase: null, cycle: null, gates: [], lastVerdict: null, escalation: null,
    escalationStale: false, events: [], startedAt: null, endedAt: null,
    endStatus: null, elapsedMs: 60000, window: { alive: true, idleMs: 0 },
    status: 'running', telemetry: 'full', malformed: 0,
  }, over);
}

test('the fixture really is emitting colour', () => {
  assert.equal(process.stdout.isTTY, true);
  assert.equal(f.yellow('x'), '\x1b[33mx\x1b[0m');
  assert.match(renderFleet([run({})], { cols: 78, selected: 0 }), /\x1b\[/);
});

test('truncating a coloured string keeps escapes whole and closes the colour', () => {
  const coloured = f.yellow('x'.repeat(70));
  const out = f.truncate(coloured, 30);
  assert.equal(f.visibleLength(out), 30);
  assert.ok(out.endsWith('\x1b[0m'), 'colour must be reset, or it bleeds down the screen');
  assert.doesNotMatch(out, /\x1b\[?3?$/, 'no half-written escape');
});

test('truncate never emits a lone surrogate, at any cut point', () => {
  const s = 'add zod@3? 🎉🎉🎉 please';
  for (let n = 1; n <= f.visibleLength(s) + 2; n++) {
    const out = f.truncate(s, n);
    assert.doesNotMatch(out, LONE_SURROGATE, `lone surrogate at n=${n}: ${JSON.stringify(out)}`);
    assert.ok(f.visibleLength(out) <= n, `overflowed at n=${n}`);
  }
});

test('an emoji escalation question survives the real coloured render path', () => {
  // Escalation questions are model-authored free text and models emit emoji
  // readily. This is the path the bug was found on.
  const out = renderFleet([run({
    ticket: 'HEL-338', status: 'needs-you',
    escalation: { question: 'ship it 🎉🎉🎉 or hold for the 🚀 release?', options: ['approve', 'deny'], raisedAt: 1 },
  })], { cols: 40, selected: 0 });
  assert.doesNotMatch(out, LONE_SURROGATE);
  assert.match(out, /\x1b\[33m/, 'the escalation line must actually be yellow');
});

test('visibleLength counts terminal columns, not code units', () => {
  assert.equal(f.visibleLength('日本語テスト'), 12);   // 6 CJK glyphs, 2 columns each
  assert.equal(f.visibleLength('한글'), 4);
  assert.equal(f.visibleLength('ab日'), 4);
  assert.equal(f.visibleLength('🎉'), 2);
  assert.equal(f.visibleLength('é'), 1);        // e + combining acute
  assert.equal(f.visibleLength('❤️'), 1);   // heart + variation selector
  assert.equal(f.visibleLength(f.yellow('日本')), 4); // escapes are still free
  assert.equal(f.visibleLength('▪░▸↵·▲…'), 7);       // the glyphs the UI draws with
});

test('the width guard holds for wide characters through the render path', () => {
  const out = renderFleet([run({
    ticket: 'HEL-338', status: 'needs-you', changeName: '日本語のブランチ名前がとても長い場合',
    escalation: { question: 'これは非常に長いエスカレーションの質問です', options: ['approve', 'deny'], raisedAt: 1 },
  })], { cols: 50, selected: 0 });
  for (const line of out.split('\n')) {
    assert.ok(f.visibleLength(line) <= 50,
      `line is ${f.visibleLength(line)} columns wide, terminal is 50: ${JSON.stringify(line)}`);
  }
});

test('SUPPORTS_256 determines whether colours emit 256-colour codes or 3-bit codes', () => {
  // Already under the pinned basic tier (TERM/COLORTERM deleted), so colours
  // should emit 3-bit codes like \x1b[33m, not 256-colour codes like \x1b[38;5;221m
  assert.equal(f.yellow('x'), '\x1b[33mx\x1b[0m', 'yellow should emit 3-bit code in basic tier');
  assert.equal(f.cyan('x'), '\x1b[36mx\x1b[0m', 'cyan should emit 3-bit code in basic tier');
});

test('STATUS_COLOUR.running is different from STATUS_COLOUR.done', () => {
  // This asserts the decision, not the emitted bytes (per the isTTY-blind-spot
  // convention). The two should be distinct functions mapping to different
  // colour function calls.
  assert.notEqual(f.STATUS_COLOUR.running, f.STATUS_COLOUR.done);
  // running should be cyan, done should be dim
  assert.equal(f.STATUS_COLOUR.running('x'), '\x1b[36mx\x1b[0m', 'running = cyan in basic tier');
  assert.equal(f.STATUS_COLOUR.done('x'), '\x1b[2mx\x1b[0m', 'done = dim');
});

test('bgFill wraps content with background fill and handles embedded resets', () => {
  // In basic tier (3-bit), bgFill should emit reverse video (SGR 7)
  const filled = f.bgFill('hello');
  assert.equal(filled, '\x1b[7mhello\x1b[0m', 'bgFill with plain text in basic tier');

  // With embedded reset, bgFill should re-open the fill after it
  const withReset = f.bgFill('hello\x1b[0mworld');
  assert.equal(withReset, '\x1b[7mhello\x1b[0m\x1b[7mworld\x1b[0m', 'bgFill re-opens after embedded reset');
});

test('bgFill is a no-op under !isTTY', () => {
  const oldTTY = process.stdout.isTTY;
  process.stdout.isTTY = false;
  delete require.cache[require.resolve('../lib/ui/format')];
  const f2 = require('../lib/ui/format');

  const filled = f2.bgFill('hello');
  assert.equal(filled, 'hello', 'bgFill should no-op when !isTTY');

  process.stdout.isTTY = oldTTY;
});

test('256-colour tier: f.cyan and f.bgFill emit 256-colour escapes when TERM/COLORTERM indicate support', () => {
  // Force the 256-colour tier by setting TERM=xterm-256color and clearing require.cache
  process.stdout.isTTY = true;
  process.env.TERM = 'xterm-256color';
  delete process.env.COLORTERM; // xterm-256color alone is enough
  for (const m of ['../lib/ui/format']) {
    delete require.cache[require.resolve(m)];
  }
  const f256 = require('../lib/ui/format');

  // Cyan should emit 256-colour escape (38;5;80)
  assert.equal(f256.cyan('x'), '\x1b[38;5;80mx\x1b[0m', 'cyan should emit 256-colour code at 256-colour tier');

  // bgFill should emit 256-colour background + foreground pair (48;5;236;38;5;253)
  const filled256 = f256.bgFill('x');
  assert.equal(filled256, '\x1b[48;5;236;38;5;253mx\x1b[0m', 'bgFill should emit 256-colour bg+fg pair at 256-colour tier');

  // Clean up: restore basic tier
  delete process.env.TERM;
  delete require.cache[require.resolve('../lib/ui/format')];
  require('../lib/ui/format');
});
