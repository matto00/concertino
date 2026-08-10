'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { diffStat, fileDiff, parseStatLines, MAX_DIFF_LINES } = require('../lib/ui/git-diff');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-git-diff-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

// --- parseStatLines --------------------------------------------------------

test('parseStatLines extracts the leading path from each per-file line, dropping the trailing summary line', () => {
  const raw = ' src/a.js  | 12 +++++--\n' +
    ' src/b.md  |  3 +-\n' +
    ' 2 files changed, 10 insertions(+), 5 deletions(-)\n';
  const files = parseStatLines(raw);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'src/a.js');
  assert.equal(files[1].path, 'src/b.md');
  assert.ok(files[0].line.includes('src/a.js') && files[0].line.includes('| 12'));
});

test('parseStatLines returns an empty array for empty/blank input', () => {
  assert.deepEqual(parseStatLines(''), []);
  assert.deepEqual(parseStatLines(null), []);
});

// --- diffStat ---------------------------------------------------------------

test('diffStat returns the changed files for a worktree with real, uncommitted changes', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'changed.txt'), 'line one\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'changed.txt'), 'line one\nline two\n');

  const result = diffStat(dir);
  assert.equal(result.error, null);
  assert.equal(result.stat.length, 1);
  assert.equal(result.stat[0].path, 'changed.txt');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('diffStat returns an empty (not null) stat array for a real repo with no changes', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });

  const result = diffStat(dir);
  assert.equal(result.error, null);
  assert.deepEqual(result.stat, []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('diffStat degrades to { stat: null, error } rather than throwing, for a non-repo directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-git-diff-norepo-'));
  assert.doesNotThrow(() => diffStat(dir));
  const result = diffStat(dir);
  assert.equal(result.stat, null);
  assert.ok(result.error, 'a non-repo directory should report a non-empty error message');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('diffStat degrades rather than throwing for a worktree path that does not exist at all', () => {
  assert.doesNotThrow(() => diffStat('/does/not/exist/at/all/concertino-test'));
  const result = diffStat('/does/not/exist/at/all/concertino-test');
  assert.equal(result.stat, null);
  assert.ok(result.error);
});

// --- fileDiff ----------------------------------------------------------------

test('fileDiff returns the full unified diff for a single file', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line one\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'line one\nline two\n');

  const result = fileDiff(dir, 'a.txt');
  assert.equal(result.error, null);
  assert.equal(result.truncated, false);
  assert.ok(result.lines.some((l) => l.includes('+line two')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fileDiff truncates a diff exceeding MAX_DIFF_LINES, appending an explicit marker line', () => {
  const dir = tmpRepo();
  const lines = Array.from({ length: MAX_DIFF_LINES + 500 }, (_, i) => 'line ' + i);
  fs.writeFileSync(path.join(dir, 'big.txt'), lines.join('\n') + '\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  // Change every line so the diff itself carries well over MAX_DIFF_LINES of
  // '+'/'-' content, independent of git's own context-line defaults.
  fs.writeFileSync(path.join(dir, 'big.txt'), lines.map((l) => l + '!').join('\n') + '\n');

  const result = fileDiff(dir, 'big.txt');
  assert.equal(result.error, null);
  assert.equal(result.truncated, true);
  assert.equal(result.lines.length, MAX_DIFF_LINES + 1, 'the cap plus exactly one trailing marker line');
  assert.match(result.lines[result.lines.length - 1], /truncated — diff exceeds \d+ lines/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fileDiff on a binary file returns git\'s own short summary, with no truncation marker', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.bin'), Buffer.from([4, 5, 6, 7, 0, 254]));

  const result = fileDiff(dir, 'a.bin');
  assert.equal(result.error, null);
  assert.equal(result.truncated, false);
  assert.ok(result.lines.some((l) => /Binary files .* differ/.test(l)));
  assert.ok(!result.lines.some((l) => l.includes('truncated')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fileDiff degrades to { lines: null, error } rather than throwing, for a non-repo directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concertino-git-diff-norepo-file-'));
  assert.doesNotThrow(() => fileDiff(dir, 'whatever.txt'));
  const result = fileDiff(dir, 'whatever.txt');
  assert.equal(result.lines, null);
  assert.ok(result.error);
  fs.rmSync(dir, { recursive: true, force: true });
});
