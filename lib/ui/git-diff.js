'use strict';

// Shells out to `git diff --stat`/`git diff -- <file>` against a run's
// worktree — the drill-down CHANGES panel's one impure read (CON-104,
// design.md Decision 1). Mirrors ticket-text.js's own resolve()/watch.js's
// `drillTicketText` seam: never called from inside a pure render path,
// always from the draw()/controller-level call site, and wrapped in
// try/catch so a slow or failing `git` degrades this poll's CHANGES panel
// rather than the whole poll loop. `execFileSync` (never `exec`) avoids any
// shell interpolation of `cwd`/`file`, matching session.js's/
// launchpad.js's own child-process calls.

const { execFileSync } = require('child_process');

// Bounded well under watch.js's own POLL_MS (1000ms) — a slow/hung git call
// degrades this poll's CHANGES panel to "diff unavailable" rather than
// stalling the poll loop every other screen also depends on (design.md
// Decision 1).
const GIT_TIMEOUT_MS = 2000;

// A fixed cap on the FULL diff shown by the doc reader (design.md Decision
// 4) — `git diff --stat` itself is already compact (one summary line per
// file) and is never truncated; this applies only to fileDiff()'s expanded
// output, below.
const MAX_DIFF_LINES = 2000;

// Splits a `git diff --stat --no-color` line into its leading file path and
// keeps the line itself (already `<path> | <N> +++---`-shaped) for display
// — every per-file line contains ' | '; the trailing summary line ("N files
// changed, ...") never does, and is dropped here rather than shown as a
// bogus "file" entry.
function parseStatLines(raw) {
  const files = [];
  for (const line of String(raw || '').split('\n')) {
    const sepIdx = line.indexOf(' | ');
    if (sepIdx === -1) continue;
    const path = line.slice(0, sepIdx).trim();
    if (!path) continue;
    files.push({ path, line: line.trim() });
  }
  return files;
}

// diffStat(worktree) -> { stat, error }. `stat` is an array of `{ path,
// line }` (possibly empty — an empty array means a real, successful diff
// with no changes, not a failure) on success; `error` is null. On failure
// (a slow/hung git, a non-repo directory, or any other throw) returns
// `{ stat: null, error: <message> }`. Never throws — the caller (watch.js's
// draw()) is never obligated to wrap this itself.
function diffStat(worktree) {
  try {
    const raw = execFileSync('git', ['diff', '--stat', '--no-color'], {
      cwd: worktree, encoding: 'utf8', timeout: GIT_TIMEOUT_MS,
      // stdio[2]: 'ignore' — a non-repo/corrupted worktree's stderr must
      // never bleed onto this dashboard's own screen, even though the call
      // is caught below (verified the same way launchpad.js's own
      // commitSha lookup already documents for its identical stdio choice).
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { stat: parseStatLines(raw), error: null };
  } catch (e) {
    return { stat: null, error: e.message || 'git diff failed' };
  }
}

// fileDiff(worktree, file) -> { lines, truncated, error }. The full unified
// diff for one file, truncated to MAX_DIFF_LINES with a trailing marker
// line when it exceeds that cap (design.md Decision 4) — a binary file's
// diff is git's own short `Binary files a/... and b/... differ` summary
// (plus its usual `diff --git`/`index` header lines), already well under
// the cap, so no special-case truncation logic is needed for it; it is
// returned as-is. Never throws — mirrors diffStat's own contract.
function fileDiff(worktree, file) {
  try {
    const raw = execFileSync('git', ['diff', '--', file], {
      cwd: worktree, encoding: 'utf8', timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const allLines = raw.split('\n');
    // A trailing '' from the diff's own final newline is not a real line.
    if (allLines.length && allLines[allLines.length - 1] === '') allLines.pop();
    if (allLines.length > MAX_DIFF_LINES) {
      const truncated = allLines.slice(0, MAX_DIFF_LINES);
      truncated.push('… truncated — diff exceeds ' + MAX_DIFF_LINES + ' lines');
      return { lines: truncated, truncated: true, error: null };
    }
    return { lines: allLines, truncated: false, error: null };
  } catch (e) {
    return { lines: null, truncated: false, error: e.message || 'git diff failed' };
  }
}

module.exports = { diffStat, fileDiff, parseStatLines, MAX_DIFF_LINES, GIT_TIMEOUT_MS };
