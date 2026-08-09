'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseHarnessList } = require('../lib/cli/shared');

// CON-84 unify-harness-flag-semantics, tasks.md 5.1: direct unit coverage of
// the shared `--harness` comma-list parsing/validation helper used by
// sync/diff/eject alike (design.md Decision 1) — exercised in-process since
// it's a pure function (never calls process.exit itself).

test('parseHarnessList: single valid value', () => {
  const { harnesses, error } = parseHarnessList('codex', ['claude-code']);
  assert.equal(error, null);
  assert.deepEqual(harnesses, ['codex']);
});

test('parseHarnessList: valid comma-separated list', () => {
  const { harnesses, error } = parseHarnessList('claude-code,codex,opencode', []);
  assert.equal(error, null);
  assert.deepEqual(harnesses, ['claude-code', 'codex', 'opencode']);
});

test('parseHarnessList: whitespace around commas is trimmed', () => {
  const { harnesses, error } = parseHarnessList('claude-code , codex , opencode', []);
  assert.equal(error, null);
  assert.deepEqual(harnesses, ['claude-code', 'codex', 'opencode']);
});

test('parseHarnessList: a trailing comma drops the resulting empty entry', () => {
  const { harnesses, error } = parseHarnessList('claude-code,codex,', []);
  assert.equal(error, null);
  assert.deepEqual(harnesses, ['claude-code', 'codex']);
});

test('parseHarnessList: repeated commas drop every resulting empty entry', () => {
  const { harnesses, error } = parseHarnessList('claude-code,,codex', []);
  assert.equal(error, null);
  assert.deepEqual(harnesses, ['claude-code', 'codex']);
});

test('parseHarnessList: one invalid entry is named in the error, valid set listed', () => {
  const { harnesses, error } = parseHarnessList('claude-code,bogus', []);
  assert.equal(harnesses, null);
  assert.match(error, /unknown harness "bogus"/);
  assert.match(error, /valid: claude-code, codex, opencode/);
});

test('parseHarnessList: multiple invalid entries are all named together in one error', () => {
  const { harnesses, error } = parseHarnessList('bogus,claude-code,also-bogus', []);
  assert.equal(harnesses, null);
  assert.match(error, /unknown harness "bogus,also-bogus"/);
});

test('parseHarnessList: empty/undefined raw falls back to the given fallback array', () => {
  const fallback = ['claude-code', 'codex'];
  assert.deepEqual(parseHarnessList(undefined, fallback), { harnesses: fallback, error: null });
  assert.deepEqual(parseHarnessList('', fallback), { harnesses: fallback, error: null });
});
