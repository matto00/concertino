'use strict';

const fs = require('fs');

const { withDefaults } = require('../config');
const { green, cyan, dim, red, read, exists, findAdded, resolveOut, resolveConfigPath, hasHelpFlag } = require('./shared');
const { printUsage } = require('./help');

function cmdMigrate(args) {
  if (hasHelpFlag(args)) { printUsage('migrate'); return; }
  const out     = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  const dry     = !!args['dry-run'];

  if (!exists(cfgPath)) {
    console.error(red('error: ') + 'no config at ' + cfgPath + ' — run `concertino init` first.');
    process.exit(1);
  }

  console.log('concertino migrate → ' + cfgPath + (dry ? dim('  (dry run)') : ''));

  const raw      = JSON.parse(read(cfgPath));
  const enriched = withDefaults(JSON.parse(JSON.stringify(raw)));
  const added    = findAdded(raw, enriched, '');

  if (!added.length) {
    console.log('  ' + green('✓') + ' nothing to migrate — config is already up to date');
    return;
  }

  for (const { path: p, val } of added) {
    console.log('  ' + green('+') + ' ' + cyan(p) + dim(' = ') + JSON.stringify(val));
  }

  if (!dry) {
    fs.writeFileSync(cfgPath, JSON.stringify(enriched, null, 2) + '\n');
    console.log(green('\ndone.') + dim('  run `concertino validate` to review the result'));
  } else {
    console.log(dim('\n  (dry run — nothing written)'));
  }
}

module.exports = { cmdMigrate };
