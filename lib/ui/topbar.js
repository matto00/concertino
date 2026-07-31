'use strict';

// The one persistent, always-first line every screen renders — project
// identity plus fleet-wide state (run counts, active queue) regardless of
// which screen is currently on top. Pure: (state, screenLabel, opts) ->
// string. Composed once, centrally, in watch.js's draw() (mirroring how
// banner.js's cross-screen notice is already composed today) rather than
// duplicated per screen — every screen's render(state, opts) already
// receives the full state (runs, queueState), so no new data plumbing is
// needed to call this from watch.js.

const f = require('./format');

function buildTopBarLine(state, screenLabel, opts) {
  const cols = Math.max(20, (opts && opts.cols) || 80);
  const runs = (state && state.runs) || [];
  const queueState = state && state.queueState;
  const project = (runs[0] && runs[0].project) || '';

  const needsYou = runs.filter((r) => r.status === 'needs-you').length;
  const countLabel = `${runs.length} run${runs.length === 1 ? '' : 's'}` +
    (needsYou ? ` · ${needsYou} needs you` : '');

  const pendingCount = queueState && queueState.pending ? queueState.pending.length : 0;
  const inFlightCount = queueState && queueState.inFlight ? queueState.inFlight.size : 0;
  const queueLabel = (pendingCount || inFlightCount)
    ? ` · queue: ${pendingCount} pending${inFlightCount ? `, ${inFlightCount} running` : ''}`
    : '';

  const left = f.bold('concertino') + f.dim(' · ' + project) + '  ' + f.dim('· ' + screenLabel);
  const right = f.dim(countLabel + queueLabel);
  return f.truncate(left + '  ' + right, cols);
}

module.exports = { buildTopBarLine };
