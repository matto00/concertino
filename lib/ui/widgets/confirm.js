'use strict';

// The shared confirm-dialog widget (design.md Decision 1). Every "are you
// sure" gate across the dashboard (fleet's clear-queue/force-start/quit
// gates, drilldown's kill/restart gate) renders the same two-line shape: a
// warning line, then a dim "y confirm ...   (any other key) cancel" hint
// line. This widget owns only that shared envelope — the caller still
// composes the warning text itself (verb, ticket id, consequence wording,
// colour), since CON-39/CON-29's own design docs require that specificity
// ("no vague are-you-sure").

const f = require('../format');

// confirmLines({ warning, confirmHint }) -> [line1, line2]. `warning` is
// rendered as-is (the caller already applies its own colour/bold), indented
// by the same two spaces every existing call site already uses. `confirmHint`
// is wrapped in f.dim, matching the "y confirm X   (any other key) cancel"
// convention every existing gate already renders.
function confirmLines({ warning, confirmHint }) {
  return ['  ' + warning, f.dim('  ' + confirmHint)];
}

module.exports = { confirmLines };
