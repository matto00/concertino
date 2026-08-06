'use strict';

const fs = require('fs');
const path = require('path');

const { VERSION, green, yellow, cyan, dim, section, read, exists, hasHelpFlag } = require('./shared');
const { printUsage } = require('./help');

function cmdUpgrade(args) {
  if (hasHelpFlag(args)) { printUsage('upgrade'); return; }
  const out = path.resolve(args.out || '.');
  console.log('concertino upgrade  ' + dim('(current: v' + VERSION + ')'));
  const MARKER = /concertino:sync v([\d.]+)/;
  const stale = [], fresh = [];

  const check = (file) => {
    if (!exists(file)) return;
    const m = MARKER.exec(read(file).slice(0, 500));
    if (!m) return;
    (m[1] === VERSION ? fresh : stale).push({ file: path.relative(out, file), was: m[1] });
  };

  for (const dir of [
    path.join(out, '.claude', 'agents'), path.join(out, '.claude', 'commands'),
    path.join(out, '.codex', 'agents'),
    path.join(out, '.opencode', 'agents'), path.join(out, '.opencode', 'commands'),
  ]) {
    if (!exists(dir)) continue;
    for (const f of fs.readdirSync(dir)) check(path.join(dir, f));
  }
  check(path.join(out, 'scripts', 'concertino', '.concertino.env'));

  section('Generated files');
  if (!stale.length && !fresh.length) { console.log('  ' + dim('no concertino-generated files found')); return; }
  for (const { file } of fresh) console.log('  ' + green('✓') + ' ' + dim(file));
  for (const { file, was } of stale) console.log('  ' + yellow('!') + ' ' + cyan(file) + dim('  v' + was + ' → v' + VERSION));

  if (!stale.length) console.log('\n  ' + green('✓ all files are up to date'));
  else console.log('\n  ' + yellow(stale.length + ' file' + (stale.length !== 1 ? 's' : '') + ' out of date') + dim('  —  run `concertino sync` to update'));
}

module.exports = { cmdUpgrade };
