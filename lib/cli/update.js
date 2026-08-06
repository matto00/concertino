'use strict';

const fs = require('fs');

const { deepSet, coerce } = require('../config');
const { green, cyan, dim, red, read, exists, resolveOut, resolveConfigPath, hasHelpFlag } = require('./shared');
const { cmdSync } = require('./sync');
const { printUsage } = require('./help');

async function cmdUpdate(args) {
  if (hasHelpFlag(args)) { printUsage('update'); return; }
  const pairs = args._.slice(1);
  if (!pairs.length) {
    console.error(red('error: ') + 'usage: concertino update <key=value> [key=value ...]');
    console.error('       example: concertino update models.claude-code.skeptic=opus budgets.executionCycles=5');
    console.error('       example: concertino update agentMerge.enabled=true agentMerge.mergeMethod=squash');
    process.exit(1);
  }

  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  if (!exists(cfgPath)) {
    console.error(red('error: ') + 'no config at ' + cfgPath + ' — run `concertino init` first.');
    process.exit(1);
  }

  const cfg = JSON.parse(read(cfgPath));
  const updated = [];

  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 1) {
      console.error(red('error: ') + 'expected key=value, got: ' + pair);
      process.exit(1);
    }
    const key = pair.slice(0, eq);
    const val = coerce(pair.slice(eq + 1));
    deepSet(cfg, key, val);
    updated.push({ key, val });
  }

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log('concertino update → ' + cfgPath);
  for (const { key, val } of updated) {
    console.log(`  ${green('set')} ${cyan(key)} ${dim('=')} ${JSON.stringify(val)}`);
  }
  console.log('');

  await cmdSync(args);
}

module.exports = { cmdUpdate };
