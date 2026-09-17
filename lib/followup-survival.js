'use strict';

// Pure, dependency-free computation for `concertino report followup-survival`
// (CON-192). No `require` of `fs`, `https`, or any `lib/ui/*` module — every
// function here operates on plain arrays of "rows", so the arithmetic is
// unit-testable over fixtures without network or event-store I/O (design.md
// Decision 2). `lib/cli/report.js` owns all the I/O and calls these.
//
// A row is a plain object:
//   {
//     id: string,               // ticket identifier, e.g. "CON-213"
//     originRole: string|null,  // 'orchestrator' | 'executor' | ... | null (unknown)
//     suggestedBy: string|null, // 'agent' | 'human' | null (unknown)
//     overlap: string,          // 'high' | 'partial' | 'none' | 'unknown'
//     filedAt: number|null,     // epoch ms the follow-up was filed
//     survived: boolean,        // true iff the ticket's Linear state type is 'completed'
//     ageMs: number|null,       // now - filedAt, meaningful only for non-survivors
//     marker: string|undefined, // recovered-tier only: 'convention' | 'prose'
//   }

const DEFAULT_MIN_N = 5;

function median(numbers) {
  const nums = (numbers || []).filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (nums.length === 0) return null;
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// computeSurvival: { surviving, total, pct, suppressed, medianAgeOfNonSurvivors }
// `pct` is null whenever there is nothing to report (total 0) or the
// denominator is below `minN` (small-n suppression, Decision 10 / C3) — never
// a fabricated 0%. Counts are always real, even when `pct` is withheld.
function computeSurvival(rows, minN) {
  const min = typeof minN === 'number' ? minN : DEFAULT_MIN_N;
  const list = rows || [];
  const total = list.length;
  const surviving = list.filter((r) => r && r.survived === true).length;

  if (total === 0) {
    return { surviving: 0, total: 0, pct: null, suppressed: false, medianAgeOfNonSurvivors: null };
  }

  const suppressed = total < min;
  const rawPct = Math.round((surviving / total) * 100);
  const nonSurvivorAges = list
    .filter((r) => r && r.survived !== true && typeof r.ageMs === 'number')
    .map((r) => r.ageMs);

  return {
    surviving,
    total,
    pct: suppressed ? null : rawPct,
    suppressed,
    medianAgeOfNonSurvivors: median(nonSurvivorAges),
  };
}

function getPath(row, key) {
  if (!key.includes('.')) return row ? row[key] : undefined;
  const parts = key.split('.');
  let cur = row;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

// segmentBy: groups rows by `key` (dotted paths supported, e.g. 'triage.overlap');
// a row whose value is absent/empty routes to an 'unknown' bucket rather than
// being dropped, so the overall total is conserved across buckets.
// Returns { buckets: { value: survivalResult }, singleValued: boolean } —
// `singleValued` is true iff every row observed shares exactly one bucket
// value (including the degenerate all-unknown/empty-rows case), computed from
// the OBSERVED rows, never assumed (design.md Decision 6 / task 1.6).
function segmentBy(rows, key, minN) {
  const list = rows || [];
  const grouped = new Map();

  for (const row of list) {
    let value = getPath(row, key);
    if (value == null || value === '') value = 'unknown';
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(row);
  }

  const buckets = {};
  for (const [value, groupRows] of grouped.entries()) {
    buckets[value] = computeSurvival(groupRows, minN);
  }

  const singleValued = grouped.size <= 1;
  return { buckets, singleValued };
}

// ISO-8601 week key ("YYYY-Www"), Thursday-anchored per the standard so week
// boundaries match what humans mean by "week 33" etc.
function isoWeekKey(ms) {
  const d = new Date(ms);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday=0..Sunday=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

// Returns the Monday 00:00 UTC that starts the ISO week containing `ms`, so
// consecutive week keys can be enumerated chronologically without re-deriving
// them from isoWeekKey() (which is not directly invertible).
function weekStart(ms) {
  const d = new Date(ms);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum);
  return date.getTime();
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

// bucketByWeek: chronologically-ordered ISO-week buckets spanning the first
// to the last filed row, INCLUDING weeks with zero filed follow-ups as
// explicitly-empty buckets (`total: 0, pct: null`) rather than 0% survival
// (design.md Decision 7 / spec "Survival is computed over time").
function bucketByWeek(rows, minN) {
  const list = (rows || []).filter((r) => r && typeof r.filedAt === 'number');
  if (list.length === 0) return [];

  const starts = list.map((r) => weekStart(r.filedAt));
  const minStart = Math.min(...starts);
  const maxStart = Math.max(...starts);

  const byWeek = new Map();
  for (const row of list) {
    const key = isoWeekKey(row.filedAt);
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(row);
  }

  const out = [];
  for (let t = minStart; t <= maxStart; t += WEEK_MS) {
    const key = isoWeekKey(t);
    const weekRows = byWeek.get(key) || [];
    out.push(Object.assign({ period: key }, computeSurvival(weekRows, minN)));
  }
  return out;
}

module.exports = {
  DEFAULT_MIN_N,
  median,
  computeSurvival,
  segmentBy,
  bucketByWeek,
  isoWeekKey,
  weekStart,
};
