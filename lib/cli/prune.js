'use strict';

const path = require('path');

const { dim, red, read, exists } = require('./shared');

const DEFAULT_RETENTION_DAYS = 30;

function cmdPrune(args) {
  const out = path.resolve(args.out || '.');
  const cfgPath = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');
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
