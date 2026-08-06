'use strict';

const { read, exists, resolveOut, resolveConfigPath, hasHelpFlag } = require('./shared');
const { printUsage } = require('./help');

function cmdWatch(args) {
  if (hasHelpFlag(args)) { printUsage('watch'); return; }
  const out = resolveOut(args);
  const cfgPath = resolveConfigPath(args, out);
  let config = {};
  if (exists(cfgPath)) {
    try { config = JSON.parse(read(cfgPath)); } catch (e) { /* watch works without config */ }
  }
  const { watch } = require('../ui/watch');
  return watch({ root: out, config });
}

module.exports = { cmdWatch };
