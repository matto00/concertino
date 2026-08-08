'use strict';

const { read, exists, resolveOut, resolveConfigPath, hasHelpFlag } = require('./shared');
const { printUsage } = require('./help');
const { withDefaults } = require('../config');

function cmdWatch(args) {
  if (hasHelpFlag(args)) { printUsage('watch'); return; }
  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  let config = {};
  if (exists(cfgPath)) {
    try {
      const raw = JSON.parse(read(cfgPath));
      // CON-92: normalise via withDefaults so the dashboard gets the same
      // defaults/alias-resolution (e.g. ticketProvider.kind: "manual" ->
      // "local") as sync/diff/eject/migrate, instead of bypassing it as
      // cmdWatch did before this ticket. withDefaults assumes `project`/
      // `ticketProvider` are already-present objects (true of anything
      // `concertino init` writes) and throws otherwise — a hand-edited or
      // partial config missing those keys is exactly the kind of file this
      // class of bug tends to involve, so that throw is caught below rather
      // than allowed to propagate: it must not turn "watch works without
      // config" into "watch works without config, unless the config is
      // incomplete". The deep clone keeps `raw` itself pristine for the
      // fallback, since withDefaults mutates its argument in place (and
      // partially mutates it before throwing on an incompatible shape).
      try {
        config = withDefaults(JSON.parse(JSON.stringify(raw)));
      } catch (e) {
        // Deliberate, narrower fallback (design.md Decision 1): hand over
        // the same un-normalised object cmdWatch would have handed over
        // before this ticket, rather than resetting to {} — whatever DID
        // parse is still visible to watch(). Downstream (lib/ui/watch.js,
        // lib/ui/ticket-provider.js) already defends against an
        // unresolvable/unnormalised ticketProvider.kind reaching here; see
        // their own comments.
        config = raw;
      }
    } catch (e) { /* watch works without config */ }
  }
  const { watch } = require('../ui/watch');
  return watch({ root: out, config });
}

module.exports = { cmdWatch };
