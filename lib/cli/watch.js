'use strict';

const path = require('path');

const { read, exists } = require('./shared');

function cmdWatch(args) {
  const out = path.resolve(args.out || '.');
  const cfgPath = args.config ? path.resolve(args.config) : path.join(out, 'concertino.config.json');
  let config = {};
  if (exists(cfgPath)) {
    try { config = JSON.parse(read(cfgPath)); } catch (e) { /* watch works without config */ }
  }
  const { watch } = require('../ui/watch');
  return watch({ root: out, config });
}

module.exports = { cmdWatch };
