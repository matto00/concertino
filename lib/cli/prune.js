'use strict';

const { dim, red, read, exists, resolveOut, resolveConfigPath, hasHelpFlag } = require('./shared');
const { printUsage } = require('./help');

const DEFAULT_RETENTION_DAYS = 30;

function cmdPrune(args) {
  if (hasHelpFlag(args)) { printUsage('prune'); return; }
  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  let config = {};
  if (exists(cfgPath)) {
    try { config = JSON.parse(read(cfgPath)); } catch (e) { /* prune works without config */ }
  }
  const retentionDays = (config.dashboard && Number.isInteger(config.dashboard.retentionDays))
    ? config.dashboard.retentionDays : DEFAULT_RETENTION_DAYS;
  const dryRun = !!args['dry-run'];

  const retention = require('../ui/retention');
  const report = retention.prune(out, { retentionDays, dryRun });

  console.log('concertino prune → ' + out + dim('  (retention: ' + retentionDays + 'd)') +
    (dryRun ? dim('  (dry run)') : ''));

  if (report.removed.length) {
    for (const ticket of report.removed) console.log('  ' + red('-') + ' ' + ticket);
  } else {
    console.log('  ' + dim('nothing eligible'));
  }
  console.log(dim('  ' + report.keptActive.length + ' run(s) kept (still active, or within the window).'));
}

module.exports = { cmdPrune };
